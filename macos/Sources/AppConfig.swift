import Foundation

struct AppConfig {
    static let appName = "논문 함께 읽기"
    static let defaultPort: UInt16 = 38765
    static let bundleIdentifier = Bundle.main.bundleIdentifier ?? ""
    static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    static let webRoot: URL? = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true)

    let port: UInt16
    let dataDirectory: URL
    let exportDirectory: URL
    let upstream: URL

    var webKitDirectory: URL { dataDirectory.appendingPathComponent("WebKit", isDirectory: true) }
    var lockFile: URL { dataDirectory.appendingPathComponent(".lock", isDirectory: false) }
    var windowFile: URL { dataDirectory.appendingPathComponent("window.json", isDirectory: false) }
    var stateFile: URL { dataDirectory.appendingPathComponent("state.json", isDirectory: false) }
    var appURL: URL { URL(string: "http://127.0.0.1:\(port)/")! }

    struct Invalid: Error {
        let message: String
    }

    static func load(environment: [String: String] = ProcessInfo.processInfo.environment) throws -> AppConfig {
        let info = Bundle.main.infoDictionary ?? [:]
        let bundleParent = Bundle.main.bundleURL.deletingLastPathComponent()

        var port = defaultPort
        if let text = nonEmpty(environment["RPT_PORT"]) {
            guard let value = UInt16(text), value > 0 else { throw Invalid(message: "RPT_PORT 는 1~65535 사이의 정수여야 합니다: \(text)") }
            port = value
        } else if let value = info["RPTPort"] as? Int {
            guard (1...65535).contains(value) else { throw Invalid(message: "Info.plist 의 RPTPort 값이 올바르지 않습니다: \(value)") }
            port = UInt16(value)
        }

        let dataDirectory = try directory(environment["RPT_DATA_DIR"], name: "RPT_DATA_DIR", plist: info["RPTDataDirectory"],
                                          fallback: bundleParent.appendingPathComponent("data", isDirectory: true))
        let exportDirectory = try directory(environment["RPT_EXPORT_DIR"], name: "RPT_EXPORT_DIR", plist: info["RPTExportDirectory"],
                                            fallback: bundleParent.appendingPathComponent("exports", isDirectory: true))

        var upstream = URL(string: "https://api.openai.com")!
        if let text = nonEmpty(environment["RPT_UPSTREAM"]) {
            guard let url = URL(string: text), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", url.host != nil else {
                throw Invalid(message: "RPT_UPSTREAM 은 http:// 또는 https:// 로 시작하는 주소여야 합니다.")
            }
            upstream = url
        }
        return AppConfig(port: port, dataDirectory: dataDirectory, exportDirectory: exportDirectory, upstream: upstream)
    }

    private static func directory(_ override: String?, name: String, plist: Any?, fallback: URL) throws -> URL {
        if let path = nonEmpty(override) {
            guard path.hasPrefix("/") else { throw Invalid(message: "\(name) 는 절대 경로여야 합니다: \(path)") }
            return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        }
        if let path = nonEmpty(plist as? String), path.hasPrefix("/") {
            return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        }
        return fallback.standardizedFileURL
    }

    private static func nonEmpty(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }

    static func unmountedVolume(containing url: URL) -> String? {
        let parts = url.standardizedFileURL.pathComponents
        guard parts.count >= 3, parts[0] == "/", parts[1] == "Volumes" else { return nil }
        let mountPoint = "/Volumes/" + parts[2]
        var link = stat()
        if lstat(mountPoint, &link) == 0, (link.st_mode & S_IFMT) == S_IFLNK {
            return FileManager.default.fileExists(atPath: mountPoint) ? nil : parts[2]
        }
        var info = statfs()
        guard statfs(mountPoint, &info) == 0 else { return parts[2] }
        let mountedOn = withUnsafeBytes(of: &info.f_mntonname) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        return mountedOn == mountPoint ? nil : parts[2]
    }
}

func writeStandardError(_ line: String) {
    try? FileHandle.standardError.write(contentsOf: Data((line + "\n").utf8))
}
