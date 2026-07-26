const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("photoScanner", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  listScanners: (locale) => ipcRenderer.invoke("scanner:list", locale),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  chooseOutputFolder: () => ipcRenderer.invoke("dialog:output-folder"),
  importImage: (options) => ipcRenderer.invoke("scan:import", options),
  startScan: (options) => ipcRenderer.invoke("scan:start", options),
  loadDemo: (options) => ipcRenderer.invoke("scan:demo", options),
  applyMetadata: (payload) => ipcRenderer.invoke("photo:metadata", payload),
  rotatePhoto: (payload) => ipcRenderer.invoke("photo:rotate", payload),
  trashPhoto: (payload) => ipcRenderer.invoke("photo:trash", payload),
  revealOutput: (folder) => ipcRenderer.invoke("folder:reveal", folder),
  openHelp: () => ipcRenderer.invoke("help:open"),
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("scanner-progress", handler);
    return () => ipcRenderer.removeListener("scanner-progress", handler);
  }
});
