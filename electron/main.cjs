const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell
} = require("electron");
const crypto = require("node:crypto");
const { constants } = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { normalizeLocale, text } = require("./i18n.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "photoscanner",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

const tempSessions = new Set();
const approvedImagePaths = new Set();
let mainWindow;
let activeJob = false;

function defaultOutputFolder() {
  return path.join(app.getPath("pictures"), "Keepsake Scanner");
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function counterPath() {
  return path.join(app.getPath("userData"), "scan-counter.json");
}

async function getSettings() {
  const defaults = {
    outputFolder: defaultOutputFolder(),
    dpi: 600,
    scanMode: "standard",
    colorMode: "color",
    scannerID: "",
    locale: normalizeLocale(app.getLocale())
  };
  try {
    const value = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
    const settings = { ...defaults, ...value };
    if (!["fast", "standard", "archive"].includes(value.scanMode)) {
      settings.scanMode = value.dpi === 300 ? "fast" : value.dpi === 1200 ? "archive" : "standard";
    }
    settings.locale = normalizeLocale(value.locale || settings.locale);
    if (
      typeof settings.outputFolder !== "string" ||
      !path.isAbsolute(settings.outputFolder)
    ) {
      settings.outputFolder = defaults.outputFolder;
    }
    return settings;
  } catch {
    return defaults;
  }
}

async function saveSettings(patch = {}) {
  const current = await getSettings();
  const settings = {
    outputFolder: typeof patch.outputFolder === "string" && path.isAbsolute(patch.outputFolder)
      ? path.resolve(patch.outputFolder)
      : current.outputFolder,
    dpi: [300, 600, 1200].includes(Number(patch.dpi)) ? Number(patch.dpi) : current.dpi,
    scanMode: ["fast", "standard", "archive"].includes(patch.scanMode)
      ? patch.scanMode
      : current.scanMode,
    colorMode: ["color", "gray"].includes(patch.colorMode)
      ? patch.colorMode
      : current.colorMode,
    scannerID: typeof patch.scannerID === "string"
      ? patch.scannerID.slice(0, 1024)
      : current.scannerID,
    locale: normalizeLocale(patch.locale || current.locale)
  };
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

async function getNextScanNumber() {
  try {
    const value = JSON.parse(await fs.readFile(counterPath(), "utf8"));
    return Number.isSafeInteger(value.nextScanNumber)
      ? Math.max(0, value.nextScanNumber)
      : 0;
  } catch {
    return 0;
  }
}

async function saveNextScanNumber(nextScanNumber) {
  const destination = counterPath();
  const temporary = `${destination}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(
    temporary,
    JSON.stringify({ nextScanNumber }, null, 2),
    "utf8"
  );
  await fs.rename(temporary, destination);
}

function nativeBinary() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "native", "PhotoScannerNative")
    : path.join(app.getAppPath(), "native", ".build", "release", "PhotoScannerNative");
}

function demoAsset() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "demo-flatbed.png")
    : path.join(app.getAppPath(), "resources", "demo-flatbed.png");
}

function imageURL(filePath, version = Date.now()) {
  const resolvedPath = path.resolve(filePath);
  approvedImagePaths.add(resolvedPath);
  const encoded = Buffer.from(resolvedPath, "utf8").toString("base64url");
  return `photoscanner://image/${encoded}?v=${version}`;
}

function parseNativeError(stderr, locale) {
  const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed.message) return parsed.message;
    } catch {
      // Continue to the next line.
    }
  }
  return lines.at(-1) || text(locale, "nativeFallback");
}

function runNative(args, onProgress, locale = "en") {
  return new Promise((resolve, reject) => {
    const child = spawn(nativeBinary(), args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdoutBuffer = "";
    let stderr = "";
    let result;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines.filter(Boolean)) {
        try {
          const value = JSON.parse(line);
          if (value.type === "progress") onProgress?.(value);
          else result = value;
        } catch {
          // Ignore framework diagnostics that occasionally reach stdout.
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(new Error(text(locale, "nativeLaunch", { message: error.message })));
    });
    child.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        try {
          const value = JSON.parse(stdoutBuffer.trim());
          if (value.type === "progress") onProgress?.(value);
          else result = value;
        } catch {
          // The exit code below remains the source of truth.
        }
      }
      if (code !== 0) {
        reject(new Error(parseNativeError(stderr, locale)));
      } else if (result === undefined) {
        reject(new Error(text(locale, "nativeNoResult")));
      } else {
        resolve(result);
      }
    });
  });
}

async function createTempSession() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "PhotoScanner-"));
  tempSessions.add(directory);
  return directory;
}

async function nextNumber(outputFolder) {
  let entries = [];
  try {
    entries = await fs.readdir(outputFolder);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let highest = -1;
  for (const entry of entries) {
    const match = /^SCAN_(\d{7})\.(?:jpe?g)$/i.exec(entry);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const persisted = await getNextScanNumber();
  return Math.max(highest + 1, persisted);
}

async function commitCrops(crops, outputFolder) {
  await fs.mkdir(outputFolder, { recursive: true });
  let number = await nextNumber(outputFolder);
  const committed = [];

  for (const crop of crops) {
    let destination;
    while (true) {
      const fileName = `SCAN_${String(number).padStart(7, "0")}.jpg`;
      destination = path.join(outputFolder, fileName);
      try {
        await fs.copyFile(crop.path, destination, constants.COPYFILE_EXCL);
        await saveNextScanNumber(number + 1);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        number += 1;
      }
    }
    const stats = await fs.stat(destination);
    committed.push({
      id: crypto.randomUUID(),
      fileName: path.basename(destination),
      path: destination,
      url: imageURL(destination, stats.mtimeMs),
      width: crop.width,
      height: crop.height,
      bounds: crop.bounds,
      confidence: crop.confidence,
      capturedAt: "",
      address: "",
      note: ""
    });
    number += 1;
  }
  return committed;
}

async function processSource(sourcePath, options) {
  const locale = normalizeLocale(options.locale);
  const outputFolder = path.resolve(options.outputFolder || defaultOutputFolder());
  const session = await createTempSession();
  const cropsDirectory = path.join(session, "crops");
  mainWindow?.webContents.send("scanner-progress", {
    stage: "detecting",
    progress: 0.92,
    message: text(locale, "detecting")
  });
  const crops = await runNative([
    "separate",
    "--input",
    sourcePath,
    "--output",
    cropsDirectory,
    "--mode",
    options.scanMode || "standard",
    "--locale",
    locale
  ], (progress) => mainWindow?.webContents.send("scanner-progress", progress), locale);
  mainWindow?.webContents.send("scanner-progress", {
    stage: "saving",
    progress: 0.97,
    message: text(locale, "saving", { count: crops.length })
  });
  const items = await commitCrops(crops, outputFolder);
  await saveSettings({
    outputFolder,
    dpi: Number(options.dpi) || 600,
    scanMode: options.scanMode || "standard",
    colorMode: options.colorMode || "color",
    scannerID: options.scannerID || "",
    locale
  });
  mainWindow?.webContents.send("scanner-progress", {
    stage: "complete",
    progress: 1,
    message: text(locale, "complete", { count: items.length })
  });
  return {
    sourcePath,
    sourceUrl: imageURL(sourcePath),
    outputFolder,
    items
  };
}

function ensurePhotoInFolder(filePath, outputFolder, locale = "en") {
  const resolvedFile = path.resolve(filePath);
  const resolvedFolder = path.resolve(outputFolder);
  const relative = path.relative(resolvedFolder, resolvedFile);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !/^SCAN_\d{7}\.jpg$/i.test(path.basename(resolvedFile))
  ) {
    throw new Error(text(locale, "pathOutside"));
  }
}

async function withJob(task, locale = "en") {
  if (activeJob) throw new Error(text(locale, "jobActive"));
  activeJob = true;
  try {
    return await task();
  } finally {
    activeJob = false;
  }
}

function sessionPermissionPolicy() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function createWindow(locale = "en") {
  mainWindow = new BrowserWindow({
    width: 1512,
    height: 982,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#f7f7f4",
    title: text(locale, "appName"),
    frame: false,
    roundedCorners: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, navigationURL) => {
    const expectedOrigin = process.env.VITE_DEV_SERVER_URL
      ? new URL(process.env.VITE_DEV_SERVER_URL).origin
      : "file://";
    if (!navigationURL.startsWith(expectedOrigin)) event.preventDefault();
  });
}

app.whenReady().then(async () => {
  const initialSettings = await getSettings();
  app.setAboutPanelOptions({
    applicationName: text(initialSettings.locale, "appName"),
    applicationVersion: app.getVersion(),
    copyright: "Copyright © 2026 Keepsake Scanner contributors"
  });
  sessionPermissionPolicy();

  protocol.handle("photoscanner", async (request) => {
    const parsed = new URL(request.url);
    if (parsed.hostname !== "image") {
      return new Response("Not found", { status: 404 });
    }
    try {
      const encoded = parsed.pathname.replace(/^\//, "");
      const filePath = path.resolve(Buffer.from(encoded, "base64url").toString("utf8"));
      if (!approvedImagePaths.has(filePath)) {
        return new Response("Forbidden", { status: 403 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response("Invalid image path", { status: 400 });
    }
  });

  ipcMain.handle("settings:get", getSettings);
  ipcMain.handle("settings:save", (_event, patch) => saveSettings(patch || {}));
  ipcMain.handle("scanner:list", async (_event, requestedLocale) => {
    const current = await getSettings();
    const locale = normalizeLocale(requestedLocale || current.locale);
    return runNative(["list", "--timeout", "4.0", "--locale", locale], undefined, locale);
  });
  ipcMain.on("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("dialog:output-folder", async () => {
    const current = await getSettings();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: text(current.locale, "chooseOutput"),
      defaultPath: current.outputFolder,
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await saveSettings({ outputFolder: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle("scan:import", (_event, options) => withJob(async () => {
    const locale = normalizeLocale(options.locale);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: text(locale, "chooseImage"),
      properties: ["openFile"],
      filters: [
        { name: text(locale, "imageFilter"), extensions: ["jpg", "jpeg", "png", "tif", "tiff", "heic"] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return processSource(result.filePaths[0], options);
  }, options?.locale));

  ipcMain.handle("scan:demo", (_event, options) => withJob(() => (
    processSource(demoAsset(), options)
  ), options?.locale));

  ipcMain.handle("scan:start", (_event, options) => withJob(async () => {
    const locale = normalizeLocale(options.locale);
    if (!options.scannerID) throw new Error(text(locale, "chooseScanner"));
    const session = await createTempSession();
    const scanned = await runNative([
      "scan",
      "--device",
      options.scannerID,
      "--dpi",
      String(options.dpi || 600),
      "--color",
      options.colorMode || "color",
      "--output",
      session,
      "--locale",
      locale
    ], (progress) => mainWindow?.webContents.send("scanner-progress", progress), locale);
    return processSource(scanned.path, options);
  }, options?.locale));

  ipcMain.handle("photo:metadata", async (_event, payload) => {
    const locale = normalizeLocale(payload.locale);
    ensurePhotoInFolder(payload.path, payload.outputFolder, locale);
    await runNative([
      "metadata",
      "--input",
      payload.path,
      "--date",
      payload.capturedAt || "",
      "--address",
      payload.address || "",
      "--note",
      payload.note || "",
      "--locale",
      locale
    ], undefined, locale);
    const stats = await fs.stat(payload.path);
    return { ok: true, url: imageURL(payload.path, stats.mtimeMs) };
  });

  ipcMain.handle("photo:rotate", async (_event, payload) => {
    const locale = normalizeLocale(payload.locale);
    ensurePhotoInFolder(payload.path, payload.outputFolder, locale);
    await runNative([
      "rotate",
      "--input",
      payload.path,
      "--direction",
      payload.direction === "left" ? "left" : "right",
      "--locale",
      locale
    ], undefined, locale);
    const stats = await fs.stat(payload.path);
    return { ok: true, url: imageURL(payload.path, stats.mtimeMs) };
  });

  ipcMain.handle("photo:trash", async (_event, payload) => {
    ensurePhotoInFolder(payload.path, payload.outputFolder, payload.locale);
    await shell.trashItem(payload.path);
    return { ok: true };
  });

  ipcMain.handle("folder:reveal", async (_event, folder) => {
    await shell.openPath(path.resolve(folder || defaultOutputFolder()));
    return { ok: true };
  });
  ipcMain.handle("help:open", async () => {
    await shell.openExternal("https://github.com/A113n1003/keepsake-scanner#readme");
    return { ok: true };
  });

  createWindow(initialSettings.locale);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      getSettings().then((current) => createWindow(current.locale));
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const directory of tempSessions) {
    fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
});
