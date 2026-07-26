import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const source = path.resolve("native/.build/release/PhotoScannerNative");
const destinationDirectory = path.resolve("build/native");
const destination = path.join(destinationDirectory, "PhotoScannerNative");

await fs.mkdir(destinationDirectory, { recursive: true });
await fs.copyFile(source, destination);
await fs.chmod(destination, 0o755);

const stripped = spawnSync("strip", ["-S", "-x", destination], {
  encoding: "utf8"
});
if (stripped.status !== 0) {
  console.error(stripped.stderr || "Failed to strip the native helper.");
  process.exit(stripped.status || 1);
}

console.log("Prepared a stripped native helper for packaging.");
