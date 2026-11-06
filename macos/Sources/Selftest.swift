import AppKit
import WebKit

@MainActor
final class Selftest {
    enum Phase: String {
        case phase1, phase2

        init?(arguments: [String]) {
            if arguments.contains("--selftest=phase2") {
                self = .phase2
            } else if arguments.contains("--selftest") || arguments.contains("--selftest=phase1") {
                self = .phase1
            } else {
                return nil
            }
        }
    }

    struct SetupError: Error {
        let message: String
    }

    private struct Stop: Error {
        let name: String
        let detail: String
    }

    private struct Check {
        let name: String
        let ok: Bool
        let detail: String
    }

    private struct SavedFile {
        let url: URL
        let waited: TimeInterval
        let revokedBeforeSave: Int
    }

    private static let arxiv = "https://arxiv.org/abs/2601.01234v2"
    private static let summaryHeadings = ["문제정의", "해결방법(제안 기법)", "결과 및 장점", "단점 및 한계점", "핵심기술"]
    private static let saveDelay: TimeInterval = 2.5
    private static let hardTimeout: TimeInterval = 180

    let phase: Phase
    private let config: AppConfig
    private let dataStoreKind: String
    private let outDirectory: URL
    private let mockSource: String
    private let mockConfig: String
    private let fakeUpstream: Bool
    private weak var web: WebController?
    private var checks: [Check] = []
    private var authorizeParams: [String: String]?
    private var authorizeCount = 0
    private var externalOpens: [String] = []
    private var pendingSaves: [URL: SavedFile] = [:]
    private var savedFiles: [SavedFile] = []
    private var downloadErrors: [String] = []
    private var dialogs: [String] = []
    private var contentTerminations = 0
    private var snapshots: [String] = []
    private var activity: NSObjectProtocol?
    private let startedAt = Date()

    init(phase: Phase, config: AppConfig, dataStoreKind: String, environment: [String: String] = ProcessInfo.processInfo.environment) throws {
        guard let out = environment["RPT_SELFTEST_OUT"], out.hasPrefix("/") else {
            throw SetupError(message: "RPT_SELFTEST_OUT 에 결과 폴더의 절대 경로를 지정하세요.")
        }
        guard let mockPath = environment["RPT_SELFTEST_MOCK"], let mock = try? String(contentsOfFile: mockPath, encoding: .utf8) else {
            throw SetupError(message: "RPT_SELFTEST_MOCK 에 test/mock-openai.js 의 경로를 지정하세요.")
        }
        let cfg = environment["RPT_SELFTEST_CFG"].flatMap { $0.isEmpty ? nil : $0 } ?? "{}"
        guard let cfgData = cfg.data(using: .utf8), (try? JSONSerialization.jsonObject(with: cfgData)) is [String: Any] else {
            throw SetupError(message: "RPT_SELFTEST_CFG 는 JSON 객체여야 합니다.")
        }
        self.phase = phase
        self.config = config
        self.dataStoreKind = dataStoreKind
        outDirectory = URL(fileURLWithPath: out, isDirectory: true)
        mockSource = mock
        mockConfig = cfg
        fakeUpstream = environment["RPT_UPSTREAM"] != nil && config.upstream.host == "127.0.0.1"
        do {
            try FileManager.default.createDirectory(at: outDirectory, withIntermediateDirectories: true)
        } catch {
            throw SetupError(message: "결과 폴더를 만들 수 없습니다: \(out)")
        }
    }

    func initialUserScripts() -> [WKUserScript] {
        userScripts(mockAuth: nil)
    }

    private func userScripts(mockAuth: [String: String]?) -> [WKUserScript] {
        var sources = [Script.instrumentation, "window.__mockCfg = \(mockConfig);"]
        if let mockAuth, let data = try? JSONSerialization.data(withJSONObject: mockAuth), let json = String(data: data, encoding: .utf8) {
            sources.append("window.__mockAuth = \(json);")
        }
        sources.append(mockSource)
        return sources.map { WKUserScript(source: $0, injectionTime: .atDocumentStart, forMainFrameOnly: true) }
    }

    func start(web: WebController) {
        self.web = web
        setvbuf(stdout, nil, _IOLBF, 0)
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled], reason: "논문 함께 읽기 자체 시험")
        let name = phase.rawValue
        let limit = Self.hardTimeout
        DispatchQueue.global().asyncAfter(deadline: .now() + limit) {
            print("SELFTEST \(name): FAIL \(Int(limit))초 안에 끝나지 않았습니다")
            fflush(stdout)
            exit(1)
        }
        Task { @MainActor in
            do {
                switch phase {
                case .phase1: try await runPhase1()
                case .phase2: try await runPhase2()
                }
            } catch let stop as Stop {
                record(stop.name, false, stop.detail)
            } catch {
                record("internal", false, "\(error)")
            }
            await finish()
        }
    }

    func authorizeIntercepted(_ items: [URLQueryItem]) {
        authorizeCount += 1
        authorizeParams = Dictionary(items.compactMap { item in item.value.map { (item.name, $0) } }, uniquingKeysWith: { first, _ in first })
    }

    func externalOpened(_ url: URL) {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.query = nil
        components?.fragment = nil
        components?.user = nil
        components?.password = nil
        externalOpens.append(components?.string ?? (url.scheme ?? "?"))
    }

    func dialogShown(_ kind: String) {
        dialogs.append(kind)
    }

    func webContentTerminated() {
        contentTerminations += 1
    }

    func downloadDestination(suggestedFilename: String, completion: @escaping (URL?) -> Void) {
        let name = (suggestedFilename as NSString).lastPathComponent
        let target = outDirectory.appendingPathComponent(name.isEmpty ? "download" : name, isDirectory: false)
        try? FileManager.default.removeItem(at: target)
        let asked = Date()
        Task { @MainActor in
            await pause(Self.saveDelay)
            let revoked = await evaluate(Script.revokedCount)?["revoked"] as? Int ?? -1
            pendingSaves[target] = SavedFile(url: target, waited: Date().timeIntervalSince(asked), revokedBeforeSave: revoked)
            completion(target)
        }
    }

    func downloadFinished(_ url: URL?) {
        guard let url, let saved = pendingSaves.removeValue(forKey: url) else { return }
        savedFiles.append(saved)
    }

    func downloadFailed(_ reason: String) {
        downloadErrors.append(reason)
    }

    private func runPhase1() async throws {
        try await expectPageReady()
        let environment = await evaluate(Script.environment, ["version": AppConfig.version]) ?? [:]
        record("secure-context", environment["secure"] as? Bool == true && environment["subtle"] as? Bool == true && environment["locks"] as? Bool == true, brief(environment))
        record("version", environment["version"] as? String == AppConfig.version, "RPT.version=\(environment["version"] ?? "없음"), 앱 \(AppConfig.version)")
        record("user-agent", environment["userAgent"] as? Bool == true, "User-Agent 에 ReadPaperTogetherMac/\(AppConfig.version) 가 없습니다")
        let gate = await waitFor(10, Script.gate)
        try require("gate-open", gate["done"] as? Bool == true, brief(gate))
        record("chatgpt-button", gate["enabled"] as? Bool == true && gate["label"] as? String == "ChatGPT로 계속하기", brief(gate))
        let health = await evaluate(Script.xhr + Script.health) ?? [:]
        let body = health["body"] as? [String: Any]
        let exact = body?.count == 3 && body?["ok"] as? Bool == true && body?["proxy"] as? Bool == true && body?["version"] as? String == AppConfig.version
        record("health", health["status"] as? Int == 200 && exact && health["cacheControl"] as? String == "no-store", brief(health))
        record("data-store", dataStoreKind == "custom", "dataStore=\(dataStoreKind)")
        await checkRelayFromPage()
        await snapshot("gate")
        try await signIn()
        try await analyse()
        await checkSummaryAndExport()
        await checkIdeasAndLinks()
        await reloadAndCheck()
        await checkStorage()
        expectSnapshots(["gate", "gate-note", "home", "summary", "summary-results", "ideas"])
    }

    private func runPhase2() async throws {
        try await expectPageReady()
        let environment = await evaluate(Script.environment, ["version": AppConfig.version]) ?? [:]
        record("version", environment["version"] as? String == AppConfig.version, "RPT.version=\(environment["version"] ?? "없음"), 앱 \(AppConfig.version)")
        record("data-store", dataStoreKind == "custom", "dataStore=\(dataStoreKind)")
        let restored = await waitFor(10, Script.restored)
        record("connected", restored["connected"] as? Bool == true && restored["gateOpen"] as? Bool == false, brief(restored))
        try require("history", restored["history"] as? Int == 1 && restored["items"] as? Int == 1, brief(restored))
        _ = await evaluate(Script.click, ["selector": "#history-list .history-item .actions button"])
        let reopened = await waitFor(10, Script.reopened, ["expected": Self.summaryHeadings])
        record("reopen-result", reopened["done"] as? Bool == true, brief(reopened))
        await snapshot("phase2-result")
        _ = await evaluate(Script.click, ["selector": "#tab-ideas"])
        let ideas = await waitFor(8, Script.ideasTab)
        record("reopen-ideas", ideas["done"] as? Bool == true, brief(ideas))
        await snapshot("phase2-ideas")
        await pause(1)
        let calls = await evaluate(Script.callCounts) ?? [:]
        record("no-api-calls", calls["api"] as? Int == 0 && calls["token"] as? Int == 0, brief(calls))
        expectSnapshots(["phase2-result", "phase2-ideas"])
    }

    private func expectPageReady() async throws {
        let ready = await waitFor(30, Script.pageReady)
        try require("page-loaded", ready["done"] as? Bool == true, "앱 페이지 또는 mock 이 30초 안에 준비되지 않았습니다 \(brief(ready))")
    }

    private func checkRelayFromPage() async {
        guard fakeUpstream else {
            let reason = "RPT_UPSTREAM 이 127.0.0.1 의 가짜 상위 서버가 아니어서 보내지 않았습니다"
            record("relay-models", false, reason)
            record("relay-stream", false, reason)
            return
        }
        let models = await evaluate(Script.xhr + Script.relayModels, ["version": AppConfig.version]) ?? [:]
        record("relay-models", models["status"] as? Int == 200 && models["authorization"] as? Bool == true && models["userAgent"] as? Bool == true, brief(models))
        let stream = await evaluate(Script.xhr + Script.relayStream) ?? [:]
        let progress = stream["progress"] as? Int ?? 0
        record("relay-stream", stream["status"] as? Int == 200 && progress >= 2 && stream["events"] as? Int == 3 && stream["complete"] as? Bool == true, brief(stream))
    }

    private func signIn() async throws {
        authorizeParams = nil
        _ = await evaluate(Script.click, ["selector": "#btn-chatgpt"])
        guard await waitUntil(10, { self.authorizeParams != nil }), let params = authorizeParams else {
            throw Stop(name: "authorize-intercepted", detail: "ChatGPT 인가 요청이 10초 안에 가로채지지 않았습니다")
        }
        let state = params["state"] ?? ""
        let redirect = "http://127.0.0.1:\(config.port)/auth/callback"
        var wrong: [String] = []
        if params["client_id"] != "dynamic_agent_client" { wrong.append("client_id") }
        if params["agent_name_hint"] != "Read Paper Together" { wrong.append("agent_name_hint") }
        if params["redirect_uri"] != redirect { wrong.append("redirect_uri") }
        if params["code_challenge_method"] != "S256" { wrong.append("code_challenge_method") }
        if params["code_challenge"]?.count != 43 { wrong.append("code_challenge") }
        if state.isEmpty { wrong.append("state") }
        if params["nonce"]?.isEmpty ?? true { wrong.append("nonce") }
        try require("authorize-intercepted", wrong.isEmpty && authorizeCount == 1, "어긋난 값: \(wrong), 가로챈 횟수 \(authorizeCount)")
        let note = await waitFor(5, Script.gateNote, ["expected": WebController.appNote])
        record("app-note", note["done"] as? Bool == true, brief(note))
        await snapshot("gate-note")

        let code = "code-1"
        web?.replaceUserScripts(userScripts(mockAuth: [
            "challenge": params["code_challenge"] ?? "", "nonce": params["nonce"] ?? "", "state": state,
            "code": code, "redirectUri": params["redirect_uri"] ?? "", "clientId": "oaiapp_test",
        ]))
        let scope = params["scope"] ?? ""
        let rejected = await browserGet(callbackURL(code: "code-wrong", state: "wrong-" + state, scope: scope))
        record("callback-wrong-state", rejected.status == 400 && rejected.body.contains("로그인을 확인할 수 없음"), "HTTP \(rejected.status)")
        let accepted = await browserGet(callbackURL(code: code, state: state, scope: scope))
        record("callback-success-page", accepted.status == 200 && accepted.body.contains("로그인 완료") && accepted.body.contains("readpapertogether://activate"), "HTTP \(accepted.status)")

        let login = await waitFor(25, Script.connected)
        try require("login-connected", login["done"] as? Bool == true, brief(login))
        record("auth-url-clean", login["searchEmpty"] as? Bool == true && login["callbackHash"] as? Bool == false, brief(login))
        let welcome = await waitFor(5, Script.dialogOpen, ["id": "welcome"])
        if welcome["done"] as? Bool == true { _ = await evaluate(Script.click, ["selector": "#welcome-ok"]) }
        let closed = await waitFor(3, Script.dialogClosed, ["id": "welcome"])
        record("welcome-dismissed", welcome["done"] as? Bool == true && closed["done"] as? Bool == true, "열림 \(welcome["done"] ?? false), 닫힘 \(closed["done"] ?? false)")
        let models = await waitFor(10, Script.models)
        try require("models", models["done"] as? Bool == true, brief(models))
        await snapshot("home")
    }

    private func analyse() async throws {
        let started = await evaluate(Script.startAnalysis, ["url": Self.arxiv]) ?? [:]
        guard started["started"] as? Bool == true else {
            throw Stop(name: "analysis-done", detail: "분석을 시작하지 못했습니다 \(brief(started))")
        }
        let job = await waitFor(90, Script.jobFinished)
        try require("analysis-done", job["done"] as? Bool == true && job["state"] as? String == "done" && job["summary"] as? String == "done", brief(job))
        record("ideas-generated", job["ideas"] as? String == "done", brief(job))
        let calls = await evaluate(Script.mockCalls) ?? [:]
        record("plan-calls-relayed", (calls["count"] as? Int ?? 0) > 0 && calls["allViaProxy"] as? Bool == true && calls["ideas"] as? Bool == true, brief(calls))
    }

    private func checkSummaryAndExport() async {
        _ = await evaluate(Script.click, ["selector": "#tab-summary"])
        let summary = await waitFor(5, Script.summaryHeadings, ["expected": Self.summaryHeadings])
        record("summary-headings", summary["done"] as? Bool == true, brief(summary))
        await snapshot("summary")
        _ = await evaluate(Script.scrollIntoView, ["selector": "#sec-results"])
        await snapshot("summary-results")
        _ = await evaluate(Script.scrollTop)

        let before = savedFiles.count
        let blobsBefore = await evaluate(Script.blobCount)?["count"] as? Int ?? 0
        let clicked = await evaluate(Script.exportMarkdown) ?? [:]
        if clicked["clicked"] as? Bool == true {
            _ = await waitUntil(20, { self.savedFiles.count > before || !self.downloadErrors.isEmpty })
        }
        guard savedFiles.count > before, let saved = savedFiles.last else {
            record("export-markdown", false, "파일이 저장되지 않았습니다 \(brief(clicked)) 오류 \(downloadErrors)")
            record("slow-save-panel", false, "내보낸 파일이 없습니다")
            return
        }
        let text = (try? String(contentsOf: saved.url, encoding: .utf8)) ?? ""
        let missing = Self.summaryHeadings.filter { !text.contains($0) }
        let ideasSection = text.components(separatedBy: "\n").contains("# 주제 제안")
        record("export-markdown", saved.url.pathExtension == "md" && missing.isEmpty && ideasSection, "빠진 제목 \(missing), # 주제 제안 \(ideasSection)")
        let blob = await evaluate(Script.blobAt, ["index": blobsBefore]) ?? [:]
        let size = fileSize(saved.url)
        record("slow-save-panel", saved.waited >= Self.saveDelay && saved.revokedBeforeSave >= 1 && blob["size"] as? Int == size,
               "대기 \(String(format: "%.1f", saved.waited))초, 해제된 blob \(saved.revokedBeforeSave)개, 파일 \(size)B / blob \(blob["size"] ?? "?")B")
    }

    private func checkIdeasAndLinks() async {
        _ = await evaluate(Script.click, ["selector": "#tab-ideas"])
        let ideas = await waitFor(8, Script.ideasTab)
        record("ideas-tab", ideas["done"] as? Bool == true, brief(ideas))
        await snapshot("ideas")

        let opened = externalOpens.count
        _ = await evaluate(Script.click, ["selector": "#ideas-body a[href^=\"https://scholar.google.com/scholar?q=\"]"])
        let external = await waitUntil(5, { self.externalOpens.count > opened })
        record("external-link", external && externalOpens.last == "https://scholar.google.com/scholar", "기본 브라우저로 넘긴 주소 \(externalOpens.suffix(1))")

        let before = savedFiles.count
        _ = await evaluate(Script.openBlobLink)
        let saved = await waitUntil(10, { self.savedFiles.count > before || !self.downloadErrors.isEmpty })
        let size = savedFiles.count > before ? fileSize(savedFiles[savedFiles.count - 1].url) : -1
        record("blob-link-download", saved && size == 17, "저장 \(saved), 크기 \(size)B, 오류 \(downloadErrors)")
    }

    private func reloadAndCheck() async {
        _ = await evaluate(Script.markDocument)
        web?.webView.reload()
        let state = await waitFor(20, Script.afterReload)
        record("reload-connected", state["done"] as? Bool == true && state["connected"] as? Bool == true && state["gateOpen"] as? Bool == false, brief(state))
        record("history", state["history"] as? Int == 1 && state["items"] as? Int == 1, brief(state))
    }

    private func checkStorage() async {
        var files: [String] = []
        let localStorage = await waitUntil(10, {
            files = self.storageFiles()
            return files.contains { $0.contains("/LocalStorage/") }
        })
        let indexedDB = files.contains { $0.contains("/IndexedDB/") }
        record("webkit-storage", localStorage, "LocalStorage \(localStorage), IndexedDB \(indexedDB), Origins 아래 파일 \(files.count)개")
        let defaultStore = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/WebKit/\(AppConfig.bundleIdentifier)")
        record("no-default-store", !FileManager.default.fileExists(atPath: defaultStore.path), "\(defaultStore.path) 가 생겼습니다")
    }

    private func expectSnapshots(_ names: [String]) {
        let missing = names.filter { !snapshots.contains($0) }
        record("snapshots", missing.isEmpty, "저장하지 못한 스냅숏 \(missing)")
    }

    private func storageFiles() -> [String] {
        let root = config.webKitDirectory.appendingPathComponent("Origins", isDirectory: true)
        guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey]) else { return [] }
        var files: [String] = []
        for case let url as URL in walker where (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true {
            files.append(String(url.path.dropFirst(root.path.count)))
        }
        return files
    }

    private func fileSize(_ url: URL) -> Int {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? -1
    }

    private func browserGet(_ url: URL) async -> (status: Int, body: String) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        do {
            let (data, response) = try await session.data(from: url)
            return ((response as? HTTPURLResponse)?.statusCode ?? 0, String(decoding: data, as: UTF8.self))
        } catch {
            return (0, "")
        }
    }

    private func callbackURL(code: String, state: String, scope: String) -> URL {
        var components = URLComponents()
        components.scheme = "http"
        components.host = "127.0.0.1"
        components.port = Int(config.port)
        components.path = "/auth/callback"
        components.queryItems = [
            URLQueryItem(name: "code", value: code), URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "client_id", value: "oaiapp_test"), URLQueryItem(name: "scope", value: scope),
        ]
        return components.url ?? config.appURL
    }

    private func snapshot(_ name: String) async {
        guard let webView = web?.webView else { return }
        await pause(0.4)
        let configuration = WKSnapshotConfiguration()
        configuration.afterScreenUpdates = true
        do {
            let image = try await webView.takeSnapshot(configuration: configuration)
            guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else { return }
            try png.write(to: outDirectory.appendingPathComponent("snapshot-\(name).png"))
            snapshots.append(name)
        } catch {
            writeStandardError("자체 시험: 스냅숏 \(name) 실패 (\((error as NSError).domain) \((error as NSError).code))")
        }
    }

    private func evaluate(_ body: String, _ arguments: [String: Any] = [:]) async -> [String: Any]? {
        guard let webView = web?.webView else { return nil }
        do {
            let value = try await webView.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: .page)
            guard let text = value as? String, let data = text.data(using: .utf8) else { return nil }
            return try JSONSerialization.jsonObject(with: data) as? [String: Any]
        } catch {
            return nil
        }
    }

    private func waitFor(_ timeout: TimeInterval, _ body: String, _ arguments: [String: Any] = [:]) async -> [String: Any] {
        let deadline = Date().addingTimeInterval(timeout)
        var last: [String: Any] = [:]
        while true {
            if let value = await evaluate(body, arguments) {
                last = value
                if value["done"] as? Bool == true { return value }
            }
            if Date() >= deadline { return last }
            await pause(0.15)
        }
    }

    private func waitUntil(_ timeout: TimeInterval, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() >= deadline { return false }
            await pause(0.1)
        }
        return true
    }

    private func pause(_ seconds: TimeInterval) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    private func record(_ name: String, _ ok: Bool, _ detail: String = "") {
        checks.append(Check(name: name, ok: ok, detail: detail))
        print("SELFTEST \(name): \(ok ? "ok" : "FAIL \(detail)")")
    }

    private func require(_ name: String, _ ok: Bool, _ detail: String) throws {
        guard ok else { throw Stop(name: name, detail: detail) }
        record(name, true, detail)
    }

    private func brief(_ value: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8) else { return "\(value)" }
        return text.count > 400 ? String(text.prefix(400)) + "…" : text
    }

    private func finish() async {
        let pageErrors = await evaluate(Script.pageErrors)?["errors"] as? [String] ?? []
        let failed = checks.filter { !$0.ok }
        writeReport(ok: failed.isEmpty, pageErrors: pageErrors)
        if !pageErrors.isEmpty { print("참고: 페이지 오류 \(pageErrors.count)건 (report.json)") }
        print("SELFTEST \(phase.rawValue): \(failed.isEmpty ? "ok" : "FAIL \(failed.map(\.name).joined(separator: ", "))") — \(checks.count - failed.count)/\(checks.count) 통과")
        fflush(stdout)
        await pause(1)
        if let activity { ProcessInfo.processInfo.endActivity(activity) }
        exit(failed.isEmpty ? 0 : 1)
    }

    private func writeReport(ok: Bool, pageErrors: [String]) {
        let url = outDirectory.appendingPathComponent("report.json")
        var report = (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        report[phase.rawValue] = [
            "ok": ok,
            "version": AppConfig.version,
            "port": Int(config.port),
            "dataStore": dataStoreKind,
            "dataDirectory": config.dataDirectory.path,
            "seconds": (Date().timeIntervalSince(startedAt) * 10).rounded() / 10,
            "checks": checks.map { ["name": $0.name, "ok": $0.ok, "detail": $0.detail] },
            "authorizeIntercepted": authorizeCount,
            "externalOpens": externalOpens,
            "downloads": savedFiles.map { ["file": $0.url.lastPathComponent, "waitedSeconds": ($0.waited * 10).rounded() / 10, "blobsRevokedBeforeSave": $0.revokedBeforeSave] },
            "downloadErrors": downloadErrors,
            "dialogs": dialogs,
            "webContentTerminations": contentTerminations,
            "snapshots": snapshots.map { "snapshot-\($0).png" },
            "pageErrors": pageErrors,
        ] as [String: Any]
        guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: url, options: .atomic)
    }
}

// callAsyncJavaScript bodies that return JSON strings.
private enum Script {
    static let instrumentation = #"""
        (() => {
          window.__selftestErrors = [];
          window.addEventListener('error', (e) => { window.__selftestErrors.push(String(e.message || e.type)); });
          window.addEventListener('unhandledrejection', (e) => { const r = e.reason; window.__selftestErrors.push('unhandled: ' + String((r && r.message) || r)); });
          window.__selftestBlobs = [];
          window.__selftestRevoked = 0;
          const create = URL.createObjectURL.bind(URL);
          const revoke = URL.revokeObjectURL.bind(URL);
          URL.createObjectURL = (object) => {
            const url = create(object);
            if (object && typeof object.size === 'number') window.__selftestBlobs.push({ size: object.size, type: object.type || '' });
            return url;
          };
          URL.revokeObjectURL = (url) => { window.__selftestRevoked += 1; return revoke(url); };
        })();
        """#

    static let xhr = #"""
        const xhr = (method, path, headers, body) => new Promise((resolve) => {
          const request = new XMLHttpRequest();
          let progress = 0;
          request.open(method, path);
          request.timeout = 20000;
          for (const [name, value] of Object.entries(headers || {})) request.setRequestHeader(name, value);
          request.onprogress = () => { progress += 1; };
          request.onload = () => resolve({ status: request.status, text: request.responseText, progress, type: request.getResponseHeader('content-type') || '', cacheControl: request.getResponseHeader('cache-control') || '' });
          request.onerror = () => resolve({ status: 0, text: '', progress, error: 'error' });
          request.ontimeout = () => resolve({ status: 0, text: '', progress, error: 'timeout' });
          request.send(body === undefined ? null : body);
        });
        """#

    static let pageReady = #"""
        const ready = document.readyState === 'complete' && !!window.RPT && !!document.getElementById('gate');
        return JSON.stringify({ done: ready && window.__mockInstalled === true, readyState: document.readyState, rpt: !!window.RPT, mock: window.__mockInstalled === true, marked: typeof window.marked });
        """#

    static let environment = #"""
        return JSON.stringify({
          secure: window.isSecureContext === true,
          subtle: !!(window.crypto && crypto.subtle && typeof crypto.subtle.digest === 'function'),
          locks: !!(navigator.locks && typeof navigator.locks.request === 'function'),
          version: window.RPT ? RPT.version : null,
          userAgent: navigator.userAgent.includes('ReadPaperTogetherMac/' + version)
        });
        """#

    static let gate = #"""
        const gate = document.getElementById('gate');
        const button = document.getElementById('btn-chatgpt');
        return JSON.stringify({ done: !!(gate && gate.open && button), enabled: !!button && !button.disabled, label: button ? button.textContent.trim() : '' });
        """#

    static let health = #"""
        const r = await xhr('GET', '/__rpt/health');
        let body = null;
        try { body = JSON.parse(r.text); } catch (e) { body = null; }
        return JSON.stringify({ status: r.status, body, cacheControl: r.cacheControl });
        """#

    static let relayModels = #"""
        const r = await xhr('GET', '/__rpt/openai/v1/models', { Authorization: 'Bearer selftest' });
        let body = null;
        try { body = JSON.parse(r.text); } catch (e) { body = null; }
        return JSON.stringify({ status: r.status, authorization: !!(body && body.authorization_ok === true), userAgent: !!(body && body.user_agent === 'rpt-serve/' + version), acceptEncoding: body ? body.accept_encoding : null });
        """#

    static let relayStream = #"""
        const r = await xhr('POST', '/__rpt/openai/v1/responses', { 'Content-Type': 'application/json', Authorization: 'Bearer selftest' }, JSON.stringify({ model: 'selftest', stream: true, input: 'ping' }));
        const events = (r.text.match(/^data: /gm) || []).length;
        return JSON.stringify({ status: r.status, progress: r.progress, events, complete: r.text.includes('selftest.3'), type: r.type });
        """#

    static let click = #"""
        const element = document.querySelector(selector);
        if (!element) return JSON.stringify({ clicked: false });
        element.click();
        return JSON.stringify({ clicked: true });
        """#

    static let gateNote = #"""
        const hint = document.getElementById('chatgpt-hint');
        const button = document.getElementById('btn-chatgpt');
        const shown = !!hint && !hint.hidden && hint.getClientRects().length > 0;
        const text = hint ? hint.textContent.trim().replace(/\s+/g, ' ') : '';
        const label = button ? button.textContent.trim() : '';
        const enabled = !!button && !button.disabled;
        return JSON.stringify({ done: shown && text === expected && enabled && label === 'ChatGPT로 계속하기', shown, text, enabled, label });
        """#

    static let connected = #"""
        const st = window.RPT && RPT.auth && typeof RPT.auth.status === 'function' ? RPT.auth.status() : null;
        const gate = document.getElementById('gate');
        const error = document.getElementById('gate-error');
        return JSON.stringify({
          done: !!(st && st.connected && st.mode === 'chatgpt'), mode: st ? st.mode : null,
          searchEmpty: location.search === '', callbackHash: location.hash === '#auth-callback',
          gateOpen: !!(gate && gate.open), gateError: error && !error.hidden ? error.textContent.trim() : ''
        });
        """#

    static let dialogOpen = #"""
        const dialog = document.getElementById(id);
        return JSON.stringify({ done: !!(dialog && dialog.open) });
        """#

    static let dialogClosed = #"""
        const dialog = document.getElementById(id);
        return JSON.stringify({ done: !dialog || !dialog.open });
        """#

    static let models = #"""
        const options = [...document.querySelectorAll('#model-select option')].map((o) => o.value).filter(Boolean);
        const st = RPT.auth.status();
        return JSON.stringify({ done: options.length > 0 && st.models > 0, options, models: st.models, startDisabled: document.getElementById('btn-start').disabled });
        """#

    static let startAnalysis = #"""
        const input = document.getElementById('url-input');
        if (!input || document.getElementById('view-home').hidden) return JSON.stringify({ started: false, reason: 'home hidden' });
        input.value = url;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 200));
        const button = document.getElementById('btn-start');
        if (button.disabled) return JSON.stringify({ started: false, reason: 'start disabled' });
        button.click();
        return JSON.stringify({ started: true });
        """#

    static let jobFinished = #"""
        const s = window.RPT && RPT.state;
        const job = s && s.currentJobId && s.jobs[s.currentJobId];
        if (!job) return JSON.stringify({ done: false, job: null });
        return JSON.stringify({
          done: ['done', 'partial', 'failed', 'cancelled'].includes(job.state), state: job.state, summary: job.summaryStatus, ideas: job.ideasStatus,
          chunks: job.chunks.length, unfinished: job.chunks.filter((c) => c.status !== 'done').map((c) => c.id + ':' + c.status)
        });
        """#

    static let mockCalls = #"""
        const calls = window.__mockCalls || [];
        return JSON.stringify({ count: calls.length, allViaProxy: calls.every((c) => c.viaProxy === true), tasks: [...new Set(calls.map((c) => c.task))], ideas: calls.some((c) => c.task === 'ideas') });
        """#

    static let summaryHeadings = #"""
        const panel = document.getElementById('panel-summary');
        const headings = [...document.querySelectorAll('#panel-summary .sum-section > h3')].map((h) => h.textContent.trim());
        const nested = !!document.querySelector('#md-problem li > ul, #md-problem li > ol') && !!document.querySelector('#md-results li > ul, #md-results li > ol');
        return JSON.stringify({ done: !!panel && !panel.hidden && JSON.stringify(headings) === JSON.stringify(expected), headings, nested });
        """#

    static let scrollIntoView = #"""
        const element = document.querySelector(selector);
        if (!element) return JSON.stringify({ scrolled: false });
        const covered = Math.max(0, ...[...document.querySelectorAll('#topbar, .progress')].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().bottom));
        window.scrollBy(0, element.getBoundingClientRect().top - covered - 12);
        return JSON.stringify({ scrolled: true });
        """#

    static let scrollTop = #"""
        window.scrollTo(0, 0);
        return JSON.stringify({ scrolled: true });
        """#

    static let blobCount = #"""
        return JSON.stringify({ count: (window.__selftestBlobs || []).length });
        """#

    static let blobAt = #"""
        const blob = (window.__selftestBlobs || [])[index];
        return JSON.stringify({ size: blob ? blob.size : null, type: blob ? blob.type : null });
        """#

    static let revokedCount = #"""
        return JSON.stringify({ revoked: window.__selftestRevoked || 0 });
        """#

    static let exportMarkdown = #"""
        document.getElementById('btn-export').click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const menuOpen = !document.getElementById('export-list').hidden;
        const item = document.querySelector('#export-list button[data-export="md"]');
        if (!item) return JSON.stringify({ clicked: false, menuOpen });
        item.click();
        return JSON.stringify({ clicked: true, menuOpen });
        """#

    static let ideasTab = #"""
        const panel = document.getElementById('panel-ideas');
        const tab = document.getElementById('tab-ideas');
        const cards = document.querySelectorAll('#ideas-body .idea-card').length;
        const links = document.querySelectorAll('#ideas-body a[href^="https://scholar.google.com/scholar?q="]').length;
        return JSON.stringify({ done: !!panel && !panel.hidden && !!tab && tab.getAttribute('aria-selected') === 'true' && cards >= 4, cards, links });
        """#

    static let openBlobLink = #"""
        const url = URL.createObjectURL(new Blob(['%PDF-1.4 selftest'], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        document.body.append(link);
        link.click();
        link.remove();
        return JSON.stringify({ clicked: true });
        """#

    static let markDocument = #"""
        window.__selftestMarker = true;
        return JSON.stringify({ marked: true });
        """#

    static let afterReload = #"""
        if (window.__selftestMarker || document.readyState !== 'complete' || !window.RPT) return JSON.stringify({ done: false });
        const st = RPT.auth.status();
        const gate = document.getElementById('gate');
        return JSON.stringify({ done: true, connected: st.connected, gateOpen: !!(gate && gate.open), history: RPT.store.loadHistory().length, items: document.querySelectorAll('#history-list .history-item').length });
        """#

    static let restored = #"""
        if (document.readyState !== 'complete' || !window.RPT) return JSON.stringify({ done: false });
        const st = RPT.auth.status();
        const gate = document.getElementById('gate');
        return JSON.stringify({ done: true, connected: st.connected, mode: st.mode, gateOpen: !!(gate && gate.open), history: RPT.store.loadHistory().length, items: document.querySelectorAll('#history-list .history-item').length });
        """#

    static let reopened = #"""
        const view = document.getElementById('view-result');
        const headings = [...document.querySelectorAll('#panel-summary .sum-section > h3')].map((h) => h.textContent.trim());
        const cards = document.querySelectorAll('#tr-main article.section-card').length;
        const s = RPT.state;
        const job = s.currentJobId && s.jobs[s.currentJobId];
        const filled = !!document.querySelector('#md-problem li');
        return JSON.stringify({ done: !!view && !view.hidden && JSON.stringify(headings) === JSON.stringify(expected) && cards > 0 && !!job && job.state === 'done' && filled, headings, cards, state: job ? job.state : null, filled });
        """#

    static let callCounts = #"""
        return JSON.stringify({ api: (window.__mockCalls || []).length, token: (window.__mockTokenCalls || []).length });
        """#

    static let pageErrors = #"""
        return JSON.stringify({ errors: (window.__selftestErrors || []).slice(0, 5).map((e) => String(e).slice(0, 200)) });
        """#
}
