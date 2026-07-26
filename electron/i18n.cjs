const messages = {
  en: {
    nativeFallback: "The native scanner helper failed.",
    nativeLaunch: "Could not start the native scanner helper: {message}",
    nativeNoResult: "The native scanner helper returned no result.",
    detecting: "Detecting and straightening photos…",
    saving: "{count} detected. Saving in sequence…",
    complete: "Saved {count} photos",
    pathOutside: "The photo is not inside the current output folder.",
    jobActive: "Another scan is already running. Please wait.",
    appName: "Keepsake Scanner",
    chooseOutput: "Choose where scanned photos are saved",
    chooseImage: "Choose a flatbed scan image",
    imageFilter: "Images",
    chooseScanner: "Select a scanner first."
  },
  "zh-CN": {
    nativeFallback: "原生扫描助手执行失败。",
    nativeLaunch: "无法启动原生扫描助手：{message}",
    nativeNoResult: "原生扫描助手没有返回结果。",
    detecting: "正在检测并拉直每张照片…",
    saving: "检测到 {count} 张，正在按编号保存…",
    complete: "已保存 {count} 张照片",
    pathOutside: "照片路径不在当前输出文件夹内。",
    jobActive: "已有扫描任务正在进行，请稍候。",
    appName: "拾影扫描",
    chooseOutput: "选择扫描照片保存位置",
    chooseImage: "选择整板扫描图像",
    imageFilter: "图像",
    chooseScanner: "请先选择扫描设备。"
  }
};

function normalizeLocale(value) {
  return String(value || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function text(locale, key, values = {}) {
  const table = messages[normalizeLocale(locale)];
  const template = table[key] ?? messages.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name) => (
    values[name] === undefined ? `{${name}}` : String(values[name])
  ));
}

module.exports = { normalizeLocale, text };
