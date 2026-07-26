# Security Policy

## Supported versions

Security fixes are applied to the latest release and the default branch.

## Report a vulnerability

Do not open a public issue for a vulnerability or include private scans, local paths, device identifiers, or credentials.

Use GitHub Private Vulnerability Reporting:

`https://github.com/A113n1003/keepsake-scanner/security/advisories/new`

Include a clear impact description, reproduction steps, affected versions, and a minimal sanitized proof of concept. The maintainers will acknowledge a report as soon as practical, investigate it privately, and coordinate disclosure after a fix is available.

## Security boundaries

Keepsake Scanner processes local image files and communicates with macOS scanner services. It does not provide cloud storage, remote access, or an account system. Electron renderer isolation, a restricted preload bridge, denied web permissions, navigation blocking, and an allow-listed image protocol reduce renderer access to the host system.
