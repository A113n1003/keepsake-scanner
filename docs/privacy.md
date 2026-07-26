# Privacy Model

## Principles

- Local by default
- No analytics or tracking
- No accounts
- No cloud image processing
- No hidden network dependency for scanning
- No real personal scans in the repository

## Data stored by the app

Electron stores the selected output folder, scan settings, language, scanner identifier, and next sequence number in the operating system’s application data directory. Scanned photographs and metadata are written only to the selected output folder.

The scanner identifier is required to reconnect to a selected device. It is not transmitted by the application.

## Temporary data

Raw flatbed scans and intermediate crops are created in a unique operating-system temporary directory. The application removes known temporary session directories when it quits normally. The operating system may clean abandoned temporary files after a crash.

## Network behavior

Production scanning and processing require no network connection. The development server uses only the loopback interface. Dependency installation and GitHub workflows naturally access their upstream services outside the running application.

The packaged app removes Electron's broad network exception and unused camera, microphone, audio-capture, and Bluetooth permission descriptions. Electron also denies renderer permission requests at runtime.

## Repository privacy gate

`npm run privacy:check` scans source and documentation for:

- macOS, Linux, and Windows user-directory paths
- mounted personal volume paths
- common GitHub and AWS credential formats
- private keys

Generated dependencies and build products are excluded from Git and from the scan. Code review must still check screenshots and other binary assets because text scanners cannot detect personal information rendered into pixels.

## Demo assets

The flatbed demo and four crop previews are generated fictional scenes containing no people, names, signs, documents, or real-world personal metadata.

## Reporting

Report a privacy or security issue through the private process in [SECURITY.md](../SECURITY.md).
