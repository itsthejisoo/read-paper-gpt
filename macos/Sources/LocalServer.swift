import Foundation
import Network

final class OAuthPending {
    private let ttl: TimeInterval
    private let lock = NSLock()
    private var state: String?
    private var begunAt = Date.distantPast

    init(ttl: TimeInterval = 600) {
        self.ttl = ttl
    }

    func begin(state: String) {
        lock.lock()
        defer { lock.unlock() }
        self.state = state
        begunAt = Date()
    }

    func consume(state candidate: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let expected = state else { return false }
        if Date().timeIntervalSince(begunAt) >= ttl {
            state = nil
            return false
        }
        guard !candidate.isEmpty, candidate == expected else { return false }
        state = nil
        return true
    }
}

enum LocalServerError: Error {
    case addressInUse
    case other(String)
}

final class LocalServer {
    enum Mode {
        case app(pending: OAuthPending, onCallback: (String) -> Void)
        case serveOnly(log: (String) -> Void)
    }

    fileprivate let webRoot: String
    fileprivate let upstreamBase: String
    fileprivate let version: String
    fileprivate let mode: Mode
    fileprivate let queue = DispatchQueue(label: "local.readpapertogether.server")
    fileprivate let session: URLSession
    fileprivate private(set) var stopped = false
    private let port: UInt16
    private let delegateQueue = OperationQueue()
    private let queueKey = DispatchSpecificKey<Void>()
    private var listener: NWListener?
    private var startCompletion: ((Result<UInt16, Error>) -> Void)?
    private var clients: [ObjectIdentifier: Client] = [:]
    private var relaying = Set<ObjectIdentifier>()
    private var activity: NSObjectProtocol?

    init(webRoot: URL, port: UInt16, upstream: URL, version: String, mode: Mode) {
        self.webRoot = webRoot.standardizedFileURL.path
        self.port = port
        self.version = version
        self.mode = mode
        var base = upstream.absoluteString
        if let cut = base.firstIndex(where: { $0 == "?" || $0 == "#" }) { base = String(base[..<cut]) }
        while base.hasSuffix("/") { base.removeLast() }
        upstreamBase = base

        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCredentialStorage = nil
        config.timeoutIntervalForRequest = 600
        config.httpMaximumConnectionsPerHost = 32
        delegateQueue.maxConcurrentOperationCount = 1
        delegateQueue.underlyingQueue = queue
        session = URLSession(configuration: config, delegate: nil, delegateQueue: delegateQueue)
        queue.setSpecific(key: queueKey, value: ())
    }

    func start(_ completion: @escaping (Result<UInt16, Error>) -> Void) {
        queue.async { [self] in
            guard listener == nil, startCompletion == nil, !stopped else {
                DispatchQueue.main.async { completion(.failure(LocalServerError.other("서버를 이미 시작했거나 중지했습니다."))) }
                return
            }
            let tcp = NWProtocolTCP.Options()
            tcp.noDelay = true
            let parameters = NWParameters(tls: nil, tcp: tcp)
            parameters.allowLocalEndpointReuse = false
            parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port) ?? .any)
            do {
                let listener = try NWListener(using: parameters)
                listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
                listener.stateUpdateHandler = { [weak self] state in self?.listenerChanged(state) }
                self.listener = listener
                startCompletion = completion
                listener.start(queue: queue)
            } catch {
                DispatchQueue.main.async { completion(.failure(LocalServerError.other("\(error)"))) }
            }
        }
    }

    func stop() {
        let work = { [self] in
            guard !stopped else { return }
            stopped = true
            listener?.cancel()
            listener = nil
            for client in Array(clients.values) { client.close() }
            clients.removeAll()
            session.invalidateAndCancel()
        }
        if DispatchQueue.getSpecific(key: queueKey) != nil { work() } else { queue.sync(execute: work) }
    }

    private func listenerChanged(_ state: NWListener.State) {
        switch state {
        case .ready:
            finishStart(.success(listener?.port?.rawValue ?? port))
        case .failed(let error), .waiting(let error):
            listener?.cancel()
            listener = nil
            if startCompletion == nil { log("서버 소켓 오류: \(error)") }
            if case .posix(.EADDRINUSE) = error {
                finishStart(.failure(LocalServerError.addressInUse))
            } else {
                finishStart(.failure(LocalServerError.other("\(error)")))
            }
        case .cancelled:
            finishStart(.failure(LocalServerError.other("서버를 중지했습니다.")))
        default:
            break
        }
    }

    private func finishStart(_ result: Result<UInt16, Error>) {
        guard let completion = startCompletion else { return }
        startCompletion = nil
        DispatchQueue.main.async { completion(result) }
    }

    private func accept(_ connection: NWConnection) {
        guard !stopped else {
            connection.cancel()
            return
        }
        let client = Client(server: self, connection: connection)
        clients[ObjectIdentifier(client)] = client
        client.start()
    }

    fileprivate func forget(_ client: Client) {
        clients.removeValue(forKey: ObjectIdentifier(client))
    }

    fileprivate func relayBegan(_ client: Client) {
        relaying.insert(ObjectIdentifier(client))
        if activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(options: .userInitiated, reason: "ChatGPT 응답 중계")
        }
    }

    fileprivate func relayEnded(_ client: Client) {
        relaying.remove(ObjectIdentifier(client))
        if relaying.isEmpty, let activity {
            ProcessInfo.processInfo.endActivity(activity)
            self.activity = nil
        }
    }

    fileprivate func log(_ line: @autoclosure () -> String) {
        if case .serveOnly(let log) = mode { log(line()) }
    }
}

extension LocalServer {
    fileprivate enum Limits {
        static let headBytes = 64 * 1024
        static let bodyBytes = 128_000_000
        static let headTimeout: TimeInterval = 30
        static let bodyIdleTimeout: TimeInterval = 30
        static let drainTimeout: TimeInterval = 3
        static let upstreamQuiet: TimeInterval = 15
        static let upstreamHeaders: TimeInterval = 120
    }

    fileprivate enum ProxyJSON {
        static let notFound = #"{"error": {"message": "중계 경로가 아닙니다.", "code": "proxy_not_found"}}"#
        static let upstreamDown = #"{"error": {"message": "OpenAI 서버에 연결하지 못했습니다.", "code": "proxy_upstream"}}"#
        static let lengthRequired = #"{"error": {"message": "요청 본문에는 Content-Length 가 필요합니다.", "code": "proxy_length_required"}}"#
        static let misdirected = #"{"error": {"message": "루프백 주소(127.0.0.1, localhost)로만 접속할 수 있습니다.", "code": "proxy_misdirected"}}"#
        static let tooLarge = #"{"error": {"message": "요청 본문이 너무 큽니다.", "code": "proxy_too_large"}}"#
    }

    fileprivate enum Relay {
        static let forwardedHeaders = ["Authorization", "Content-Type", "Accept"]
        static let droppedHeaders: Set<String> = [
            "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-connection", "proxy-authenticate",
            "content-length", "alt-svc", "set-cookie", "strict-transport-security", "cache-control", "x-accel-buffering",
        ]
        static let decodedEncodings: Set<String> = ["gzip", "x-gzip", "deflate", "br"]
    }

    fileprivate struct Request {
        let method: String
        let target: String
        let version: String
        let headers: [(name: String, value: String)]

        func header(_ name: String) -> String? {
            headers.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }?.value
        }

        private var parts: (path: Substring, query: Substring?, fragment: Substring?) {
            let hash = target.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
            let question = hash[0].split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
            return (question[0], question.count > 1 ? question[1] : nil, hash.count > 1 ? hash[1] : nil)
        }

        var path: String { String(parts.path) }
        var query: String? { parts.query.map(String.init) }
        var fragment: String? { parts.fragment.map(String.init) }
    }

    fileprivate final class Client: NSObject, URLSessionDataDelegate {
        private enum Phase { case head, body, waiting, closing, closed }

        private weak var server: LocalServer?
        private let connection: NWConnection
        private let queue: DispatchQueue
        private var phase = Phase.head
        private var buffer = Data()
        private var request: Request?
        private var body = Data()
        private var bodyLength = 0
        private var relayPath = ""
        private var timer: DispatchSourceTimer?
        private var task: URLSessionDataTask?
        private var watchdog: DispatchSourceTimer?
        private var watchdogFired = false
        private var headersSent = false
        private var finalSent = false
        private var peerFinished = false

        init(server: LocalServer, connection: NWConnection) {
            self.server = server
            self.connection = connection
            queue = server.queue
        }

        func start() {
            connection.stateUpdateHandler = { [weak self] state in
                if case .failed = state { self?.close() }
            }
            connection.start(queue: queue)
            arm(Limits.headTimeout)
            receive()
        }

        func close() {
            guard phase != .closed else { return }
            phase = .closed
            timer?.cancel()
            timer = nil
            watchdog?.cancel()
            watchdog = nil
            task?.cancel()
            connection.cancel()
            server?.forget(self)
        }

        private func arm(_ seconds: TimeInterval) {
            timer?.cancel()
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + seconds)
            timer.setEventHandler { [weak self] in self?.close() }
            timer.resume()
            self.timer = timer
        }

        private func receive() {
            let limit: Int
            switch phase {
            case .head: limit = 1 << 16
            case .body: limit = min(bodyLength - body.count, 1 << 20)
            case .waiting, .closing: limit = 1 << 20
            case .closed: return
            }
            connection.receive(minimumIncompleteLength: 1, maximumLength: limit) { [weak self] data, _, isComplete, error in
                self?.received(data, ended: isComplete, failed: error != nil)
            }
        }

        private func received(_ data: Data?, ended: Bool, failed: Bool) {
            if let data, !data.isEmpty {
                switch phase {
                case .head:
                    buffer.append(data)
                    parseHead()
                case .body:
                    body.append(data)
                    if body.count >= bodyLength { startRelay() } else { arm(Limits.bodyIdleTimeout) }
                case .waiting, .closing, .closed:
                    break
                }
            }
            if failed {
                close()
            } else if ended {
                peerEnded()
            } else {
                receive()
            }
        }

        private func peerEnded() {
            if phase == .closing, !finalSent {
                peerFinished = true
            } else {
                close()
            }
        }

        private func parseHead() {
            let headCount: Int
            if let end = Wire.headEnd(buffer) {
                headCount = end
            } else if buffer.count >= Limits.headBytes {
                headCount = Int.max
            } else {
                return
            }
            if headCount > Limits.headBytes {
                if buffer.prefix(Limits.headBytes).contains(0x0A) { sendError(431) } else { sendError(414) }
                return
            }
            var lines = buffer.prefix(headCount).split(separator: 0x0A, omittingEmptySubsequences: false).map { line in
                String(data: Data(line.last == 0x0D ? line.dropLast() : line), encoding: .isoLatin1) ?? ""
            }
            let rest = buffer.count > headCount ? Data(buffer[headCount...]) : Data()
            buffer = Data()
            let requestLine = lines.removeFirst()
            let words = requestLine.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
            if words.isEmpty {
                close()
                return
            }
            var version = "HTTP/0.9"
            if words.count >= 3 {
                let candidate = words[words.count - 1]
                guard let number = Wire.httpVersion(candidate) else {
                    sendError(400, message: "Bad request version ('\(candidate)')")
                    return
                }
                if number.major >= 2 {
                    sendError(505, message: "Invalid HTTP version (\(candidate.dropFirst(5)))")
                    return
                }
                version = candidate
            }
            guard words.count == 3 else {
                sendError(400, message: "Bad request syntax ('\(requestLine)')")
                return
            }
            var headers: [(name: String, value: String)] = []
            for line in lines {
                if line.isEmpty { break }
                if line.first == " " || line.first == "\t" {
                    if !headers.isEmpty { headers[headers.count - 1].value += " " + line.trimmingCharacters(in: .whitespaces) }
                    continue
                }
                guard let colon = line.firstIndex(of: ":") else { continue }
                headers.append((String(line[..<colon]), line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)))
            }
            if headers.count > 100 {
                sendError(431, message: "Too many headers")
                return
            }
            var target = words[1]
            if target.hasPrefix("//") { target = "/" + target.drop(while: { $0 == "/" }) }
            let request = Request(method: words[0], target: target, version: version, headers: headers)
            self.request = request
            timer?.cancel()
            timer = nil
            route(request, rest)
        }

        private func route(_ request: Request, _ rest: Data) {
            let rpt = request.target.hasPrefix("/__rpt/")
            switch request.method {
            case "GET", "HEAD", "POST", "DELETE":
                break
            default:
                sendError(501, message: "Unsupported method ('\(request.method)')")
                return
            }
            guard Wire.hostAllowed(request.header("Host")) else {
                if rpt { sendJSON(421, ProxyJSON.misdirected) } else { sendError(421) }
                return
            }
            switch request.method {
            case "HEAD":
                if rpt { sendJSON(404, ProxyJSON.notFound) } else { serveStatic(request) }
            case "GET":
                if rpt {
                    handleRpt(request, rest)
                } else if !handleOAuthCallback(request) {
                    serveStatic(request)
                }
            default:
                if rpt { handleRpt(request, rest) } else { sendError(501, message: "Unsupported method ('\(request.method)')") }
            }
        }

        private func handleRpt(_ request: Request, _ rest: Data) {
            guard let server else { return close() }
            if request.path == "/__rpt/health", request.method == "GET" {
                sendJSON(200, "{\"ok\": true, \"proxy\": true, \"version\": \(Wire.jsonQuoted(server.version))}")
                return
            }
            guard let target = Wire.relayTarget(request.path) else {
                sendJSON(404, ProxyJSON.notFound)
                return
            }
            let declared = request.header("Content-Length")
            if declared == nil, let encoding = request.header("Transfer-Encoding"), !encoding.isEmpty {
                sendJSON(411, ProxyJSON.lengthRequired)
                return
            }
            var length = 0
            if let declared, !declared.isEmpty {
                guard let parsed = Wire.contentLength(declared) else {
                    sendError(400)
                    return
                }
                length = parsed
            }
            if length > Limits.bodyBytes {
                sendJSON(413, ProxyJSON.tooLarge)
                return
            }
            if let query = request.query, !query.isEmpty { relayPath = target + "?" + query } else { relayPath = target }
            bodyLength = length
            body = rest.count > length ? rest.prefix(length) : rest
            if body.count >= length {
                startRelay()
                return
            }
            phase = .body
            body.reserveCapacity(length)
            if request.version == "HTTP/1.1", request.header("Expect")?.lowercased() == "100-continue" {
                send(Data("HTTP/1.1 100 Continue\r\n\r\n".utf8))
            }
            arm(Limits.bodyIdleTimeout)
        }

        private func startRelay() {
            guard let server, !server.stopped, let request else { return close() }
            phase = .waiting
            timer?.cancel()
            timer = nil
            guard let url = URL(string: server.upstreamBase + relayPath) else {
                server.log("중계 실패: 상위 주소를 만들 수 없음")
                sendJSON(502, ProxyJSON.upstreamDown)
                return
            }
            var upstream = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 600)
            upstream.httpMethod = request.method
            upstream.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
            upstream.setValue("rpt-serve/" + server.version, forHTTPHeaderField: "User-Agent")
            for name in Relay.forwardedHeaders {
                if let value = request.header(name) { upstream.setValue(value, forHTTPHeaderField: name) }
            }
            if request.method != "GET", !body.isEmpty {
                upstream.httpBody = body
                if request.header("Content-Type") == nil { upstream.setValue("", forHTTPHeaderField: "Content-Type") }
            }
            body = Data()
            let task = server.session.dataTask(with: upstream)
            task.delegate = self
            self.task = task
            server.relayBegan(self)
            armWatchdog(Limits.upstreamQuiet)
            task.resume()
        }

        private func armWatchdog(_ seconds: TimeInterval) {
            watchdog?.cancel()
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + seconds)
            timer.setEventHandler { [weak self] in
                guard let self, !self.headersSent else { return }
                self.watchdogFired = true
                self.task?.cancel()
            }
            timer.resume()
            watchdog = timer
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
            guard phase == .waiting, !headersSent else { return }
            let sentAll = totalBytesExpectedToSend > 0 && totalBytesSent >= totalBytesExpectedToSend
            armWatchdog(sentAll ? Limits.upstreamHeaders : Limits.upstreamQuiet)
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            watchdog?.cancel()
            watchdog = nil
            guard phase == .waiting, let http = response as? HTTPURLResponse else {
                completionHandler(.cancel)
                return
            }
            guard !headersSent else {
                completionHandler(.allow)
                return
            }
            if http.value(forHTTPHeaderField: "Content-Encoding")?.contains(",") == true {
                completionHandler(.cancel)
                server?.log("중계 실패: 겹친 Content-Encoding")
                sendJSON(502, ProxyJSON.upstreamDown)
                return
            }
            headersSent = true
            var head = "HTTP/1.1 \(http.statusCode) \(Wire.reasonPhrase(http.statusCode))\r\n"
            for (key, value) in http.allHeaderFields {
                guard let name = key as? String else { continue }
                let lower = name.lowercased()
                let text = "\(value)"
                if Relay.droppedHeaders.contains(lower) || lower.hasPrefix("access-control-") { continue }
                if lower == "content-encoding", Relay.decodedEncodings.contains(text.trimmingCharacters(in: .whitespaces).lowercased()) { continue }
                head += "\(name): \(text)\r\n"
            }
            head += "Cache-Control: no-store\r\nX-Accel-Buffering: no\r\nConnection: close\r\n\r\n"
            logLine(http.statusCode)
            send(head.data(using: .isoLatin1) ?? Data(head.utf8))
            completionHandler(.allow)
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            if phase == .waiting { send(data) }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            watchdog?.cancel()
            watchdog = nil
            self.task = nil
            server?.relayEnded(self)
            guard phase == .waiting else { return }
            if headersSent {
                finish()
                return
            }
            let reason = watchdogFired ? "응답 시간 초과" : error.map { "\(($0 as NSError).domain) \(($0 as NSError).code)" } ?? "응답 없음"
            server?.log("중계 실패: \(reason)")
            sendJSON(502, ProxyJSON.upstreamDown)
        }

        private func handleOAuthCallback(_ request: Request) -> Bool {
            guard case .app(let pending, let onCallback)? = server?.mode,
                  request.path == "/auth/callback" || request.path == "/auth/callback/",
                  let rawQuery = request.query else { return false }
            let params = Wire.queryParameters(rawQuery)
            guard let state = params["state"], params["code"] != nil || params["error"] != nil else { return false }
            if pending.consume(state: state) {
                sendPage(200, params["error"] == nil ? CallbackPage.success : CallbackPage.cancelled)
                DispatchQueue.main.async { onCallback(rawQuery) }
            } else {
                sendPage(400, CallbackPage.rejected)
            }
            return true
        }

        private func serveStatic(_ request: Request) {
            guard let server else { return close() }
            let urlPath = request.path
            guard let decoded = String(bytes: Wire.percentDecoded(urlPath), encoding: .utf8), !decoded.contains("\0") else {
                sendError(404, message: "File not found")
                return
            }
            var path = server.webRoot
            for word in Wire.normpath(decoded).split(separator: "/") where word != "." && word != ".." {
                path += "/" + word
            }
            if urlPath.trimmingCharacters(in: .whitespaces).hasSuffix("/") { path += "/" }
            if Wire.fileKind(path) == S_IFDIR {
                if !(urlPath.hasSuffix("/") || urlPath.hasSuffix("%2f") || urlPath.hasSuffix("%2F")) {
                    var location = urlPath + "/"
                    if let query = request.query, !query.isEmpty { location += "?" + query }
                    if let fragment = request.fragment, !fragment.isEmpty { location += "#" + fragment }
                    respond(301, [("Location", location), ("Content-Length", "0"), ("Cache-Control", "no-store")])
                    return
                }
                let directory = path.hasSuffix("/") ? path : path + "/"
                guard let index = ["index.html", "index.htm"].map({ directory + $0 }).first(where: { Wire.fileKind($0) == S_IFREG }) else {
                    sendError(404, message: "File not found")
                    return
                }
                path = index
            }
            guard !path.hasSuffix("/"), Wire.fileKind(path) == S_IFREG, let data = FileManager.default.contents(atPath: path) else {
                sendError(404, message: "File not found")
                return
            }
            respond(200, [("Content-Type", Wire.mimeType(path)), ("Content-Length", "\(data.count)"), ("Cache-Control", "no-store")], body: data)
        }

        private func sendJSON(_ status: Int, _ json: String) {
            let data = Data(json.utf8)
            respond(status, [("Content-Type", "application/json; charset=utf-8"), ("Content-Length", "\(data.count)"), ("Cache-Control", "no-store")], body: data)
        }

        private func sendError(_ status: Int, message: String? = nil) {
            let explain = Wire.errorExplanations[status] ?? ""
            let html = "<!DOCTYPE HTML>\n<html lang=\"en\">\n    <head>\n        <meta charset=\"utf-8\">\n        <title>Error response</title>\n    </head>\n"
                + "    <body>\n        <h1>Error response</h1>\n        <p>Error code: \(status)</p>\n"
                + "        <p>Message: \(Wire.escapeHTML(message ?? Wire.reasonPhrase(status))).</p>\n"
                + "        <p>Error code explanation: \(status) - \(Wire.escapeHTML(explain)).</p>\n    </body>\n</html>\n"
            let data = Data(html.utf8)
            respond(status, [("Content-Type", "text/html;charset=utf-8"), ("Content-Length", "\(data.count)"), ("Cache-Control", "no-store")], body: data)
        }

        private func sendPage(_ status: Int, _ html: String) {
            let data = Data(html.utf8)
            respond(status, [
                ("Content-Type", "text/html; charset=utf-8"), ("Content-Length", "\(data.count)"), ("Cache-Control", "no-store"),
                ("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'"), ("Referrer-Policy", "no-referrer"),
            ], body: data)
        }

        private func respond(_ status: Int, _ headers: [(String, String)], body: Data = Data()) {
            guard phase != .closing, phase != .closed else { return }
            var head = "HTTP/1.1 \(status) \(Wire.reasonPhrase(status))\r\n"
            for (name, value) in headers { head += "\(name): \(value)\r\n" }
            head += "Date: \(Wire.httpDate())\r\nConnection: close\r\n\r\n"
            var out = Data(head.utf8)
            if request?.method != "HEAD" { out.append(body) }
            logLine(status)
            send(out)
            finish()
        }

        private func send(_ data: Data) {
            connection.send(content: data, completion: .contentProcessed { [weak self] error in
                if error != nil { self?.close() }
            })
        }

        // Half-closes after a response, then drains input so the reply is not reset.
        private func finish() {
            guard phase != .closing, phase != .closed else { return }
            phase = .closing
            timer?.cancel()
            timer = nil
            connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] error in
                guard let self, self.phase == .closing else { return }
                self.finalSent = true
                if error != nil || self.peerFinished {
                    self.close()
                } else {
                    self.arm(Limits.drainTimeout)
                }
            })
        }

        private func logLine(_ status: Int) {
            guard let server, case .serveOnly = server.mode else { return }
            var line = "-"
            if let request {
                let withoutQuery = request.target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0]
                line = "\(request.method) \(withoutQuery) \(request.version)"
            }
            server.log("\"\(line)\" \(status)")
        }
    }

    fileprivate enum Wire {
        static func headEnd(_ data: Data) -> Int? {
            let crlf = data.range(of: Data([0x0A, 0x0D, 0x0A]))
            let lf = data.range(of: Data([0x0A, 0x0A]))
            switch (crlf, lf) {
            case let (a?, b?): return a.lowerBound <= b.lowerBound ? a.upperBound : b.upperBound
            case let (a?, nil): return a.upperBound
            case let (nil, b?): return b.upperBound
            default: return nil
            }
        }

        static func httpVersion(_ text: String) -> (major: Int, minor: Int)? {
            guard text.hasPrefix("HTTP/") else { return nil }
            let numbers = text.dropFirst(5).split(separator: ".", omittingEmptySubsequences: false)
            guard numbers.count == 2,
                  numbers.allSatisfy({ !$0.isEmpty && $0.count <= 10 && $0.utf8.allSatisfy { (0x30...0x39).contains($0) } }),
                  let major = Int(numbers[0]), let minor = Int(numbers[1]) else { return nil }
            return (major, minor)
        }

        static func contentLength(_ text: String) -> Int? {
            guard text.count <= 18, text.utf8.allSatisfy({ (0x30...0x39).contains($0) }) else { return nil }
            return Int(text)
        }

        static func hostAllowed(_ header: String?) -> Bool {
            let raw = (header ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if raw.isEmpty { return true }
            let host: Substring
            if raw.hasPrefix("[") {
                if let close = raw.firstIndex(of: "]") {
                    host = raw[raw.index(after: raw.startIndex)..<close]
                } else {
                    host = raw.dropFirst().dropLast()
                }
            } else if raw.filter({ $0 == ":" }).count == 1, let colon = raw.lastIndex(of: ":") {
                host = raw[..<colon]
            } else {
                host = raw[...]
            }
            return ["127.0.0.1", "::1", "localhost"].contains(String(host))
        }

        // Upstream path for a relay request, or nil if it leaves /v1/.
        static func relayTarget(_ path: String) -> String? {
            let prefix = "/__rpt/openai"
            guard path.hasPrefix(prefix + "/") else { return nil }
            let target = String(path.dropFirst(prefix.count))
            let decoded = String(decoding: percentDecoded(target), as: UTF8.self)
            if decoded.split(separator: "/", omittingEmptySubsequences: false).contains("..") { return nil }
            return normpath(decoded).hasPrefix("/v1/") ? target : nil
        }

        static func normpath(_ path: String) -> String {
            if path.isEmpty { return "." }
            var initialSlashes = path.hasPrefix("/") ? 1 : 0
            if path.hasPrefix("//"), !path.hasPrefix("///") { initialSlashes = 2 }
            var components: [Substring] = []
            for component in path.split(separator: "/", omittingEmptySubsequences: false) {
                if component.isEmpty || component == "." { continue }
                if component != ".." || (initialSlashes == 0 && components.isEmpty) || components.last == ".." {
                    components.append(component)
                } else if !components.isEmpty {
                    components.removeLast()
                }
            }
            let result = String(repeating: "/", count: initialSlashes) + components.joined(separator: "/")
            return result.isEmpty ? "." : result
        }

        static func percentDecoded<S: StringProtocol>(_ text: S) -> [UInt8] {
            let source = Array(text.utf8)
            var output: [UInt8] = []
            output.reserveCapacity(source.count)
            var index = 0
            while index < source.count {
                if source[index] == 0x25, index + 2 < source.count, let high = hexValue(source[index + 1]), let low = hexValue(source[index + 2]) {
                    output.append(high << 4 | low)
                    index += 3
                } else {
                    output.append(source[index])
                    index += 1
                }
            }
            return output
        }

        static func hexValue(_ byte: UInt8) -> UInt8? {
            switch byte {
            case 0x30...0x39: return byte - 0x30
            case 0x41...0x46: return byte - 0x41 + 10
            case 0x61...0x66: return byte - 0x61 + 10
            default: return nil
            }
        }

        static func queryParameters(_ query: String) -> [String: String] {
            var result: [String: String] = [:]
            for pair in query.split(separator: "&") {
                let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                let name = formDecoded(parts[0])
                if result[name] == nil { result[name] = parts.count > 1 ? formDecoded(parts[1]) : "" }
            }
            return result
        }

        static func formDecoded(_ text: Substring) -> String {
            String(decoding: percentDecoded(text.replacingOccurrences(of: "+", with: " ")), as: UTF8.self)
        }

        static func fileKind(_ path: String) -> mode_t? {
            var info = stat()
            guard stat(path, &info) == 0 else { return nil }
            return info.st_mode & S_IFMT
        }

        static let mimeTypes: [String: String] = [
            "html": "text/html; charset=utf-8", "htm": "text/html; charset=utf-8", "css": "text/css; charset=utf-8",
            "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8", "json": "application/json",
            "map": "application/json", "txt": "text/plain; charset=utf-8", "md": "text/markdown; charset=utf-8", "xml": "text/xml",
            "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
            "webp": "image/webp", "ico": "image/x-icon", "pdf": "application/pdf", "woff": "font/woff", "woff2": "font/woff2",
            "ttf": "font/ttf", "otf": "font/otf", "wasm": "application/wasm", "webmanifest": "application/manifest+json",
        ]

        static func mimeType(_ path: String) -> String {
            mimeTypes[(path as NSString).pathExtension.lowercased()] ?? "application/octet-stream"
        }

        static let reasonPhrases: [Int: String] = [
            100: "Continue", 200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 206: "Partial Content",
            301: "Moved Permanently", 302: "Found", 303: "See Other", 304: "Not Modified", 307: "Temporary Redirect", 308: "Permanent Redirect",
            400: "Bad Request", 401: "Unauthorized", 402: "Payment Required", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
            406: "Not Acceptable", 408: "Request Timeout", 409: "Conflict", 410: "Gone", 411: "Length Required", 412: "Precondition Failed",
            413: "Content Too Large", 414: "URI Too Long", 415: "Unsupported Media Type", 421: "Misdirected Request", 422: "Unprocessable Content",
            425: "Too Early", 426: "Upgrade Required", 428: "Precondition Required", 429: "Too Many Requests", 431: "Request Header Fields Too Large",
            500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
            505: "HTTP Version Not Supported",
        ]

        static func reasonPhrase(_ status: Int) -> String {
            reasonPhrases[status] ?? ""
        }

        static let errorExplanations: [Int: String] = [
            400: "Bad request syntax or unsupported method",
            404: "Nothing matches the given URI",
            414: "URI is too long",
            421: "Server is not able to produce a response",
            431: "The server is unwilling to process the request because its header fields are too large",
            501: "Server does not support this operation",
            505: "Cannot fulfill request",
        ]

        static let httpDateFormatter: DateFormatter = {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: "GMT")
            formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
            return formatter
        }()

        static func httpDate() -> String {
            httpDateFormatter.string(from: Date())
        }

        static func escapeHTML(_ text: String) -> String {
            text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        }

        static func jsonQuoted(_ text: String) -> String {
            var out = "\""
            for scalar in text.unicodeScalars {
                switch scalar {
                case "\"": out += "\\\""
                case "\\": out += "\\\\"
                case "\n": out += "\\n"
                case "\r": out += "\\r"
                case "\t": out += "\\t"
                default:
                    if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
                }
            }
            return out + "\""
        }
    }

    fileprivate enum CallbackPage {
        static let success = page(title: "로그인 완료", message: "ChatGPT 로그인이 완료되었습니다. 이 탭을 닫고 ‘논문 함께 읽기’ 앱으로 돌아가세요.")
        static let cancelled = page(title: "로그인 취소", message: "ChatGPT 로그인이 취소되었습니다. 앱으로 돌아가 다시 시도해 주세요.")
        static let rejected = page(title: "로그인을 확인할 수 없음", message: "이 로그인 요청을 확인할 수 없습니다. 앱에서 ‘ChatGPT로 계속하기’를 다시 눌러 주세요.")

        private static func page(title: String, message: String) -> String {
            """
            <!doctype html>
            <html lang="ko">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="robots" content="noindex">
            <title>\(title)</title>
            <style>
              :root { color-scheme: light dark; }
              html { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", "Malgun Gothic", "Noto Sans KR", sans-serif; }
              body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f9f9f7; color: #0b0b0b; }
              main { max-width: 440px; padding: 24px; text-align: center; line-height: 1.6; }
              h1 { margin: 0 0 12px; font-size: 22px; }
              p { margin: 0 0 24px; }
              a.button { display: inline-block; padding: 10px 20px; border-radius: 8px; background: #1c5cab; color: #fff; font-weight: 600; text-decoration: none; }
              a.button:focus-visible { outline: 3px solid #86b6ef; outline-offset: 2px; }
              @media (prefers-color-scheme: dark) {
                body { background: #0d0d0d; color: #f0efec; }
                a.button { background: #86b6ef; color: #0d0d0d; }
              }
            </style>
            </head>
            <body>
            <main>
              <h1>\(title)</h1>
              <p>\(message)</p>
              <a class="button" href="readpapertogether://activate">앱으로 돌아가기</a>
            </main>
            </body>
            </html>

            """
        }
    }
}
