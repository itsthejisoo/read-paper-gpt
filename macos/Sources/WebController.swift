import AppKit
import UniformTypeIdentifiers
import WebKit

@MainActor
final class WebController: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    static let appNote = "브라우저에서 ChatGPT 로그인을 마치면 이 창으로 자동으로 돌아옵니다."

    private static let restoreGateScript = """
        (() => {
          const button = document.getElementById('btn-chatgpt');
          if (button) { button.textContent = 'ChatGPT로 계속하기'; button.disabled = false; }
          const hint = document.getElementById('chatgpt-hint');
          if (hint) {
            const span = hint.querySelector('span');
            (span || hint).textContent = \(jsString(appNote));
            hint.hidden = false;
          }
          return true;
        })()
        """
    private static let zoomSteps: [CGFloat] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

    let webView: WKWebView
    weak var selftest: Selftest?
    private let config: AppConfig
    private let pending: OAuthPending
    private let userContent: WKUserContentController
    private var lastCrash: Date?
    private var destinations: [ObjectIdentifier: URL] = [:]

    init(config: AppConfig, dataStore: WKWebsiteDataStore, pending: OAuthPending, userScripts: [WKUserScript]) {
        self.config = config
        self.pending = pending
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dataStore
        configuration.applicationNameForUserAgent = "ReadPaperTogetherMac/\(AppConfig.version)"
        userContent = configuration.userContentController
        userScripts.forEach(userContent.addUserScript)
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    func replaceUserScripts(_ scripts: [WKUserScript]) {
        userContent.removeAllUserScripts()
        scripts.forEach(userContent.addUserScript)
    }

    func loadApp() {
        webView.load(URLRequest(url: config.appURL))
    }

    func reloadApp() {
        if let url = webView.url, isAppOrigin(url) { webView.reload() } else { loadApp() }
    }

    func loadAuthCallback(rawQuery: String) {
        let url = URL(string: "http://127.0.0.1:\(config.port)/?\(rawQuery)#auth-callback") ?? config.appURL
        webView.load(URLRequest(url: url))
    }

    func isAnalysisRunning(_ completion: @escaping (Bool) -> Void) {
        webView.evaluateJavaScript("!!(window.RPT && RPT.state && RPT.state.run)") { result, _ in
            completion(result as? Bool ?? false)
        }
    }

    func openSettings() {
        webView.evaluateJavaScript("document.getElementById('btn-settings')?.click(); true", completionHandler: nil)
    }

    func resetZoom() {
        webView.pageZoom = 1
    }

    func zoom(in larger: Bool) {
        let current = webView.pageZoom
        let next = larger ? Self.zoomSteps.first { $0 > current + 0.001 } : Self.zoomSteps.last { $0 < current - 0.001 }
        if let next { webView.pageZoom = next }
    }


    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let frame = navigationAction.targetFrame else {
            decisionHandler(isAppBlob(url) ? .download : .allow)
            return
        }
        guard frame.isMainFrame else {
            decisionHandler(.allow)
            return
        }
        if isAppOrigin(url) {
            decisionHandler(.allow)
        } else if isAuthorize(url) {
            decisionHandler(.cancel)
            beginBrowserSignIn(url)
        } else {
            decisionHandler(.cancel)
            openOutside(url)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled, !(nsError.domain == "WebKitErrorDomain" && nsError.code == 102) else { return }
        writeStandardError("\(AppConfig.appName): 페이지를 열지 못했습니다 (\(nsError.domain) \(nsError.code))")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let now = Date()
        let repeated = lastCrash.map { now.timeIntervalSince($0) < 10 } ?? false
        lastCrash = now
        writeStandardError("\(AppConfig.appName): 웹 콘텐츠 프로세스가 종료되었습니다\(repeated ? " (10초 안에 다시)" : "; 페이지를 다시 불러옵니다").")
        selftest?.webContentTerminated()
        guard repeated, selftest == nil else {
            reloadApp()
            return
        }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "페이지가 예기치 않게 종료되었습니다"
        alert.informativeText = "웹 콘텐츠 프로세스가 연달아 종료되었습니다. 다시 불러오면 저장된 분석 기록은 그대로 남아 있습니다."
        alert.addButton(withTitle: "다시 불러오기")
        alert.addButton(withTitle: "닫기")
        present(alert) { [weak self] response in
            if response == .alertFirstButtonReturn { self?.reloadApp() }
        }
    }

    private func isAppOrigin(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "http", let host = url.host?.lowercased() else { return false }
        return (host == "127.0.0.1" || host == "localhost") && url.port == Int(config.port)
    }

    private func isAppBlob(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "blob", let inner = URL(string: String(url.absoluteString.dropFirst("blob:".count))) else { return false }
        return isAppOrigin(inner)
    }

    private func isAuthorize(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host?.lowercased() == "auth.openai.com" && url.path == "/api/accounts/authorize"
    }

    private func beginBrowserSignIn(_ url: URL) {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = components?.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%20")
        components?.percentEncodedQuery = query
        let items = components?.queryItems ?? []
        if let state = items.first(where: { $0.name == "state" })?.value, !state.isEmpty {
            pending.begin(state: state)
        }
        if let selftest {
            selftest.authorizeIntercepted(items)
        } else {
            NSWorkspace.shared.open(url)
        }
        webView.evaluateJavaScript(Self.restoreGateScript, completionHandler: nil)
    }

    private func openOutside(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else { return }
        if let selftest {
            selftest.externalOpened(url)
        } else {
            NSWorkspace.shared.open(url)
        }
    }


    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isAppOrigin(url) { webView.load(URLRequest(url: url)) } else { openOutside(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        guard selftest == nil else {
            completionHandler(nil)
            return
        }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.pdf]
        panel.message = "분석할 PDF 파일을 선택하세요."
        panel.prompt = "선택"
        if let window = webView.window {
            panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        if let selftest {
            selftest.dialogShown("alert")
            completionHandler()
            return
        }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "확인")
        present(alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        if let selftest {
            selftest.dialogShown("confirm")
            completionHandler(false)
            return
        }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "확인")
        alert.addButton(withTitle: "취소")
        present(alert) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        if let selftest {
            selftest.dialogShown("prompt")
            completionHandler(nil)
            return
        }
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "확인")
        alert.addButton(withTitle: "취소")
        alert.window.initialFirstResponder = field
        present(alert) { response in completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    private func present(_ alert: NSAlert, completion: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = webView.window, window.isVisible, window.attachedSheet == nil {
            alert.beginSheetModal(for: window, completionHandler: completion)
        } else {
            completion(alert.runModal())
        }
    }


    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void) {
        let key = ObjectIdentifier(download)
        if let selftest {
            selftest.downloadDestination(suggestedFilename: suggestedFilename) { [weak self] url in
                if let url { self?.destinations[key] = url }
                completionHandler(url)
            }
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.directoryURL = lastExportDirectory() ?? preparedExportDirectory()
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .OK, let url = panel.url else {
                completionHandler(nil)
                return
            }
            try? FileManager.default.removeItem(at: url)
            self?.rememberExportDirectory(url.deletingLastPathComponent())
            self?.destinations[key] = url
            completionHandler(url)
        }
        if let window = webView.window {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            finish(panel.runModal())
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        let url = destinations.removeValue(forKey: ObjectIdentifier(download))
        selftest?.downloadFinished(url)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        destinations.removeValue(forKey: ObjectIdentifier(download))
        let nsError = error as NSError
        if let selftest {
            selftest.downloadFailed("\(nsError.domain) \(nsError.code)")
            return
        }
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "파일을 저장하지 못했습니다"
        alert.informativeText = nsError.localizedDescription
        alert.addButton(withTitle: "확인")
        present(alert) { _ in }
    }

    private func preparedExportDirectory() -> URL? {
        let directory = config.exportDirectory
        guard AppConfig.unmountedVolume(containing: directory) == nil else { return nil }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            return directory
        } catch {
            return nil
        }
    }

    private func lastExportDirectory() -> URL? {
        guard let data = try? Data(contentsOf: config.stateFile),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let path = object["lastExportDirectory"] as? String else { return nil }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    private func rememberExportDirectory(_ directory: URL) {
        let object = ["lastExportDirectory": directory.path]
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? data.write(to: config.stateFile, options: .atomic)
    }
}

func jsString(_ text: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [text]), let array = String(data: data, encoding: .utf8) else { return "''" }
    return String(array.dropFirst().dropLast())
}
