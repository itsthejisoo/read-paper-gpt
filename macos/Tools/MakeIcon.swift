import AppKit
import CoreGraphics

// App icon set generator: MakeIcon <out.iconset> [source.png]
let args = CommandLine.arguments
guard args.count == 2 || args.count == 3 else {
    FileHandle.standardError.write("사용법: MakeIcon <out.iconset> [source.png]\n".data(using: .utf8)!)
    exit(2)
}
let outDir = URL(fileURLWithPath: args[1]).standardizedFileURL

// Finds Resources/AppIcon-source.png above the output folder
func findDefaultSource(from start: URL) -> String? {
    var dir = start.deletingLastPathComponent()
    while dir.path != "/" {
        let candidate = dir.appendingPathComponent("Resources/AppIcon-source.png")
        if FileManager.default.fileExists(atPath: candidate.path) { return candidate.path }
        dir = dir.deletingLastPathComponent()
    }
    return nil
}

guard let sourcePath = args.count == 3 ? args[2] : findDefaultSource(from: outDir) else {
    FileHandle.standardError.write("원본 아이콘 이미지(Resources/AppIcon-source.png)를 찾을 수 없습니다.\n".data(using: .utf8)!)
    exit(1)
}
guard let source = NSImage(contentsOf: URL(fileURLWithPath: sourcePath)),
      let srcCG = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("원본 이미지를 읽을 수 없습니다: \(sourcePath)\n".data(using: .utf8)!)
    exit(1)
}
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

// Renders one icon size
func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    let inset = s * 100 / 1024
    let tile = CGRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
    let radius = tile.width * 0.2237
    let path = CGPath(roundedRect: tile, cornerWidth: radius, cornerHeight: radius, transform: nil)
    if px >= 64 {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -s * 0.012), blur: s * 0.03, color: CGColor(gray: 0, alpha: 0.28))
        ctx.addPath(path); ctx.setFillColor(CGColor(gray: 1, alpha: 1)); ctx.fillPath()
        ctx.restoreGState()
    } else {
        ctx.addPath(path); ctx.setFillColor(CGColor(gray: 1, alpha: 1)); ctx.fillPath()
    }
    ctx.saveGState()
    ctx.addPath(path); ctx.clip()
    ctx.draw(srcCG, in: tile)
    ctx.restoreGState()
    ctx.addPath(path); ctx.setStrokeColor(CGColor(gray: 0, alpha: 0.10)); ctx.setLineWidth(max(1, s / 512)); ctx.strokePath()
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    return rep.representation(using: .png, properties: [:])!
}

for base in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
        try! render(base * scale).write(to: outDir.appendingPathComponent(name))
    }
}
