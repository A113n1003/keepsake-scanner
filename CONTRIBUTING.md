# Contributing

Thank you for improving Keepsake Scanner.

## Before you start

- Search existing issues and pull requests.
- Use GitHub Discussions for broad questions and ideas.
- Open an issue before a large behavior or architecture change.
- Never upload private scans, device serial numbers, local paths, credentials, or crash reports that contain personal data.

## Local setup

1. Install macOS 14+, Node.js 20+, and Xcode Command Line Tools.
2. Fork and clone the repository.
3. Run `npm install`.
4. Run `npm run check`.
5. Start the app with `npm run dev`.

## Pull requests

- Keep each pull request focused.
- Explain the user impact and any scanner-specific behavior.
- Add or update documentation for user-visible changes.
- Add English and Simplified Chinese strings for interface changes.
- Use synthetic or freely licensed fixtures only.
- Run `npm run check` before requesting review.
- Do not commit `node_modules`, `dist`, `release`, Swift build output, real scans, or local settings.

## Commit messages

Use a concise imperative subject, for example:

```text
Add localized scanner timeout messages
```

## Reporting scanner problems

Include:

- macOS version
- scanner manufacturer and model
- connection type
- requested work mode
- whether Apple Image Capture can scan successfully
- sanitized error text

Do not include scanner UUIDs, user directory paths, unredacted logs, or scanned photographs.

## Review

Maintainers may ask for tests, privacy changes, documentation, or a smaller scope. A change can merge after required checks pass and review feedback is resolved.
