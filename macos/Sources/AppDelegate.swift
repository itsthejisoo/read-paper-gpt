import AppKit
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private static let defaultContentSize = NSSize(width: 1280, height: 860)
    private static let minimumContentSize = NSSize(width: 900, height: 600)

    private let selftestPhase: Selftest.Phase?
    private let pending = OAuthPending()
    private var config: AppConfig?
    private var lock: InstanceLock?
    private var server: LocalServer?
    private var window: NSWindow?
    private var web: WebController?
    private var selftest: Selftest?
    private var quitConfirmed = false
    private var awaitingTerminationReply = false
    private var signalSources: [DispatchSourceSignal] = []
    private var frameSave: DispatchWorkItem?

    init(selftestPhase: Selftest.Phase?) {
        self.selftestPhase = selftestPhase
        super.init()
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = makeMainMenu()
        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleGetURL(_:withReply:)),
                                                     forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { [weak self] in self?.terminateFromSignal() }
            source.resume()
            signalSources.append(source)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config: AppConfig
        do {
            config = try AppConfig.load()
        } catch {
            abortLaunch("앱을 시작할 수 없습니다", (error as? AppConfig.Invalid)?.message ?? "\(error)", code: 2)
        }
        self.config = config
        let dataPath = config.dataDirectory.path
        if let volume = AppConfig.unmountedVolume(containing: config.dataDirectory) {
            abortLaunch("데이터 폴더에 접근할 수 없습니다", "\(dataPath) 를 찾을 수 없습니다. 외장 디스크(\(volume))를 연결한 뒤 다시 실행해 주세요.", code: 1)
        }
        try? FileManager.default.createDirectory(at: config.webKitDirectory, withIntermediateDirectories: true)
        switch InstanceLock.acquire(config.lockFile) {
        case .acquired(let lock):
            self.lock = lock
        case .held(let holder):
            handleAlreadyRunning(holder: holder, dataPath: dataPath)
        case .unavailable:
            break
        }
        guard let webRoot = AppConfig.webRoot, FileManager.default.fileExists(atPath: webRoot.appendingPathComponent("index.html").path) else {
            abortLaunch("앱을 시작할 수 없습니다", "앱 안에 웹 파일이 없습니다. macos/build.sh 로 다시 빌드해 주세요.", code: 1)
        }
        let server = LocalServer(webRoot: webRoot, port: config.port, upstream: config.upstream, version: AppConfig.version,
                                 mode: .app(pending: pending, onCallback: { [weak self] rawQuery in self?.signInReturned(rawQuery) }))
        self.server = server
        server.start { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.openWindow(config)
            case .failure(LocalServerError.addressInUse):
                self.abortLaunch("앱을 시작할 수 없습니다", "포트 \(config.port)를 다른 프로그램이 사용하고 있습니다. 그 프로그램을 종료한 뒤 다시 실행해 주세요.", code: 1)
            case .failure(LocalServerError.other(let reason)):
                self.abortLaunch("앱을 시작할 수 없습니다", "내장 서버를 열지 못했습니다 (\(reason)).", code: 1)
            case .failure(let error):
                self.abortLaunch("앱을 시작할 수 없습니다", "내장 서버를 열지 못했습니다 (\(error)).", code: 1)
            }
        }
    }

    private func openWindow(_ config: AppConfig) {
        var storeKind = "custom"
        let store: WKWebsiteDataStore
        if let custom = RPTMakeDataStore(config.webKitDirectory) {
            store = custom
        } else {
            storeKind = "default"
            store = .default()
            writeStandardError("\(AppConfig.appName): WebKit 저장소를 데이터 폴더로 지정하지 못해 기본 위치(~/Library/WebKit)를 사용합니다.")
        }
        var scripts: [WKUserScript] = []
        if let phase = selftestPhase {
            do {
                let selftest = try Selftest(phase: phase, config: config, dataStoreKind: storeKind)
                scripts = selftest.initialUserScripts()
                self.selftest = selftest
            } catch {
                abortLaunch("자체 시험을 시작할 수 없습니다", (error as? Selftest.SetupError)?.message ?? "\(error)", code: 1)
            }
        }
        let web = WebController(config: config, dataStore: store, pending: pending, userScripts: scripts)
        web.selftest = selftest
        self.web = web

        let window = NSWindow(contentRect: NSRect(origin: .zero, size: Self.defaultContentSize),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = AppConfig.appName
        window.contentMinSize = Self.minimumContentSize
        window.isRestorable = false
        window.tabbingMode = .disallowed
        window.isReleasedWhenClosed = false
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.contentView = web.webView
        self.window = window
        if let selftest {
            let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            window.setFrame(NSRect(x: screen.minX + 24, y: screen.minY + 24, width: 900, height: 640), display: false)
            window.level = .floating
            window.delegate = self
            window.orderFrontRegardless()
            web.loadApp()
            selftest.start(web: web)
            return
        }
        if let frame = savedFrame(config) {
            window.setFrame(frame, display: false)
        } else {
            window.center()
        }
        window.delegate = self
        window.makeKeyAndOrderFront(nil)
        activateApp()
        web.loadApp()
        if storeKind == "default" {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "기본 WebKit 저장소를 사용합니다"
            alert.informativeText = "WebKit 저장소를 데이터 폴더로 지정하지 못해 기본 위치(~/Library/WebKit)를 사용합니다."
            alert.addButton(withTitle: "확인")
            alert.beginSheetModal(for: window, completionHandler: nil)
        }
    }

    private func abortLaunch(_ title: String, _ message: String, code: Int32) -> Never {
        writeStandardError("\(AppConfig.appName): \(title) — \(message)")
        if selftestPhase != nil {
            print("SELFTEST startup: FAIL \(title) — \(message)")
            fflush(stdout)
        } else {
            let alert = NSAlert()
            alert.alertStyle = .critical
            alert.messageText = title
            alert.informativeText = message
            alert.addButton(withTitle: "확인")
            activateApp()
            alert.runModal()
        }
        exit(code)
    }

    private func handleAlreadyRunning(holder: pid_t?, dataPath: String) -> Never {
        writeStandardError("\(AppConfig.appName): 이미 실행 중입니다 — \(holder.map { "PID \($0) 가 " } ?? "다른 프로세스가 ")데이터 폴더 \(dataPath) 를 사용하고 있습니다.")
        if selftestPhase != nil { exit(3) }
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: AppConfig.bundleIdentifier)
            .filter { $0.processIdentifier != getpid() }
        if let other = others.first(where: { $0.processIdentifier == holder }) ?? others.first {
            if #available(macOS 14.0, *) {
                NSApp.yieldActivation(to: other)
                other.activate(from: NSRunningApplication.current, options: [])
            } else {
                other.activate(options: [.activateIgnoringOtherApps])
            }
            exit(3)
        }
        let alert = NSAlert()
        alert.messageText = "이미 실행 중입니다"
        alert.informativeText = "다른 창에서 이 데이터 폴더를 사용하고 있습니다."
        alert.addButton(withTitle: "확인")
        activateApp()
        alert.runModal()
        exit(3)
    }

    private func activateApp() {
        if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
    }

    private func bringWindowToFront() {
        guard selftest == nil, let window else { return }
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        activateApp()
    }

    private func signInReturned(_ rawQuery: String) {
        web?.loadAuthCallback(rawQuery: rawQuery)
        bringWindowToFront()
        if selftest == nil { NSApp.requestUserAttention(.informationalRequest) }
    }

    @objc private func handleGetURL(_ event: NSAppleEventDescriptor, withReply reply: NSAppleEventDescriptor) {
        bringWindowToFront()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        bringWindowToFront()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    func application(_ app: NSApplication, shouldSaveSecureApplicationState coder: NSCoder) -> Bool { false }

    func application(_ app: NSApplication, shouldRestoreSecureApplicationState coder: NSCoder) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !quitConfirmed, selftest == nil, let web else { return .terminateNow }
        awaitingTerminationReply = true
        web.isAnalysisRunning { [weak self] running in
            guard let self else { return }
            guard running else {
                self.replyToTermination(true)
                return
            }
            self.confirmDiscardingRun("지금 종료하면 진행 중인 섹션은 저장되지 않습니다.", action: "종료") { self.replyToTermination($0) }
        }
        return .terminateLater
    }

    private func replyToTermination(_ allowed: Bool) {
        guard awaitingTerminationReply else { return }
        awaitingTerminationReply = false
        NSApp.reply(toApplicationShouldTerminate: allowed)
    }

    func applicationWillTerminate(_ notification: Notification) {
        saveFrameNow()
        server?.stop()
        lock = nil
    }

    private func terminateFromSignal() {
        quitConfirmed = true
        if awaitingTerminationReply {
            replyToTermination(true)
        } else if NSApp.modalWindow != nil {
            exit(0)
        } else {
            NSApp.terminate(nil)
        }
    }

    private func confirmDiscardingRun(_ message: String, action: String, completion: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "분석이 진행 중입니다"
        alert.informativeText = message
        alert.addButton(withTitle: action).hasDestructiveAction = true
        alert.addButton(withTitle: "취소").keyEquivalent = "\u{1b}"
        if let window, window.isVisible, !window.isMiniaturized, window.attachedSheet == nil {
            alert.beginSheetModal(for: window) { completion($0 == .alertFirstButtonReturn) }
        } else {
            completion(alert.runModal() == .alertFirstButtonReturn)
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.terminate(nil)
        return false
    }

    func windowDidMove(_ notification: Notification) { scheduleFrameSave() }

    func windowDidResize(_ notification: Notification) { scheduleFrameSave() }

    private func scheduleFrameSave() {
        guard selftest == nil else { return }
        frameSave?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveFrameNow() }
        frameSave = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
    }

    private func saveFrameNow() {
        frameSave?.cancel()
        frameSave = nil
        guard selftest == nil, let config, let window, !window.styleMask.contains(.fullScreen), !window.isMiniaturized else { return }
        let frame = window.frame
        let object = ["x": frame.origin.x, "y": frame.origin.y, "width": frame.width, "height": frame.height]
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: config.windowFile, options: .atomic)
    }

    private func savedFrame(_ config: AppConfig) -> NSRect? {
        guard let data = try? Data(contentsOf: config.windowFile),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Double],
              let x = object["x"], let y = object["y"], let width = object["width"], let height = object["height"] else { return nil }
        let frame = NSRect(x: x, y: y, width: width, height: height)
        let minimum = NSWindow.frameRect(forContentRect: NSRect(origin: .zero, size: Self.minimumContentSize), styleMask: [.titled, .closable, .miniaturizable, .resizable])
        guard frame.width >= minimum.width, frame.height >= minimum.height else { return nil }
        let visible = NSScreen.screens.contains { screen in
            let overlap = screen.visibleFrame.intersection(frame)
            return overlap.width >= 200 && overlap.height >= 150
        }
        return visible ? frame : nil
    }

    private func makeMainMenu() -> NSMenu {
        let name = AppConfig.appName
        let main = NSMenu()
        func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            holder.submenu = menu
            main.addItem(holder)
            return menu
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
            entry.keyEquivalentModifierMask = modifiers
            entry.target = target
            return entry
        }

        _ = submenu(name, [
            item("\(name)에 관하여", #selector(showAbout(_:)), target: self),
            .separator(),
            item("설정…", #selector(openSettings(_:)), ",", target: self),
            .separator(),
            item("\(name) 가리기", #selector(NSApplication.hide(_:)), "h"),
            item("기타 가리기", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("모두 보기", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("\(name) 종료", #selector(NSApplication.terminate(_:)), "q"),
        ])
        _ = submenu("파일", [item("창 닫기", #selector(NSWindow.performClose(_:)), "w")])
        _ = submenu("편집", [
            item("실행 취소", Selector(("undo:")), "z"),
            item("실행 복귀", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("오려두기", #selector(NSText.cut(_:)), "x"),
            item("복사하기", #selector(NSText.copy(_:)), "c"),
            item("붙여넣기", #selector(NSText.paste(_:)), "v"),
            item("전체 선택", #selector(NSText.selectAll(_:)), "a"),
        ])
        let zoomInAlias = item("확대", #selector(zoomIn(_:)), "=", target: self)
        zoomInAlias.isHidden = true
        zoomInAlias.allowsKeyEquivalentWhenHidden = true
        _ = submenu("보기", [
            item("새로 고침", #selector(reloadPage(_:)), "r", target: self),
            .separator(),
            item("실제 크기", #selector(actualSize(_:)), "0", target: self),
            item("확대", #selector(zoomIn(_:)), "+", target: self),
            zoomInAlias,
            item("축소", #selector(zoomOut(_:)), "-", target: self),
        ])
        let windowMenu = submenu("윈도우", [
            item("최소화", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("확대/축소", #selector(NSWindow.performZoom(_:))),
        ])
        NSApp.windowsMenu = windowMenu
        let helpMenu = submenu("도움말", [item("데이터 폴더 열기", #selector(openDataFolder(_:)), target: self)])
        NSApp.helpMenu = helpMenu
        return main
    }

    @objc private func showAbout(_ sender: Any?) {
        activateApp()
        NSApp.orderFrontStandardAboutPanel(nil)
    }

    @objc private func openSettings(_ sender: Any?) {
        web?.openSettings()
    }

    @objc private func reloadPage(_ sender: Any?) {
        guard let web else { return }
        web.isAnalysisRunning { [weak self] running in
            guard running, let self else {
                web.reloadApp()
                return
            }
            self.confirmDiscardingRun("지금 새로 고치면 진행 중인 섹션은 저장되지 않습니다.", action: "새로 고침") { if $0 { web.reloadApp() } }
        }
    }

    @objc private func actualSize(_ sender: Any?) { web?.resetZoom() }

    @objc private func zoomIn(_ sender: Any?) { web?.zoom(in: true) }

    @objc private func zoomOut(_ sender: Any?) { web?.zoom(in: false) }

    @objc private func openDataFolder(_ sender: Any?) {
        guard let config else { return }
        NSWorkspace.shared.open(config.dataDirectory)
    }
}

final class InstanceLock {
    enum Outcome {
        case acquired(InstanceLock)
        case held(pid_t?)
        case unavailable
    }

    private let descriptor: Int32

    private init(descriptor: Int32) {
        self.descriptor = descriptor
    }

    deinit {
        close(descriptor)
    }

    static func acquire(_ url: URL) -> Outcome {
        let descriptor = open(url.path, O_RDWR | O_CREAT | O_CLOEXEC, 0o644)
        guard descriptor >= 0 else { return .unavailable }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            let busy = errno == EWOULDBLOCK
            var buffer = [UInt8](repeating: 0, count: 32)
            let count = pread(descriptor, &buffer, buffer.count, 0)
            close(descriptor)
            guard busy else { return .unavailable }
            let text = count > 0 ? String(decoding: buffer[..<count], as: UTF8.self) : ""
            return .held(pid_t(text.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        let line = Array("\(getpid())\n".utf8)
        ftruncate(descriptor, 0)
        _ = line.withUnsafeBytes { pwrite(descriptor, $0.baseAddress, $0.count, 0) }
        return .acquired(InstanceLock(descriptor: descriptor))
    }
}
