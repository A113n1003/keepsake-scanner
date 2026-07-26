import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
@preconcurrency import ImageCaptureCore
import ImageIO
import UniformTypeIdentifiers
import Vision

private let usesChinese: Bool = {
    let arguments = CommandLine.arguments
    if let localeIndex = arguments.firstIndex(of: "--locale"),
       arguments.indices.contains(localeIndex + 1) {
        return arguments[localeIndex + 1].lowercased().hasPrefix("zh")
    }
    return Locale.current.identifier.lowercased().hasPrefix("zh")
}()

func localized(_ chinese: String, _ english: String) -> String {
    usesChinese ? chinese : english
}

struct ScannerInfo: Codable {
    let id: String
    let name: String
    let transport: String
    let location: String
}

struct NormalizedRect: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct CropResult: Codable {
    let path: String
    let width: Int
    let height: Int
    let bounds: NormalizedRect
    let confidence: Float
}

struct ScanResult: Codable {
    let path: String
}

struct CommandResult: Codable {
    let ok: Bool
}

struct ProgressEvent: Encodable {
    let type = "progress"
    let stage: String
    let progress: Double
    let message: String
}

enum ProcessingMode: String {
    case fast
    case standard
    case archive

    var analysisMaximumDimension: CGFloat {
        switch self {
        case .fast: return 720
        case .standard: return 960
        case .archive: return 1_400
        }
    }
}

enum NativeError: LocalizedError {
    case usage(String)
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .usage(let value), .failed(let value):
            return value
        }
    }
}

private let jsonEncoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    return encoder
}()

func printJSON<T: Encodable>(_ value: T) {
    guard let data = try? jsonEncoder.encode(value),
          let string = String(data: data, encoding: .utf8) else { return }
    print(string)
    fflush(stdout)
}

func printErrorAndExit(_ error: Error) -> Never {
    let escaped = error.localizedDescription
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: " ")
    fputs("{\"type\":\"error\",\"message\":\"\(escaped)\"}\n", stderr)
    exit(1)
}

private let scannerBrowserMask = ICDeviceTypeMask(
    rawValue: ICDeviceTypeMask.scanner.rawValue
        | ICDeviceLocationTypeMask.local.rawValue
        | ICDeviceLocationTypeMask.remote.rawValue
)!

final class ScannerBrowserDelegate: NSObject, ICDeviceBrowserDelegate {
    private(set) var scanners: [ICScannerDevice] = []
    var onScanner: ((ICScannerDevice) -> Void)?

    func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        guard let scanner = device as? ICScannerDevice else { return }
        let scannerID = scanner.uuidString ?? scanner.name ?? ""
        guard !scanners.contains(where: {
            ($0.uuidString ?? $0.name ?? "") == scannerID
        }) else { return }
        scanners.append(scanner)
        onScanner?(scanner)
    }

    func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        scanners.removeAll { $0.uuidString == device.uuidString }
    }
}

@MainActor
func discoverScanners(duration: TimeInterval = 4.0) async -> [ScannerInfo] {
    let delegate = ScannerBrowserDelegate()
    let browser = ICDeviceBrowser()
    browser.delegate = delegate
    browser.browsedDeviceTypeMask = scannerBrowserMask
    browser.start()
    try? await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
    browser.stop()
    return delegate.scanners.map {
        ScannerInfo(
            id: $0.uuidString ?? $0.name ?? "unknown-scanner",
            name: $0.name ?? localized("未命名扫描仪", "Unnamed scanner"),
            transport: $0.transportType ?? "",
            location: $0.locationDescription ?? ""
        )
    }
}

@MainActor
final class ScannerSession: NSObject, @preconcurrency ICDeviceBrowserDelegate, @preconcurrency ICScannerDeviceDelegate {
    private let browser = ICDeviceBrowser()
    private let deviceID: String
    private let dpi: Int
    private let colorMode: String
    private let outputDirectory: URL
    private var scanner: ICScannerDevice?
    private var scannedURL: URL?
    private var scanCompleted = false
    private var configured = false
    private var openAttempts = 0
    private var zeroProgressTicks = 0
    private var progressTimer: Timer?
    private var timeoutTask: Task<Void, Never>?
    private var openRetryTask: Task<Void, Never>?
    private var readinessTask: Task<Void, Never>?
    private var closeTimeoutTask: Task<Void, Never>?
    private var resultAwaitingClose: Result<URL, any Error>?
    private var continuation: CheckedContinuation<URL, any Error>?

    init(deviceID: String, dpi: Int, colorMode: String, outputDirectory: URL) {
        self.deviceID = deviceID
        self.dpi = dpi
        self.colorMode = colorMode
        self.outputDirectory = outputDirectory
        super.init()
        browser.delegate = self
        browser.browsedDeviceTypeMask = scannerBrowserMask
    }

    func run(timeout: TimeInterval = 600) async throws -> URL {
        try FileManager.default.createDirectory(
            at: outputDirectory,
            withIntermediateDirectories: true
        )
        printJSON(ProgressEvent(
            stage: "connecting",
            progress: 0.04,
            message: localized("正在连接扫描仪…", "Connecting to the scanner…")
        ))
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            browser.start()
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                guard !Task.isCancelled else { return }
                self?.scanner?.cancelScan()
                self?.finishAfterClosing(.failure(
                    NativeError.failed(localized(
                        "扫描超时，请检查扫描仪连接后重试。",
                        "The scan timed out. Check the scanner connection and try again."
                    ))
                ))
            }
        }
    }

    func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        guard scanner == nil, let candidate = device as? ICScannerDevice else { return }
        let candidateID = candidate.uuidString ?? candidate.name ?? ""
        guard candidateID == deviceID || deviceID.isEmpty else { return }
        scanner = candidate
        candidate.delegate = self
        printJSON(ProgressEvent(
            stage: "opening",
            progress: 0.08,
            message: localized("正在打开扫描会话…", "Opening the scan session…")
        ))
        requestOpenSession(candidate)
    }

    func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        guard device.uuidString == scanner?.uuidString else { return }
        completeNow(.failure(NativeError.failed(localized(
            "扫描过程中设备已断开。",
            "The scanner disconnected during the scan."
        ))))
    }

    func device(_ device: ICDevice, didOpenSessionWithError error: (any Error)?) {
        if let error {
            guard let scanner = device as? ICScannerDevice else {
                completeNow(.failure(contextualError(
                    localized("打开扫描会话", "Open scan session"),
                    error
                )))
                return
            }
            if isBusyError(error), openAttempts < 6 {
                printJSON(ProgressEvent(
                    stage: "waiting",
                    progress: 0.08,
                    message: localized(
                        "扫描仪暂时被占用，正在等待释放…",
                        "The scanner is busy. Waiting for it to become available…"
                    )
                ))
                scheduleOpenRetry(scanner)
                return
            }
            completeNow(.failure(contextualError(
                localized("打开扫描会话", "Open scan session"),
                error
            )))
            return
        }
        guard let scanner = device as? ICScannerDevice else {
            completeNow(.failure(NativeError.failed(localized(
                "连接的设备不是扫描仪。",
                "The connected device is not a scanner."
            ))))
            return
        }
        openRetryTask?.cancel()
        openRetryTask = nil
        printJSON(ProgressEvent(
            stage: "configuring",
            progress: 0.12,
            message: localized("正在应用扫描设置…", "Applying scan settings…")
        ))

        let selectedUnit = scanner.selectedFunctionalUnit
        if selectedUnit.type == .flatbed {
            waitUntilReadyAndStart(scanner, functionalUnit: selectedUnit)
            return
        }

        let flatbedValue = NSNumber(value: ICScannerFunctionalUnitType.flatbed.rawValue)
        if scanner.availableFunctionalUnitTypes.contains(flatbedValue) {
            scanner.requestSelect(.flatbed)
        } else {
            waitUntilReadyAndStart(scanner, functionalUnit: selectedUnit)
        }
    }

    func device(_ device: ICDevice, didCloseSessionWithError error: (any Error)?) {
        guard let result = resultAwaitingClose else {
            if let error, continuation != nil {
                completeNow(.failure(contextualError(
                    localized("关闭扫描会话", "Close scan session"),
                    error
                )))
            }
            return
        }
        resultAwaitingClose = nil
        closeTimeoutTask?.cancel()
        closeTimeoutTask = nil
        if let error {
            completeNow(.failure(contextualError(
                localized("关闭扫描会话", "Close scan session"),
                error
            )))
        } else {
            completeNow(result)
        }
    }

    func didRemove(_ device: ICDevice) {
        if device.uuidString == scanner?.uuidString {
            completeNow(.failure(NativeError.failed(localized(
                "扫描仪已从系统中移除。",
                "The scanner was removed from the system."
            ))))
        }
    }

    func scannerDeviceDidBecomeAvailable(_ scanner: ICScannerDevice) {
        guard continuation != nil, !scanner.hasOpenSession else { return }
        openRetryTask?.cancel()
        openRetryTask = nil
        printJSON(ProgressEvent(
            stage: "opening",
            progress: 0.09,
            message: localized(
                "扫描仪已释放，正在重新连接…",
                "The scanner is available. Reconnecting…"
            )
        ))
        requestOpenSession(scanner)
    }

    func scannerDevice(
        _ scanner: ICScannerDevice,
        didSelect functionalUnit: ICScannerFunctionalUnit,
        error: (any Error)?
    ) {
        if let error {
            completeNow(.failure(contextualError(
                localized("选择扫描区域", "Select scan area"),
                error
            )))
            return
        }
        waitUntilReadyAndStart(scanner, functionalUnit: functionalUnit)
    }

    private func waitUntilReadyAndStart(
        _ scanner: ICScannerDevice,
        functionalUnit: ICScannerFunctionalUnit
    ) {
        readinessTask?.cancel()
        printJSON(ProgressEvent(
            stage: "warming",
            progress: 0.12,
            message: localized(
                "扫描仪正在预热，等待设备就绪…",
                "The scanner is warming up…"
            )
        ))
        readinessTask = Task { [weak self, weak scanner, weak functionalUnit] in
            guard let self, let scanner, let functionalUnit else { return }
            for attempt in 0..<120 {
                guard !Task.isCancelled, self.continuation != nil else { return }
                if functionalUnit.state == .ready {
                    self.readinessTask = nil
                    self.configureAndStartScan(scanner, functionalUnit: functionalUnit)
                    return
                }
                if attempt > 0, attempt.isMultiple(of: 20) {
                    printJSON(ProgressEvent(
                        stage: "warming",
                        progress: 0.13,
                        message: localized(
                            "扫描仪正在准备 \(self.dpi) dpi 扫描…",
                            "Preparing a \(self.dpi) dpi scan…"
                        )
                    ))
                }
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
            self.readinessTask = nil
            self.finishAfterClosing(.failure(
                NativeError.failed(localized(
                    "扫描仪在 30 秒内未进入就绪状态。请确认设备面板没有报错，然后刷新设备重试。",
                    "The scanner was not ready within 30 seconds. Check its control panel, refresh the device list, and try again."
                ))
            ))
        }
    }

    private func configureAndStartScan(
        _ scanner: ICScannerDevice,
        functionalUnit: ICScannerFunctionalUnit
    ) {
        guard !configured, continuation != nil else { return }
        configured = true

        if let chosenResolution = nearestValue(to: dpi, in: functionalUnit.supportedResolutions) {
            functionalUnit.resolution = chosenResolution
        }
        if functionalUnit.supportedBitDepths.contains(8),
           let bitDepth = ICScannerBitDepth(rawValue: 8) {
            functionalUnit.bitDepth = bitDepth
        }
        functionalUnit.pixelDataType = colorMode == "gray" ? .gray : .RGB
        if let scaleFactor = nearestValue(to: 100, in: functionalUnit.supportedScaleFactors) {
            functionalUnit.scaleFactor = scaleFactor
        }
        if functionalUnit.physicalSize.width > 0, functionalUnit.physicalSize.height > 0 {
            functionalUnit.scanArea = NSRect(origin: .zero, size: functionalUnit.physicalSize)
        }

        scanner.transferMode = .fileBased
        scanner.downloadsDirectory = outputDirectory
        scanner.documentName = "fullbed"
        scanner.documentUTI = UTType.jpeg.identifier

        zeroProgressTicks = 0
        printJSON(ProgressEvent(
            stage: "starting",
            progress: 0.14,
            message: localized(
                "设备已就绪，正在启动 \(functionalUnit.resolution) dpi 扫描…",
                "The scanner is ready. Starting a \(functionalUnit.resolution) dpi scan…"
            )
        ))
        progressTimer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let unit = self.scanner?.selectedFunctionalUnit else { return }
                let percent = Double(unit.scanProgressPercentDone)
                let normalized = percent > 1 ? percent / 100 : percent
                if normalized <= 0 {
                    self.zeroProgressTicks += 1
                    if self.zeroProgressTicks >= 130 {
                        self.scanner?.cancelScan()
                        self.finishAfterClosing(.failure(
                            NativeError.failed(
                                localized(
                                    "扫描仪已就绪，但扫描头在 45 秒内没有启动。请改用标准模式，并检查设备面板后重试。",
                                    "The scanner was ready, but its head did not start within 45 seconds. Try Standard mode and check the scanner control panel."
                                )
                            )
                        ))
                        return
                    }
                    let message = self.zeroProgressTicks < 30
                        ? localized(
                            "扫描仪正在校准并移动扫描头…",
                            "The scanner is calibrating and moving the scan head…"
                        )
                        : localized(
                            "正在准备高分辨率图像，请稍候…",
                            "Preparing the high-resolution image…"
                        )
                    printJSON(ProgressEvent(
                        stage: "starting",
                        progress: 0.14,
                        message: message
                    ))
                    return
                }
                printJSON(ProgressEvent(
                    stage: "scanning",
                    progress: min(0.88, 0.15 + normalized * 0.73),
                    message: localized(
                        "正在扫描… \(Int(normalized * 100))%",
                        "Scanning… \(Int(normalized * 100))%"
                    )
                ))
            }
        }
        scanner.requestScan()
    }

    func scannerDevice(_ scanner: ICScannerDevice, didScanTo url: URL) {
        scannedURL = url
        if scanCompleted {
            finishAfterClosing(.success(url))
        }
    }

    func scannerDevice(_ scanner: ICScannerDevice, didCompleteScanWithError error: (any Error)?) {
        progressTimer?.invalidate()
        scanCompleted = true
        if let error {
            finishAfterClosing(.failure(contextualError(
                localized("执行扫描", "Perform scan"),
                error
            )))
        } else if let scannedURL {
            printJSON(ProgressEvent(
                stage: "processing",
                progress: 0.9,
                message: localized(
                    "扫描完成，正在检测照片…",
                    "Scan complete. Detecting photos…"
                )
            ))
            finishAfterClosing(.success(scannedURL))
        } else {
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard let self else { return }
                if let scannedURL = self.scannedURL {
                    self.finishAfterClosing(.success(scannedURL))
                } else {
                    self.finishAfterClosing(.failure(
                        NativeError.failed(localized(
                            "扫描结束，但系统没有返回图像文件。",
                            "The scan finished, but the system returned no image file."
                        ))
                    ))
                }
            }
        }
    }

    private func nearestValue(to requested: Int, in set: IndexSet) -> Int? {
        let values = set.map { $0 }
        return values.min { abs($0 - requested) < abs($1 - requested) }
    }

    private func requestOpenSession(_ scanner: ICScannerDevice) {
        guard continuation != nil else { return }
        openAttempts += 1
        scanner.requestOpenSession()
    }

    private func scheduleOpenRetry(_ scanner: ICScannerDevice) {
        openRetryTask?.cancel()
        openRetryTask = Task { [weak self, weak scanner] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled, let self, let scanner, self.continuation != nil else { return }
            self.requestOpenSession(scanner)
        }
    }

    private func finishAfterClosing(_ result: Result<URL, any Error>) {
        guard continuation != nil, resultAwaitingClose == nil else { return }
        timeoutTask?.cancel()
        timeoutTask = nil
        progressTimer?.invalidate()
        progressTimer = nil

        guard let scanner, scanner.hasOpenSession else {
            completeNow(result)
            return
        }

        resultAwaitingClose = result
        printJSON(ProgressEvent(
            stage: "closing",
            progress: 0.91,
            message: localized("正在释放扫描仪…", "Releasing the scanner…")
        ))
        closeTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard !Task.isCancelled, let self, let pendingResult = self.resultAwaitingClose else { return }
            self.resultAwaitingClose = nil
            self.completeNow(pendingResult)
        }
        scanner.requestCloseSession()
    }

    private func isBusyError(_ error: Error) -> Bool {
        let code = (error as NSError).code
        return code == -47 || code == 4_294_967_249
    }

    private func contextualError(_ stage: String, _ error: Error) -> NativeError {
        let nsError = error as NSError
        let code = nsError.code
        if code == -47 || code == 4_294_967_249 {
            return .failed(localized(
                "\(stage)失败：扫描仪正在被其他程序占用，请关闭其他扫描软件后重试。",
                "\(stage) failed: another application is using the scanner. Close other scanning software and try again."
            ))
        }
        if code == -9922 {
            return .failed(localized(
                "\(stage)失败：扫描仪拒绝了当前参数。请刷新设备后重试。",
                "\(stage) failed: the scanner rejected the current settings. Refresh the device list and try again."
            ))
        }
        return .failed(localized(
            "\(stage)失败：\(error.localizedDescription)",
            "\(stage) failed: \(error.localizedDescription)"
        ))
    }

    private func completeNow(_ result: Result<URL, any Error>) {
        guard let continuation else { return }
        self.continuation = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        openRetryTask?.cancel()
        openRetryTask = nil
        readinessTask?.cancel()
        readinessTask = nil
        closeTimeoutTask?.cancel()
        closeTimeoutTask = nil
        progressTimer?.invalidate()
        progressTimer = nil
        browser.stop()
        switch result {
        case .success(let url):
            continuation.resume(returning: url)
        case .failure(let error):
            continuation.resume(throwing: error)
        }
    }
}

func overlap(_ first: CGRect, _ second: CGRect) -> Double {
    let intersection = first.intersection(second)
    if intersection.isNull || intersection.isEmpty { return 0 }
    let intersectionArea = intersection.width * intersection.height
    let unionArea = first.width * first.height + second.width * second.height - intersectionArea
    return unionArea > 0 ? intersectionArea / unionArea : 0
}

func rectangleObservation(forBottomLeftBox box: CGRect) -> VNRectangleObservation {
    let minX = box.minX
    let maxX = box.maxX
    let topY = box.maxY
    let bottomY = box.minY
    return VNRectangleObservation(
        requestRevision: VNDetectRectanglesRequest.currentRevision,
        topLeft: CGPoint(x: minX, y: topY),
        bottomLeft: CGPoint(x: minX, y: bottomY),
        bottomRight: CGPoint(x: maxX, y: bottomY),
        topRight: CGPoint(x: maxX, y: topY)
    )
}

func detectPhotosOnLightBackground(in inputURL: URL) -> [VNRectangleObservation] {
    guard let inputImage = CIImage(contentsOf: inputURL, options: [.applyOrientationProperty: true]) else {
        return []
    }

    let sourceExtent = inputImage.extent
    let maximumDimension: CGFloat = 1_200
    let scale = min(1, maximumDimension / max(sourceExtent.width, sourceExtent.height))
    let normalizedImage = inputImage
        .transformed(by: CGAffineTransform(
            translationX: -sourceExtent.minX,
            y: -sourceExtent.minY
        ))
        .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let renderContext = CIContext(options: [.useSoftwareRenderer: true])
    guard let rendered = renderContext.createCGImage(
        normalizedImage,
        from: normalizedImage.extent
    ) else {
        return []
    }

    let width = rendered.width
    let height = rendered.height
    let bytesPerRow = width * 4
    var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)
    guard let bitmapContext = CGContext(
        data: &pixels,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        return []
    }
    bitmapContext.translateBy(x: 0, y: CGFloat(height))
    bitmapContext.scaleBy(x: 1, y: -1)
    bitmapContext.draw(rendered, in: CGRect(x: 0, y: 0, width: width, height: height))

    let cellSize = 6
    let gridWidth = (width + cellSize - 1) / cellSize
    let gridHeight = (height + cellSize - 1) / cellSize
    var occupied = [Bool](repeating: false, count: gridWidth * gridHeight)

    for gridY in 0..<gridHeight {
        for gridX in 0..<gridWidth {
            let startX = gridX * cellSize
            let startY = gridY * cellSize
            let endX = min(width, startX + cellSize)
            let endY = min(height, startY + cellSize)
            let sampleCount = max(1, (endX - startX) * (endY - startY))
            var foregroundCount = 0
            for y in startY..<endY {
                for x in startX..<endX {
                    let offset = y * bytesPerRow + x * 4
                    let red = pixels[offset]
                    let green = pixels[offset + 1]
                    let blue = pixels[offset + 2]
                    if red < 242 || green < 242 || blue < 242 {
                        foregroundCount += 1
                    }
                }
            }
            occupied[gridY * gridWidth + gridX] = foregroundCount >= max(2, sampleCount / 12)
        }
    }

    // Scanner lids and glass edges often create a dark one-pixel rail that connects
    // otherwise separate photos touching the outer edge. Remove a narrow analysis
    // border; the padding below restores those photo bounds to the image edge.
    let ignoredBorder = 2
    if gridWidth > ignoredBorder * 2, gridHeight > ignoredBorder * 2 {
        for gridY in 0..<gridHeight {
            for gridX in 0..<gridWidth where
                gridX < ignoredBorder
                || gridX >= gridWidth - ignoredBorder
                || gridY < ignoredBorder
                || gridY >= gridHeight - ignoredBorder {
                occupied[gridY * gridWidth + gridX] = false
            }
        }
    }

    let neighbors = [
        (-1, -1), (0, -1), (1, -1),
        (-1, 0),            (1, 0),
        (-1, 1),  (0, 1),   (1, 1)
    ]
    var visited = [Bool](repeating: false, count: occupied.count)
    var boxes: [CGRect] = []

    for originY in 0..<gridHeight {
        for originX in 0..<gridWidth {
            let originIndex = originY * gridWidth + originX
            guard occupied[originIndex], !visited[originIndex] else { continue }

            var queue: [(Int, Int)] = [(originX, originY)]
            visited[originIndex] = true
            var cursor = 0
            var minX = originX
            var maxX = originX
            var minY = originY
            var maxY = originY
            var occupiedCells = 0

            while cursor < queue.count {
                let (x, y) = queue[cursor]
                cursor += 1
                occupiedCells += 1
                minX = min(minX, x)
                maxX = max(maxX, x)
                minY = min(minY, y)
                maxY = max(maxY, y)

                for (dx, dy) in neighbors {
                    let nextX = x + dx
                    let nextY = y + dy
                    guard nextX >= 0, nextX < gridWidth,
                          nextY >= 0, nextY < gridHeight else { continue }
                    let nextIndex = nextY * gridWidth + nextX
                    guard occupied[nextIndex], !visited[nextIndex] else { continue }
                    visited[nextIndex] = true
                    queue.append((nextX, nextY))
                }
            }

            let componentWidth = maxX - minX + 1
            let componentHeight = maxY - minY + 1
            let componentArea = componentWidth * componentHeight
            let widthRatio = Double(componentWidth) / Double(gridWidth)
            let heightRatio = Double(componentHeight) / Double(gridHeight)
            let areaRatio = widthRatio * heightRatio
            let density = Double(occupiedCells) / Double(componentArea)
            guard widthRatio >= 0.045,
                  heightRatio >= 0.045,
                  areaRatio >= 0.006,
                  areaRatio <= 0.82,
                  density >= 0.10 else {
                continue
            }

            let padding = 2
            let paddedMinX = max(0, minX - padding)
            let paddedMinY = max(0, minY - padding)
            let paddedMaxX = min(gridWidth - 1, maxX + padding)
            let paddedMaxY = min(gridHeight - 1, maxY + padding)
            boxes.append(CGRect(
                x: Double(paddedMinX) / Double(gridWidth),
                y: Double(paddedMinY) / Double(gridHeight),
                width: Double(paddedMaxX - paddedMinX + 1) / Double(gridWidth),
                height: Double(paddedMaxY - paddedMinY + 1) / Double(gridHeight)
            ))
        }
    }

    return boxes
        .sorted {
            if abs($0.maxY - $1.maxY) > 0.06 {
                return $0.maxY > $1.maxY
            }
            return $0.minX < $1.minX
        }
        .map(rectangleObservation)
}

func detectRectangles(in inputURL: URL) throws -> [VNRectangleObservation] {
    let backgroundObservations = detectPhotosOnLightBackground(in: inputURL)
    if !backgroundObservations.isEmpty {
        return backgroundObservations
    }

    let request = VNDetectRectanglesRequest()
    request.maximumObservations = 20
    request.minimumConfidence = 0.45
    request.minimumAspectRatio = 0.28
    request.maximumAspectRatio = 1.0
    request.minimumSize = 0.075
    request.quadratureTolerance = 35

    let handler = VNImageRequestHandler(url: inputURL, options: [:])
    try handler.perform([request])
    let observations = (request.results ?? []).sorted {
        let firstArea = $0.boundingBox.width * $0.boundingBox.height
        let secondArea = $1.boundingBox.width * $1.boundingBox.height
        return firstArea > secondArea
    }

    var accepted: [VNRectangleObservation] = []
    for observation in observations {
        let candidate = observation.boundingBox
        let candidateArea = candidate.width * candidate.height
        if candidateArea > 0.88 { continue }
        let duplicatesExisting = accepted.contains { existing in
            let intersection = existing.boundingBox.intersection(candidate)
            let containedFraction = intersection.isNull ? 0 : (
                intersection.width * intersection.height / candidateArea
            )
            return containedFraction > 0.76 || overlap(existing.boundingBox, candidate) > 0.58
        }
        if !duplicatesExisting {
            accepted.append(observation)
        }
    }

    return accepted.sorted {
        if abs($0.boundingBox.maxY - $1.boundingBox.maxY) > 0.06 {
            return $0.boundingBox.maxY > $1.boundingBox.maxY
        }
        return $0.boundingBox.minX < $1.boundingBox.minX
    }
}

func sourceProperties(_ url: URL) -> [CFString: Any] {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let dictionary = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
        return [:]
    }
    return dictionary
}

func writeJPEG(_ image: CGImage, to url: URL, properties: [CFString: Any] = [:]) throws {
    guard let destination = CGImageDestinationCreateWithURL(
        url as CFURL,
        UTType.jpeg.identifier as CFString,
        1,
        nil
    ) else {
        throw NativeError.failed(localized(
            "无法创建 JPEG 文件：\(url.lastPathComponent)",
            "Could not create JPEG file: \(url.lastPathComponent)"
        ))
    }
    var merged = properties
    merged[kCGImageDestinationLossyCompressionQuality] = 0.96
    CGImageDestinationAddImage(destination, image, merged as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
        throw NativeError.failed(localized(
            "无法写入 JPEG 文件：\(url.lastPathComponent)",
            "Could not write JPEG file: \(url.lastPathComponent)"
        ))
    }
}

private struct PhotoOrientationCandidate {
    let exifOrientation: Int32
    let score: Double
    let evidenceCount: Int
    let textEvidenceCount: Int
}

func orientationAnalysisImage(
    from image: CGImage,
    maximumDimension: CGFloat,
    context: CIContext
) -> CGImage {
    let sourceMaximum = CGFloat(max(image.width, image.height))
    guard sourceMaximum > maximumDimension else { return image }
    let scale = maximumDimension / sourceMaximum
    let scaled = CIImage(cgImage: image).transformed(
        by: CGAffineTransform(scaleX: scale, y: scale)
    )
    return context.createCGImage(scaled, from: scaled.extent) ?? image
}

func applyingOrientation(
    _ exifOrientation: Int32,
    to image: CGImage,
    context: CIContext
) -> CGImage {
    guard exifOrientation != 1 else { return image }
    let oriented = CIImage(cgImage: image).oriented(forExifOrientation: exifOrientation)
    return context.createCGImage(oriented, from: oriented.extent) ?? image
}

func automaticallyOrientPhoto(
    _ image: CGImage,
    context: CIContext,
    mode: ProcessingMode
) -> CGImage {
    let orientations: [(CGImagePropertyOrientation, Int32)] = [
        (.up, 1),
        (.right, 6),
        (.down, 3),
        (.left, 8)
    ]
    let analysisImage = orientationAnalysisImage(
        from: image,
        maximumDimension: mode.analysisMaximumDimension,
        context: context
    )

    var candidates = orientations.map { orientation, exifValue -> PhotoOrientationCandidate in
        let faceRequest = VNDetectFaceLandmarksRequest()
        let faceHandler = VNImageRequestHandler(
            cgImage: analysisImage,
            orientation: orientation,
            options: [:]
        )
        try? faceHandler.perform([faceRequest])
        let faces = faceRequest.results ?? []
        let landmarkScores = faces.compactMap { face -> Double? in
            guard let leftEye = face.landmarks?.leftEye?.normalizedPoints,
                  let rightEye = face.landmarks?.rightEye?.normalizedPoints,
                  let mouth = face.landmarks?.outerLips?.normalizedPoints,
                  !leftEye.isEmpty,
                  !rightEye.isEmpty,
                  !mouth.isEmpty else {
                return nil
            }
            let eyePoints = leftEye + rightEye
            let eyeCenter = eyePoints.reduce(CGPoint.zero) { partial, point in
                CGPoint(x: partial.x + point.x, y: partial.y + point.y)
            }
            let mouthCenter = mouth.reduce(CGPoint.zero) { partial, point in
                CGPoint(x: partial.x + point.x, y: partial.y + point.y)
            }
            let normalizedEyeCenter = CGPoint(
                x: eyeCenter.x / CGFloat(eyePoints.count),
                y: eyeCenter.y / CGFloat(eyePoints.count)
            )
            let normalizedMouthCenter = CGPoint(
                x: mouthCenter.x / CGFloat(mouth.count),
                y: mouthCenter.y / CGFloat(mouth.count)
            )
            let deltaX = Double(normalizedEyeCenter.x - normalizedMouthCenter.x)
            let deltaY = Double(normalizedEyeCenter.y - normalizedMouthCenter.y)
            return (deltaY - abs(deltaX) * 0.7) * Double(face.confidence)
        }
        let faceScore = landmarkScores.isEmpty
            ? 0
            : landmarkScores.reduce(0, +) / Double(landmarkScores.count) * 100.0

        return PhotoOrientationCandidate(
            exifOrientation: exifValue,
            score: faceScore,
            evidenceCount: landmarkScores.count,
            textEvidenceCount: 0
        )
    }

    let faceRanking = candidates.sorted { $0.score > $1.score }
    if let bestFace = faceRanking.first,
       faceRanking.count > 1,
       bestFace.evidenceCount > 0,
       bestFace.score > faceRanking[1].score + 8.0 {
        return applyingOrientation(bestFace.exifOrientation, to: image, context: context)
    }

    let faceCandidates = candidates
    candidates = zip(candidates, orientations).map {
        candidate,
        orientationPair -> PhotoOrientationCandidate in
        let (orientation, _) = orientationPair
        let textRequest = VNRecognizeTextRequest()
        textRequest.recognitionLevel = .fast
        textRequest.usesLanguageCorrection = false
        textRequest.minimumTextHeight = 0.025
        let textHandler = VNImageRequestHandler(
            cgImage: analysisImage,
            orientation: orientation,
            options: [:]
        )
        try? textHandler.perform([textRequest])
        let recognizedText = (textRequest.results ?? []).compactMap { observation in
            observation.topCandidates(1).first.flatMap {
                $0.confidence >= 0.35 ? $0 : nil
            }
        }
        let textScore = recognizedText.reduce(0.0) { partial, recognized in
            partial + 5.0 + Double(recognized.confidence) * 3.0
        }
        return PhotoOrientationCandidate(
            exifOrientation: candidate.exifOrientation,
            score: candidate.score + textScore,
            evidenceCount: candidate.evidenceCount + recognizedText.count,
            textEvidenceCount: recognizedText.count
        )
    }

    if let upright = candidates.first,
       let best = candidates.max(by: { $0.score < $1.score }),
       best.exifOrientation != 1,
       best.textEvidenceCount >= 2,
       best.score > upright.score + 8.0 {
        return applyingOrientation(best.exifOrientation, to: image, context: context)
    }

    if let uprightFace = faceCandidates.first,
       let bestFace = faceCandidates.max(by: { $0.score < $1.score }),
       bestFace.exifOrientation != 1,
       bestFace.evidenceCount > 0,
       bestFace.score > uprightFace.score + 4.0 {
        return applyingOrientation(bestFace.exifOrientation, to: image, context: context)
    }

    return image
}

func separatePhotos(
    inputURL: URL,
    outputDirectory: URL,
    mode: ProcessingMode = .standard
) throws -> [CropResult] {
    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    guard let inputImage = CIImage(contentsOf: inputURL, options: [.applyOrientationProperty: true]) else {
        throw NativeError.failed(localized(
            "无法读取待分离的图像。",
            "Could not read the image to be separated."
        ))
    }
    let context = CIContext(options: [.useSoftwareRenderer: false])
    var rectangles = try detectRectangles(in: inputURL)

    if rectangles.isEmpty {
        let full = VNRectangleObservation(
            requestRevision: VNDetectRectanglesRequest.currentRevision,
            topLeft: CGPoint(x: 0, y: 1),
            bottomLeft: CGPoint(x: 0, y: 0),
            bottomRight: CGPoint(x: 1, y: 0),
            topRight: CGPoint(x: 1, y: 1)
        )
        rectangles = [full]
    }

    let extent = inputImage.extent
    func convert(_ point: CGPoint) -> CGPoint {
        CGPoint(
            x: extent.minX + point.x * extent.width,
            y: extent.minY + point.y * extent.height
        )
    }

    var results: [CropResult] = []
    for (index, rectangle) in rectangles.enumerated() {
        let filter = CIFilter.perspectiveCorrection()
        filter.inputImage = inputImage
        filter.topLeft = convert(rectangle.topLeft)
        filter.topRight = convert(rectangle.topRight)
        filter.bottomLeft = convert(rectangle.bottomLeft)
        filter.bottomRight = convert(rectangle.bottomRight)
        guard let corrected = filter.outputImage,
              let cgImage = context.createCGImage(corrected, from: corrected.extent) else {
            continue
        }
        let outputURL = outputDirectory.appendingPathComponent(
            String(format: "crop_%03d.jpg", index + 1)
        )
        let orientedImage = automaticallyOrientPhoto(cgImage, context: context, mode: mode)
        try writeJPEG(orientedImage, to: outputURL)
        let box = rectangle.boundingBox
        results.append(CropResult(
            path: outputURL.path,
            width: orientedImage.width,
            height: orientedImage.height,
            bounds: NormalizedRect(
                x: box.minX,
                y: box.minY,
                width: box.width,
                height: box.height
            ),
            confidence: rectangle.confidence
        ))
        printJSON(ProgressEvent(
            stage: "processing",
            progress: 0.92 + Double(index + 1) / Double(rectangles.count) * 0.045,
            message: localized(
                "正在处理第 \(index + 1) / \(rectangles.count) 张照片…",
                "Processing photo \(index + 1) / \(rectangles.count)…"
            )
        ))
    }

    if results.isEmpty {
        throw NativeError.failed(localized(
            "没有检测到可保存的照片。请拉开照片之间的距离后重试。",
            "No photos were detected. Leave more space between the prints and try again."
        ))
    }
    return results
}

func rewriteMetadata(
    fileURL: URL,
    capturedAt: String,
    address: String,
    note: String?
) throws {
    guard let source = CGImageSourceCreateWithURL(fileURL as CFURL, nil) else {
        throw NativeError.failed(localized(
            "无法读取照片元数据：\(fileURL.lastPathComponent)",
            "Could not read photo metadata: \(fileURL.lastPathComponent)"
        ))
    }
    let metadata: CGMutableImageMetadata
    if let sourceMetadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil),
       let mutableCopy = CGImageMetadataCreateMutableCopy(sourceMetadata) {
        metadata = mutableCopy
    } else {
        metadata = CGImageMetadataCreateMutable()
    }

    func setMetadataValue(_ path: CFString, _ value: CFTypeRef) throws {
        guard CGImageMetadataSetValueWithPath(metadata, nil, path, value) else {
            throw NativeError.failed(localized(
                "无法更新元数据字段 \(path)：\(fileURL.lastPathComponent)",
                "Could not update metadata field \(path): \(fileURL.lastPathComponent)"
            ))
        }
    }

    if !capturedAt.isEmpty {
        let parser = ISO8601DateFormatter()
        let date = parser.date(from: capturedAt)
            ?? DateFormatter.localDateTime.date(from: capturedAt)
        if let date {
            let exifValue = DateFormatter.exifDateTime.string(from: date)
            let xmpValue = DateFormatter.xmpDateTime.string(from: date)
            try setMetadataValue("exif:DateTimeOriginal" as CFString, exifValue as CFString)
            try setMetadataValue("exif:DateTimeDigitized" as CFString, exifValue as CFString)
            try setMetadataValue("tiff:DateTime" as CFString, exifValue as CFString)
            try setMetadataValue("xmp:CreateDate" as CFString, xmpValue as CFString)
            try setMetadataValue("photoshop:DateCreated" as CFString, xmpValue as CFString)
        }
    }

    if !address.isEmpty {
        try setMetadataValue("Iptc4xmpCore:Location" as CFString, address as CFString)
        try setMetadataValue("photoshop:City" as CFString, address as CFString)
    }
    if let note {
        try setMetadataValue("dc:description[x-default]" as CFString, note as CFString)
    }

    let temporaryURL = fileURL
        .deletingLastPathComponent()
        .appendingPathComponent(".\(UUID().uuidString)-metadata.jpg")
    guard let destination = CGImageDestinationCreateWithURL(
        temporaryURL as CFURL,
        UTType.jpeg.identifier as CFString,
        1,
        nil
    ) else {
        throw NativeError.failed(localized(
            "无法创建元数据文件：\(fileURL.lastPathComponent)",
            "Could not create metadata file: \(fileURL.lastPathComponent)"
        ))
    }
    let options: [CFString: Any] = [
        kCGImageDestinationMetadata: metadata,
        kCGImageDestinationMergeMetadata: true
    ]
    var copyError: Unmanaged<CFError>?
    guard CGImageDestinationCopyImageSource(
        destination,
        source,
        options as CFDictionary,
        &copyError
    ) else {
        let message = copyError?.takeRetainedValue().localizedDescription
            ?? localized("未知错误", "Unknown error")
        throw NativeError.failed(localized(
            "无法无损写入照片元数据：\(message)",
            "Could not write photo metadata losslessly: \(message)"
        ))
    }
    _ = try FileManager.default.replaceItemAt(fileURL, withItemAt: temporaryURL)
}

func rotatePhoto(fileURL: URL, clockwise: Bool) throws {
    guard let inputImage = CIImage(contentsOf: fileURL, options: [.applyOrientationProperty: true]) else {
        throw NativeError.failed(localized(
            "无法读取照片：\(fileURL.lastPathComponent)",
            "Could not read photo: \(fileURL.lastPathComponent)"
        ))
    }
    let orientation: Int32 = clockwise ? 6 : 8
    let rotated = inputImage.oriented(forExifOrientation: orientation)
    let context = CIContext(options: [.useSoftwareRenderer: false])
    guard let image = context.createCGImage(rotated, from: rotated.extent) else {
        throw NativeError.failed(localized(
            "无法旋转照片。",
            "Could not rotate the photo."
        ))
    }

    var properties = sourceProperties(fileURL)
    properties[kCGImagePropertyOrientation] = 1
    let temporaryURL = fileURL
        .deletingLastPathComponent()
        .appendingPathComponent(".\(UUID().uuidString)-rotate.jpg")
    try writeJPEG(image, to: temporaryURL, properties: properties)
    _ = try FileManager.default.replaceItemAt(fileURL, withItemAt: temporaryURL)
}

extension DateFormatter {
    static let localDateTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter
    }()

    static let exifDateTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
        return formatter
    }()

    static let xmpDateTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXX"
        return formatter
    }()
}

func argument(after flag: String, in arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
        return nil
    }
    return arguments[index + 1]
}

@MainActor
func execute() async throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard let command = arguments.first else {
        throw NativeError.usage(localized(
            "需要命令：list、scan、separate、metadata、rotate 或 self-test。",
            "A command is required: list, scan, separate, metadata, rotate, or self-test."
        ))
    }

    switch command {
    case "list":
        let timeout = Double(argument(after: "--timeout", in: arguments) ?? "4.0") ?? 4.0
        printJSON(await discoverScanners(duration: timeout))

    case "scan":
        guard let output = argument(after: "--output", in: arguments) else {
            throw NativeError.usage(localized(
                "scan 缺少 --output。",
                "scan requires --output."
            ))
        }
        let device = argument(after: "--device", in: arguments) ?? ""
        let dpi = Int(argument(after: "--dpi", in: arguments) ?? "600") ?? 600
        let color = argument(after: "--color", in: arguments) ?? "color"
        let session = ScannerSession(
            deviceID: device,
            dpi: dpi,
            colorMode: color,
            outputDirectory: URL(fileURLWithPath: output)
        )
        let resultURL = try await session.run()
        printJSON(ScanResult(path: resultURL.path))

    case "separate":
        guard let input = argument(after: "--input", in: arguments),
              let output = argument(after: "--output", in: arguments) else {
            throw NativeError.usage(localized(
                "separate 需要 --input 和 --output。",
                "separate requires --input and --output."
            ))
        }
        let mode = ProcessingMode(
            rawValue: argument(after: "--mode", in: arguments) ?? "standard"
        ) ?? .standard
        let results = try separatePhotos(
            inputURL: URL(fileURLWithPath: input),
            outputDirectory: URL(fileURLWithPath: output),
            mode: mode
        )
        printJSON(results)

    case "metadata":
        guard let input = argument(after: "--input", in: arguments) else {
            throw NativeError.usage(localized(
                "metadata 缺少 --input。",
                "metadata requires --input."
            ))
        }
        try rewriteMetadata(
            fileURL: URL(fileURLWithPath: input),
            capturedAt: argument(after: "--date", in: arguments) ?? "",
            address: argument(after: "--address", in: arguments) ?? "",
            note: argument(after: "--note", in: arguments)
        )
        printJSON(CommandResult(ok: true))

    case "rotate":
        guard let input = argument(after: "--input", in: arguments) else {
            throw NativeError.usage(localized(
                "rotate 缺少 --input。",
                "rotate requires --input."
            ))
        }
        let clockwise = (argument(after: "--direction", in: arguments) ?? "right") != "left"
        try rotatePhoto(fileURL: URL(fileURLWithPath: input), clockwise: clockwise)
        printJSON(CommandResult(ok: true))

    case "self-test":
        guard arguments.count > 1 else {
            throw NativeError.usage(localized(
                "self-test 需要演示图片路径。",
                "self-test requires a demo image path."
            ))
        }
        let temporaryDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PhotoScannerSelfTest-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
        let crops = try separatePhotos(
            inputURL: URL(fileURLWithPath: arguments[1]),
            outputDirectory: temporaryDirectory
        )
        guard crops.count == 4 else {
            throw NativeError.failed(localized(
                "自动分离测试失败：期望 4 张，实际检测到 \(crops.count) 张。",
                "Automatic separation test failed: expected 4 photos, detected \(crops.count)."
            ))
        }
        try rewriteMetadata(
            fileURL: URL(fileURLWithPath: crops[0].path),
            capturedAt: "2000-01-01T12:00",
            address: "Example location",
            note: "Automated test"
        )
        try rotatePhoto(fileURL: URL(fileURLWithPath: crops[0].path), clockwise: true)
        printJSON(crops)

    default:
        throw NativeError.usage(localized(
            "未知命令：\(command)",
            "Unknown command: \(command)"
        ))
    }
}

Task { @MainActor in
    do {
        try await execute()
        exit(0)
    } catch {
        printErrorAndExit(error)
    }
}
RunLoop.main.run()
