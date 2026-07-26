import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  "dist",
  "node_modules",
  "release",
  ".build",
  "coverage"
]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".swift",
  ".txt",
  ".yaml",
  ".yml"
]);
const checks = [
  {
    name: "macOS or Linux home directory",
    pattern: /\/(?:Users|home)\/[^/\s"'<>]+(?:\/|\\)/g
  },
  {
    name: "Windows user directory",
    pattern: /[A-Za-z]:\\Users\\[^\\\s"'<>]+\\/g
  },
  {
    name: "mounted personal volume",
    pattern: /\/Volumes\/[^/\s"'<>]+\//g
  },
  {
    name: "GitHub access token",
    pattern: /(?:gh[opsu]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g
  },
  {
    name: "AWS access key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    name: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  }
];

async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
    } else if (textExtensions.has(path.extname(entry.name)) || entry.name === "LICENSE") {
      files.push(absolutePath);
    }
  }
  return files;
}

const findings = [];
for (const file of await collectFiles(root)) {
  const contents = await fs.readFile(file, "utf8");
  for (const check of checks) {
    check.pattern.lastIndex = 0;
    for (const match of contents.matchAll(check.pattern)) {
      const line = contents.slice(0, match.index).split("\n").length;
      findings.push({
        file: path.relative(root, file),
        line,
        check: check.name,
        sample: match[0]
      });
    }
  }
}

if (findings.length) {
  console.error("Privacy check failed:");
  for (const finding of findings) {
    console.error(
      `- ${finding.file}:${finding.line} — ${finding.check}: ${finding.sample}`
    );
  }
  process.exitCode = 1;
} else {
  console.log("Privacy check passed: no local home paths, secrets, or private keys detected.");
}
