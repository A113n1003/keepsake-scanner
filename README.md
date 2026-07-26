# Keepsake Scanner

[简体中文](README.zh-CN.md)

A privacy-first macOS desktop app for scanning, separating, and archiving multiple printed photographs in one pass.

Keepsake Scanner talks to scanners through macOS ImageCaptureCore, detects individual prints with Vision, corrects perspective, and saves each result with a system-wide `SCAN_0000000.jpg` sequence. All image processing stays on the Mac.

> Project status: early public release. Back up irreplaceable photographs and verify scanner compatibility before a large archival session.

## Features

- Discover USB and network scanners known to macOS.
- Scan in Fast (300 dpi), Standard (600 dpi), or Archive (1200 dpi) mode.
- Detect, straighten, separate, and preview multiple prints from one flatbed scan.
- Continue numbering across sessions with a persistent `SCAN_0000000` counter.
- Correct photo orientation using low-resolution face and text analysis while preserving the full-resolution output.
- Edit capture time, location, and notes in EXIF/XMP metadata.
- Rotate results and move unwanted files to the macOS Trash.
- Use an entirely synthetic, identity-free demo image without a connected scanner.
- Switch the interface and native progress messages between English and Simplified Chinese.

## Requirements

- macOS 14 or later
- A scanner supported by macOS Image Capture
- Apple Silicon or Intel Mac for development; published artifacts may be architecture-specific
- Node.js 20 or later
- Xcode Command Line Tools

## Quick start

```bash
git clone https://github.com/A113n1003/keepsake-scanner.git
cd keepsake-scanner
npm install
npm run dev
```

The default destination is a `Keepsake Scanner` folder inside the current macOS Pictures directory. You can choose any other writable folder in the app.

## Development

```bash
npm run check      # privacy audit, lint, native self-test, and UI build
npm run dev        # build the Swift helper and start Electron
npm run dist       # create unsigned local macOS artifacts
```

See [Development](docs/development.md) and [Architecture](docs/architecture.md) for details.

## Privacy

Keepsake Scanner has no analytics, cloud upload, account system, or remote image-processing service. Scans, previews, metadata, and settings remain local. The public demo contains only generated landscapes and objects; it includes no real people or personal documents.

The repository runs an automated privacy check that rejects local home paths, common secret formats, and private keys. Read the complete [Privacy model](docs/privacy.md).

## Scanner compatibility

If a device appears and works in Apple’s Image Capture app, it will usually work here. Vendor drivers can still differ in session handling, supported resolutions, and warm-up behavior. Read [Scanner compatibility and troubleshooting](docs/scanner-compatibility.md) before reporting a device issue.

## Documentation

- [Architecture](docs/architecture.md)
- [Development guide](docs/development.md)
- [Privacy model](docs/privacy.md)
- [Scanner compatibility](docs/scanner-compatibility.md)
- [Release process](docs/releasing.md)
- [Asset provenance](docs/assets.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Governance](GOVERNANCE.md)
- [Changelog](CHANGELOG.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## License

Released under the [MIT License](LICENSE).
