# Release Process

## Versioning

Keepsake Scanner follows Semantic Versioning. Update `package.json` and `CHANGELOG.md` together.

## Pre-release checklist

1. Review the full diff.
2. Run `npm ci`.
3. Run `npm run check`.
4. Run `npm audit --omit=dev`.
5. Test scanner discovery and one real scan on supported hardware.
6. Test English and Simplified Chinese.
7. Build with `npm run dist`.
8. Confirm the automated artifact privacy check passes. It rejects local build paths, broad network access, and permission descriptions for hardware the app does not use.
9. Confirm the bundle contains no settings, logs, real scans, or credentials.
10. Sign and notarize public artifacts with an Apple Developer ID.
11. Tag the release and publish checksums with the GitHub release.

## Unsigned development builds

Local `npm run dist` output is intended for development. Do not present an unsigned, unnotarized artifact as a trusted public release.

## Rollback

If a release risks data loss, privacy, or unsafe metadata changes, remove the affected artifact, publish an advisory, and issue a patched release. Never rewrite existing user photographs as part of an application update.
