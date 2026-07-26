# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- English and Simplified Chinese interface localization
- Fast, Standard, and Archive scan modes
- Per-photo processing progress
- Privacy audit, lint, CI, issue templates, and community documentation
- Synthetic identity-free demo scan

### Changed

- Default output is resolved from the current macOS Pictures directory
- Orientation analysis uses downsampled images and applies the result to full-resolution output
- Electron navigation, permissions, settings validation, and local-image access are restricted

### Removed

- Hard-coded contributor computer paths
- Real family photographs and generated release artifacts from the source tree
