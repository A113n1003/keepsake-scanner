// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PhotoScannerNative",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "PhotoScannerNative",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("CoreImage"),
                .linkedFramework("ImageCaptureCore"),
                .linkedFramework("ImageIO"),
                .linkedFramework("UniformTypeIdentifiers"),
                .linkedFramework("Vision")
            ]
        )
    ]
)
