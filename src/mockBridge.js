import { createTranslator, normalizeLocale } from "./i18n";

const listeners = new Set();
const DEMO_OUTPUT = "~/Pictures/Keepsake Scanner";

const demoBounds = [
  { x: 0.1066, y: 0.5206, width: 0.3733, height: 0.4081 },
  { x: 0.5361, y: 0.5227, width: 0.3505, height: 0.4005 },
  { x: 0.1101, y: 0.0838, width: 0.3696, height: 0.3978 },
  { x: 0.5279, y: 0.0743, width: 0.3503, height: 0.3919 }
];

const delay = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

async function demoResult(options = {}) {
  const t = createTranslator(options.locale);
  const progress = [
    [0.18, t("progress.scanningBed")],
    [0.63, t("progress.scanningPercent", { percent: 64 })],
    [0.92, t("progress.detecting")],
    [0.935, t("progress.processing", { current: 1, total: 4 })],
    [0.95, t("progress.processing", { current: 2, total: 4 })],
    [0.965, t("progress.processing", { current: 3, total: 4 })],
    [0.98, t("progress.processing", { current: 4, total: 4 })],
    [0.98, t("progress.saving", { count: 4 })],
    [1, t("progress.complete", { count: 4 })]
  ];
  for (const [value, message] of progress) {
    listeners.forEach((listener) => listener({ progress: value, message }));
    await delay(100);
  }
  return {
    sourcePath: "/demo-flatbed.png",
    sourceUrl: "/demo-flatbed.png",
    outputFolder: options.outputFolder || DEMO_OUTPUT,
    items: demoBounds.map((bounds, index) => ({
      id: `demo-${index}`,
      fileName: `SCAN_${String(124 + index).padStart(7, "0")}.jpg`,
      path: `/mock/SCAN_${String(124 + index).padStart(7, "0")}.jpg`,
      url: `/demo-crops/crop_${String(index + 1).padStart(3, "0")}.jpg`,
      width: 560,
      height: 405,
      bounds,
      confidence: 1,
      capturedAt: "",
      address: "",
      note: ""
    }))
  };
}

export const mockBridge = {
  getSettings: async () => ({
    outputFolder: DEMO_OUTPUT,
    dpi: 600,
    scanMode: "standard",
    colorMode: "color",
    scannerID: "demo-scanner",
    locale: normalizeLocale(navigator.language)
  }),
  saveSettings: async (value) => value,
  minimizeWindow: () => undefined,
  closeWindow: () => undefined,
  listScanners: async () => [{
    id: "demo-scanner",
    name: "Demo Flatbed Scanner",
    transport: "USB",
    location: "USB"
  }],
  chooseOutputFolder: async () => DEMO_OUTPUT,
  importImage: demoResult,
  startScan: demoResult,
  loadDemo: demoResult,
  applyMetadata: async () => ({ ok: true }),
  rotatePhoto: async () => ({ ok: true }),
  trashPhoto: async () => ({ ok: true }),
  revealOutput: async () => ({ ok: true }),
  openHelp: async () => ({ ok: true }),
  onProgress: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};
