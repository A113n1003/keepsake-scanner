import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const releaseRoot = path.resolve("release");
const sensitiveValues = [...new Set([
  process.cwd(),
  os.homedir()
].filter((value) => value && value.length > 4))];

async function collectApplications(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const applications = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      applications.push(absolutePath);
    } else if (entry.isDirectory()) {
      applications.push(...await collectApplications(absolutePath));
    }
  }
  return applications;
}

async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...await collectFiles(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

const applications = await collectApplications(releaseRoot);
if (!applications.length) {
  console.error("Artifact privacy check failed: no packaged .app bundle found.");
  process.exit(1);
}

const findings = [];
const permissionFindings = [];
const unusedPermissionKeys = [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription"
];

for (const application of applications) {
  for (const file of await collectFiles(application)) {
    const contents = await fs.readFile(file);
    for (const value of sensitiveValues) {
      if (contents.indexOf(Buffer.from(value)) !== -1) {
        findings.push({
          file: path.relative(process.cwd(), file),
          value
        });
      }
    }
  }

  const plistPath = path.join(application, "Contents", "Info.plist");
  const plist = JSON.parse(execFileSync(
    "plutil",
    ["-convert", "json", "-o", "-", plistPath],
    { encoding: "utf8" }
  ));
  if (plist.NSAppTransportSecurity?.NSAllowsArbitraryLoads === true) {
    permissionFindings.push(
      `${path.relative(process.cwd(), plistPath)} allows arbitrary network loads.`
    );
  }
  for (const key of unusedPermissionKeys) {
    if (Object.hasOwn(plist, key)) {
      permissionFindings.push(
        `${path.relative(process.cwd(), plistPath)} declares unused ${key}.`
      );
    }
  }
}

if (findings.length || permissionFindings.length) {
  console.error("Artifact privacy check failed:");
  for (const finding of findings) {
    console.error(`- ${finding.file} contains a local environment path.`);
  }
  for (const finding of permissionFindings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Artifact privacy check passed for ${applications.length} application bundle(s).`
  );
}
