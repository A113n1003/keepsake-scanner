# Scanner Compatibility and Troubleshooting

## Compatibility model

Keepsake Scanner uses macOS ImageCaptureCore rather than vendor command-line tools. A scanner that works in Apple Image Capture is the best candidate for compatibility.

The application currently targets flatbed functional units. Automatic document feeders and film holders are not explicitly supported.

## Before reporting a problem

1. Power-cycle the scanner.
2. Close Apple Image Capture and vendor scanning software.
3. Confirm the device can scan in Apple Image Capture.
4. Reopen Keepsake Scanner and refresh the device list.
5. Try Standard mode.
6. Test with the built-in synthetic demo to separate scanner acquisition from photo detection.

## Scanner not found

- Confirm the cable or network connection.
- Grant any macOS folder permissions requested by the app.
- Install a current vendor driver if macOS does not recognize the scanner.
- Check whether the device appears in System Information and Apple Image Capture.

## Scanner is busy

ImageCaptureCore allows one active owner. Close other scanning applications and wait a few seconds before retrying.

## Scan starts slowly

Warm-up, calibration, high resolution, USB speed, and vendor driver behavior happen before local photo separation. Fast mode reduces the requested scan resolution and total pixel volume.

## Photos are missed

- Leave roughly 1 cm between prints.
- Avoid overlap.
- Keep every photo fully inside the glass.
- Use a clean, light scanner background when possible.
- Import the raw flatbed image to determine whether the issue is acquisition or detection.

## Incorrect orientation

Automatic orientation is conservative. It uses faces first and text only when multiple high-confidence observations agree. Ambiguous landscape scenes remain unchanged. Use the manual rotate controls for photographs without reliable orientation evidence.

## Safe bug reports

Do not attach a real scan. Reproduce with the synthetic demo when possible, or create a sanitized fixture containing no people, handwriting, addresses, device identifiers, or metadata.
