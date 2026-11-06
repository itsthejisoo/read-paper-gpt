import Foundation

// `--serve-only` mode: runs the local server without a window.
enum ServeOnly {
    private static let usage = "사용법: ReadPaperTogether --serve-only [--port N] [--bind ADDR] [--dir PATH]"

    static func run(arguments: [String], defaultWebRoot: URL?, version: String) -> Never {
        signal(SIGPIPE, SIG_IGN)
        var port = 38765
        var bind = "127.0.0.1"
        var dir: String?
        var index = 0
        while index < arguments.count {
            let argument = arguments[index]
            index += 1
            if argument == "-h" || argument == "--help" {
                emit(usage + "\n논문 함께 읽기 로컬 서버 (정적 파일 + ChatGPT 플랜 호출 중계)\n", to: .standardOutput)
                exit(0)
            }
            var name = argument
            var value: String?
            if argument.hasPrefix("--"), let equals = argument.firstIndex(of: "=") {
                name = String(argument[..<equals])
                value = String(argument[argument.index(after: equals)...])
            }
            guard ["--port", "--bind", "--dir"].contains(name) else { fail("알 수 없는 인자입니다: \(argument)") }
            if value == nil {
                guard index < arguments.count else { fail("\(name) 뒤에 값이 필요합니다.") }
                value = arguments[index]
                index += 1
            }
            let text = value ?? ""
            switch name {
            case "--port":
                guard let number = Int(text), (0...65535).contains(number) else { fail("--port 는 0~65535 사이의 정수여야 합니다: \(text)") }
                port = number
            case "--bind":
                bind = text
            default:
                dir = text
            }
        }

        guard ["127.0.0.1", "::1", "localhost"].contains(bind) else {
            writeError("--bind 는 127.0.0.1, ::1, localhost 만 허용합니다. 토큰이 지나는 서버이므로 외부 접속은 열지 않습니다.")
            exit(2)
        }
        guard let webRoot = dir.map({ URL(fileURLWithPath: $0) }) ?? defaultWebRoot else { fail("--dir 로 제공할 폴더를 지정하세요.") }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: webRoot.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            writeError("--dir 폴더를 찾을 수 없습니다: \(dir ?? webRoot.path)")
            exit(2)
        }
        let configured = ProcessInfo.processInfo.environment["RPT_UPSTREAM"] ?? ""
        guard let upstream = URL(string: configured.isEmpty ? "https://api.openai.com" : configured),
              let scheme = upstream.scheme?.lowercased(), scheme == "http" || scheme == "https", upstream.host != nil else {
            writeError("RPT_UPSTREAM 은 http:// 또는 https:// 로 시작하는 주소여야 합니다.")
            exit(2)
        }
        if bind == "::1" { writeError("참고: 이 서버는 IPv4 루프백만 열 수 있어 127.0.0.1 에서 엽니다.") }

        let stamp = DateFormatter()
        stamp.locale = Locale(identifier: "en_US_POSIX")
        stamp.dateFormat = "dd/MMM/yyyy HH:mm:ss"
        let server = LocalServer(webRoot: webRoot, port: UInt16(port), upstream: upstream, version: version, mode: .serveOnly(log: { line in
            writeError("127.0.0.1 - - [\(stamp.string(from: Date()))] \(line)")
        }))

        let signals = [SIGINT, SIGTERM].map { number -> DispatchSourceSignal in
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler {
                server.stop()
                exit(0)
            }
            source.resume()
            return source
        }

        server.start { result in
            switch result {
            case .success(let actual):
                emit("논문 함께 읽기: http://127.0.0.1:\(actual) 을 브라우저에서 여세요 (종료: Ctrl+C)\n", to: .standardOutput)
            case .failure(let error):
                let reason: String
                switch error as? LocalServerError {
                case .addressInUse?: reason = "다른 프로그램이 이미 사용 중입니다"
                case .other(let text)?: reason = text
                case nil: reason = "\(error)"
                }
                writeError("포트 \(port) 에 서버를 열 수 없습니다 (\(reason)). --port 로 다른 포트를 지정하세요.")
                exit(1)
            }
        }
        withExtendedLifetime((server, signals)) { dispatchMain() }
    }

    private static func fail(_ message: String) -> Never {
        writeError(usage + "\n" + message)
        exit(2)
    }

    private static func writeError(_ line: String) {
        emit(line + "\n", to: .standardError)
    }

    private static func emit(_ text: String, to handle: FileHandle) {
        try? handle.write(contentsOf: Data(text.utf8))
    }
}
