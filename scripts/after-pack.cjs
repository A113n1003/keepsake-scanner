const { execFileSync } = require("node:child_process");
const path = require("node:path");

const UNUSED_PERMISSION_KEYS = [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription"
];

function deletePlistKey(plistPath, key) {
  try {
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      `Delete :${key}`,
      plistPath
    ], { stdio: "ignore" });
  } catch {
    // Electron defaults vary by release, so an absent key is already acceptable.
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const applicationName = context.packager.appInfo.productFilename;
  const plistPath = path.join(
    context.appOutDir,
    `${applicationName}.app`,
    "Contents",
    "Info.plist"
  );

  deletePlistKey(plistPath, "NSAppTransportSecurity");
  for (const key of UNUSED_PERMISSION_KEYS) {
    deletePlistKey(plistPath, key);
  }
};
