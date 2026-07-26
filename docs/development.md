# Development Guide

## Prerequisites

- macOS 14 or later
- Node.js 22 or later
- npm
- Xcode Command Line Tools with Swift 6.0 or later

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

This builds the Swift helper in release mode, starts Vite on the loopback interface, and opens Electron.

## Quality checks

```bash
npm run privacy:check
npm run lint
npm test
npm run check
```

`npm test` builds the native helper, separates the four synthetic demo prints, updates metadata on a temporary crop, rotates it, and builds the renderer.

## Project layout

- `src/`: React renderer and translations
- `electron/`: main process, IPC bridge, and desktop localization
- `native/`: Swift package using Apple frameworks
- `resources/`: synthetic test and demo assets
- `scripts/`: repository quality tools
- `.github/`: CI and community templates
- `docs/`: architecture, privacy, compatibility, and release documentation

## Internationalization

Renderer strings live in `src/i18n.js`. Desktop process strings live in `electron/i18n.cjs`. Native progress and error messages use `localized` pairs in the Swift helper.

Every user-visible change must include English and Simplified Chinese text. English is the source language and fallback.

## Adding fixtures

Fixtures must be synthetic, public-domain, or distributed under a compatible license. Do not add real scans, people, personal documents, handwriting, addresses, device identifiers, or metadata from a contributor machine.

## Packaging

```bash
npm run dist
```

Local artifacts are unsigned and ignored by Git. Public releases should follow [releasing.md](releasing.md).
