import AppKit

let arguments = Array(CommandLine.arguments.dropFirst())

if let flag = arguments.firstIndex(of: "--serve-only") {
    ServeOnly.run(arguments: Array(arguments[(flag + 1)...]), defaultWebRoot: AppConfig.webRoot, version: AppConfig.version)
}

MainActor.assumeIsolated {
    let selftestPhase = Selftest.Phase(arguments: arguments)
    let app = NSApplication.shared
    if selftestPhase != nil { app.setActivationPolicy(.accessory) }
    let delegate = AppDelegate(selftestPhase: selftestPhase)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
}
