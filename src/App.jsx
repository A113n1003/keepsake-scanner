import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  FileImage,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  MapPin,
  Maximize2,
  MessageSquareText,
  Minus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ScanLine,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  createTranslator,
  I18nContext,
  normalizeLocale,
  supportedLocales,
  useI18n
} from "./i18n";
import { mockBridge } from "./mockBridge";

const bridge = window.photoScanner || mockBridge;
const browserPreview = !window.photoScanner;

function FieldLabel({ icon: Icon, children }) {
  return (
    <label className="field-label">
      {Icon ? <Icon aria-hidden="true" size={14} /> : null}
      <span>{children}</span>
    </label>
  );
}

function ToolButton({ label, children, active = false, ...props }) {
  return (
    <button className={`tool-button${active ? " active" : ""}`} title={label} {...props}>
      {children}
      <span>{label}</span>
    </button>
  );
}

function scannerConnectionLabel(scanner, t) {
  const transport = scanner?.transport || "";
  if (transport.includes("TCPIP")) return t("scanner.network");
  if (transport.toUpperCase().includes("USB")) return t("scanner.local");
  return transport.replace("ICTransportType", "") || t("scanner.macos");
}

function ScannerSelect({ scanners, value, onChange, disabled }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menuOpen = open && !disabled;
  const rootRef = useRef(null);
  const selectedScanner = scanners.find((scanner) => scanner.id === value) || scanners[0];

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div className={`scanner-select${menuOpen ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="scanner-select-trigger"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
      >
        <span className="scanner-device-icon"><ScanLine size={17} /></span>
        <span className="scanner-select-copy">
          <strong>{selectedScanner?.name || t("scanner.none")}</strong>
          <small>
            {selectedScanner
              ? scannerConnectionLabel(selectedScanner, t)
              : t("scanner.reconnect")}
          </small>
        </span>
        <span className="scanner-select-chevron">
          <ChevronDown size={16} />
        </span>
      </button>

      {menuOpen ? (
        <div className="scanner-select-menu" role="listbox" aria-label={t("scanner.list")}>
          {scanners.map((scanner) => {
            const selected = scanner.id === selectedScanner?.id;
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={`scanner-select-option${selected ? " selected" : ""}`}
                key={scanner.id}
                onClick={() => {
                  onChange(scanner.id);
                  setOpen(false);
                }}
              >
                <span className="scanner-option-status" />
                <span className="scanner-option-copy">
                  <strong>{scanner.name}</strong>
                  <small>{scannerConnectionLabel(scanner, t)}</small>
                </span>
                <span className="scanner-option-check">
                  {selected ? <Check size={16} strokeWidth={2.4} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function WindowControls() {
  const { t } = useI18n();
  return (
    <div className="window-controls" aria-label={t("window.controls")}>
      <button
        type="button"
        className="window-control close"
        onClick={() => bridge.closeWindow?.()}
        aria-label={t("window.close")}
        title={t("window.close")}
      >
        <X size={13} strokeWidth={2.3} />
      </button>
      <button
        type="button"
        className="window-control minimize"
        onClick={() => bridge.minimizeWindow?.()}
        aria-label={t("window.minimize")}
        title={t("window.minimize")}
      >
        <Minus size={14} strokeWidth={2.3} />
      </button>
    </div>
  );
}

function SetupRail({
  settings,
  setSettings,
  scanners,
  refreshing,
  onRefresh,
  onChooseFolder,
  onScan,
  onImport,
  onDemo,
  busy
}) {
  const { t } = useI18n();
  const scanModes = {
    fast: {
      dpi: 300,
      label: t("settings.fast"),
      description: t("settings.fastDescription")
    },
    standard: {
      dpi: 600,
      label: t("settings.standard"),
      description: t("settings.standardDescription")
    },
    archive: {
      dpi: 1200,
      label: t("settings.archive"),
      description: t("settings.archiveDescription")
    }
  };
  const activeMode = scanModes[settings.scanMode] || scanModes.standard;

  return (
    <aside className="setup-rail">
      <h1>{t("app.name")}</h1>

      <section className="setup-section">
        <div className="section-heading-row">
          <h2>{t("scanner.heading")}</h2>
          <button
            className="icon-button quiet"
            onClick={() => onRefresh()}
            disabled={refreshing || busy}
            aria-label={t("scanner.refresh")}
          >
            <RefreshCw size={15} className={refreshing ? "spin" : ""} />
          </button>
        </div>
        <ScannerSelect
          scanners={scanners}
          value={settings.scannerID}
          onChange={(scannerID) => setSettings((value) => ({
              ...value,
              scannerID
            }))}
          disabled={!scanners.length || busy}
        />
        {!scanners.length ? (
          <p className="field-hint">{t("scanner.missingHint")}</p>
        ) : (
          <p className="field-hint">{t("scanner.connectHint")}</p>
        )}
      </section>

      <section className="setup-section">
        <h2>{t("output.heading")}</h2>
        <button className="folder-field" onClick={onChooseFolder} disabled={busy}>
          <FolderOpen size={17} />
          <span title={settings.outputFolder}>{settings.outputFolder}</span>
          <span className="ellipsis">•••</span>
        </button>
        <p className="field-hint">{t("output.sequenceHint")}</p>
      </section>

      <section className="setup-section">
        <h2>{t("settings.heading")}</h2>
        <div className="setting-row">
          <span>{t("settings.mode")}</span>
          <div className="compact-select select-wrap">
            <select
              value={settings.scanMode}
              onChange={(event) => setSettings((value) => ({
                ...value,
                scanMode: event.target.value,
                dpi: scanModes[event.target.value].dpi
              }))}
              disabled={busy}
            >
              {Object.entries(scanModes).map(([value, mode]) => (
                <option value={value} key={value}>{mode.label}</option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
        <div className="setting-row">
          <span>{t("settings.colorMode")}</span>
          <div className="compact-select select-wrap">
            <select
              value={settings.colorMode}
              onChange={(event) => setSettings((value) => ({
                ...value,
                colorMode: event.target.value
              }))}
              disabled={busy}
            >
              <option value="color">{t("settings.color")}</option>
              <option value="gray">{t("settings.gray")}</option>
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
        <p className="field-hint mode-hint">{activeMode.description}</p>
      </section>

      <div className="setup-actions">
        <button
          className="primary-button"
          onClick={onScan}
          disabled={busy || !settings.scannerID}
        >
          {busy ? <LoaderCircle className="spin" size={18} /> : <ScanLine size={19} />}
          <span>{busy ? t("action.scanning") : t("action.scan")}</span>
        </button>
        <button className="secondary-button" onClick={onImport} disabled={busy}>
          <ImagePlus size={17} />
          <span>{t("action.import")}</span>
        </button>
        <button className="text-button" onClick={onDemo} disabled={busy}>
          {t("action.demo")}
        </button>
      </div>
    </aside>
  );
}

function PreviewCanvas({ sourceUrl, items, selectedId, onSelect, progress, busy }) {
  const { t } = useI18n();
  const hasItems = items.length > 0 && sourceUrl;
  const canvasRef = useRef(null);
  const [imageSize, setImageSize] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const updateSize = () => {
      const next = {
        width: canvas.clientWidth,
        height: canvas.clientHeight
      };
      setCanvasSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const stageSize = useMemo(() => {
    if (
      !imageSize ||
      imageSize.sourceUrl !== sourceUrl ||
      !canvasSize.width ||
      !canvasSize.height
    ) return null;
    const availableWidth = Math.max(1, Math.min(930, canvasSize.width - 52));
    const availableHeight = Math.max(1, canvasSize.height - 52);
    const scale = Math.min(
      availableWidth / imageSize.width,
      availableHeight / imageSize.height
    );
    return {
      width: `${Math.max(1, imageSize.width * scale)}px`,
      height: `${Math.max(1, imageSize.height * scale)}px`
    };
  }, [canvasSize, imageSize, sourceUrl]);

  return (
    <main className="preview-panel">
      <header className="preview-header">
        <div className={`scan-status ${hasItems ? "success" : ""}`}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : hasItems ? (
            <CheckCircle2 size={18} />
          ) : (
            <ScanLine size={18} />
          )}
          <span>
            {busy
              ? progress.message
              : hasItems
                ? t("preview.detected", { count: items.length })
                : t("preview.ready")}
          </span>
        </div>
        {hasItems ? <span className="saved-label">{t("preview.saved")}</span> : null}
      </header>

      <div className="preview-canvas" ref={canvasRef}>
        {hasItems ? (
          <div className="scan-stage" style={stageSize ?? undefined}>
            <img
              src={sourceUrl}
              alt={t("preview.alt")}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                setImageSize({ sourceUrl, width: naturalWidth, height: naturalHeight });
              }}
            />
            <div className="detection-layer">
              {items.map((item, index) => {
                const bounds = item.bounds;
                const top = (1 - bounds.y - bounds.height) * 100;
                return (
                  <button
                    key={item.id}
                    className={`detection-box${selectedId === item.id ? " selected" : ""}`}
                    style={{
                      left: `${bounds.x * 100}%`,
                      top: `${top}%`,
                      width: `${bounds.width * 100}%`,
                      height: `${bounds.height * 100}%`
                    }}
                    onClick={() => onSelect(item.id)}
                    aria-label={t("preview.select", { index: index + 1 })}
                  >
                    <span>{index + 1}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="empty-preview">
            <div className="empty-icon"><ScanLine size={34} /></div>
            <h2>{t("preview.emptyTitle")}</h2>
            <p>{t("preview.emptyDescription")}</p>
          </div>
        )}
        {busy ? (
          <div className="progress-overlay">
            <div className="progress-card">
              <div className="progress-title">
                <span>{progress.message}</span>
                <strong>{Math.round(progress.progress * 100)}%</strong>
              </div>
              <div className="progress-track">
                <div style={{ width: `${Math.max(4, progress.progress * 100)}%` }} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Inspector({ item, onChange, onApply, onBatchApply, saving, itemCount }) {
  const { t } = useI18n();
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <h2>{t("inspector.heading")}</h2>
        {item ? <span>{item.fileName}</span> : null}
      </div>

      {item ? (
        <div className="inspector-form">
          <div className="form-field">
            <FieldLabel icon={FileImage}>{t("inspector.fileName")}</FieldLabel>
            <input value={item.fileName} readOnly />
            <p className="field-hint">{t("inspector.sequenceHint")}</p>
          </div>

          <div className="form-field">
            <FieldLabel icon={CalendarDays}>{t("inspector.capturedAt")}</FieldLabel>
            <input
              type="datetime-local"
              value={item.capturedAt}
              onChange={(event) => onChange("capturedAt", event.target.value)}
            />
          </div>

          <div className="form-field">
            <FieldLabel icon={MapPin}>{t("inspector.address")}</FieldLabel>
            <input
              value={item.address}
              placeholder={t("inspector.addressPlaceholder")}
              onChange={(event) => onChange("address", event.target.value)}
            />
          </div>

          <div className="form-field note-field">
            <FieldLabel icon={MessageSquareText}>{t("inspector.note")}</FieldLabel>
            <textarea
              value={item.note}
              placeholder={t("inspector.notePlaceholder")}
              onChange={(event) => onChange("note", event.target.value)}
            />
          </div>

          <div className="inspector-actions">
            <button className="outline-button" onClick={onApply} disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
              {t("inspector.applySelected")}
            </button>
            <button className="primary-button compact" onClick={onBatchApply} disabled={saving}>
              {t("inspector.applyBatch")}
            </button>
          </div>
          <p className="batch-hint">{t("inspector.batchHint", { count: itemCount })}</p>
        </div>
      ) : (
        <div className="empty-inspector">
          <FileImage size={28} />
          <p>{t("inspector.empty")}</p>
        </div>
      )}
    </aside>
  );
}

function Filmstrip({
  items,
  selectedId,
  onSelect,
  onRotate,
  onDelete,
  onReveal,
  disabled
}) {
  const { t } = useI18n();
  const selected = items.find((item) => item.id === selectedId);
  return (
    <section className="filmstrip">
      <div className="filmstrip-toolbar">
        <div className="toolbar-group">
          <ToolButton label={t("film.rotateLeft")} onClick={() => onRotate("left")} disabled={!selected || disabled}>
            <RotateCcw size={17} />
          </ToolButton>
          <ToolButton label={t("film.rotateRight")} onClick={() => onRotate("right")} disabled={!selected || disabled}>
            <RotateCw size={17} />
          </ToolButton>
          <ToolButton label={t("film.trash")} onClick={onDelete} disabled={!selected || disabled}>
            <Trash2 size={17} />
          </ToolButton>
        </div>
        <div className="toolbar-summary">
          {items.length
            ? t("film.summary", { selected: selected ? 1 : 0, count: items.length })
            : t("film.none")}
        </div>
        <div className="toolbar-group right">
          <button className="reveal-button" onClick={onReveal}>
            <ExternalLink size={15} />
            {t("film.reveal")}
          </button>
          <button className="zoom-button" aria-label={t("film.zoomOut")}><ZoomOut size={15} /></button>
          <span className="zoom-value">100%</span>
          <button className="zoom-button" aria-label={t("film.zoomIn")}><ZoomIn size={15} /></button>
          <button className="zoom-button" aria-label={t("film.fit")}><Maximize2 size={15} /></button>
        </div>
      </div>
      <div className="thumbnail-rail">
        {items.length ? items.map((item, index) => (
          <button
            key={item.id}
            className={`thumbnail${item.height > item.width ? " portrait" : ""}${selectedId === item.id ? " selected" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            <div className="thumbnail-image">
              <img src={item.url} alt={item.fileName} />
              <span>{index + 1}</span>
            </div>
            <strong>{item.fileName.replace(/\.[^.]+$/, "")}</strong>
          </button>
        )) : (
          <div className="filmstrip-empty">{t("film.empty")}</div>
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [settings, setSettings] = useState({
    outputFolder: "",
    dpi: 600,
    scanMode: "standard",
    colorMode: "color",
    scannerID: "",
    locale: normalizeLocale(navigator.language)
  });
  const t = useMemo(() => createTranslator(settings.locale), [settings.locale]);
  const i18nValue = useMemo(
    () => ({ locale: normalizeLocale(settings.locale), t }),
    [settings.locale, t]
  );
  const [scanners, setScanners] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [progress, setProgress] = useState({ progress: 0, message: "" });
  const [toast, setToast] = useState(null);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId]
  );

  const notify = (message, type = "success") => {
    setToast({ message, type, id: Date.now() });
  };

  const refreshScanners = async (preferredScannerID) => {
    setRefreshing(true);
    try {
      const found = await bridge.listScanners(settings.locale);
      setScanners(found);
      setSettings((current) => ({
        ...current,
        scannerID: found.some((scanner) => scanner.id === (preferredScannerID ?? current.scannerID))
          ? (preferredScannerID ?? current.scannerID)
          : (found[0]?.id || "")
      }));
    } catch (error) {
      notify(error.message || t("toast.scannerError"), "error");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = bridge.onProgress((value) => setProgress(value));
    (async () => {
      const [saved, found] = await Promise.all([
        bridge.getSettings(),
        bridge.listScanners()
      ]);
      if (cancelled) return;
      const initialSettings = {
        ...saved,
        scannerID: found.some((scanner) => scanner.id === saved.scannerID)
          ? saved.scannerID
          : (found[0]?.id || "")
      };
      setScanners(found);
      setSettings(initialSettings);
      setSettingsReady(true);
      if (browserPreview && new URLSearchParams(window.location.search).has("demo")) {
        setBusy(true);
        const result = await bridge.loadDemo(initialSettings);
        if (cancelled) return;
        setSourceUrl(result.sourceUrl);
        setItems(result.items);
        setSelectedId(result.items[0]?.id || "");
        setBusy(false);
      }
    })().catch((error) => notify(error.message, "error"));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!settingsReady) return;
    bridge.saveSettings(settings).catch(() => {});
  }, [settings, settingsReady]);

  useEffect(() => {
    document.documentElement.lang = normalizeLocale(settings.locale);
    document.title = t("app.name");
  }, [settings.locale, t]);

  const chooseFolder = async () => {
    const folder = await bridge.chooseOutputFolder();
    if (folder) setSettings((value) => ({ ...value, outputFolder: folder }));
  };

  const acceptScanResult = (result) => {
    if (!result) return;
    setSourceUrl(result.sourceUrl);
    setItems(result.items);
    setSelectedId(result.items[0]?.id || "");
    setSettings((value) => ({ ...value, outputFolder: result.outputFolder }));
    notify(t("toast.saved", { count: result.items.length }));
  };

  const runScanAction = async (action) => {
    setBusy(true);
    setProgress({ progress: 0.02, message: t("toast.preparing") });
    try {
      const result = await action({ ...settings });
      acceptScanResult(result);
    } catch (error) {
      notify(error.message || t("toast.scanError"), "error");
    } finally {
      setBusy(false);
    }
  };

  const updateSelected = (field, value) => {
    setItems((current) => current.map((item) => (
      item.id === selectedId ? { ...item, [field]: value } : item
    )));
  };

  const applyOne = async () => {
    if (!selectedItem) return;
    setSaving(true);
    try {
      const result = await bridge.applyMetadata({
        ...selectedItem,
        outputFolder: settings.outputFolder,
        locale: settings.locale
      });
      setItems((current) => current.map((item) => (
        item.id === selectedId ? { ...item, url: result.url || item.url } : item
      )));
      notify(t("toast.metadataSaved"));
    } catch (error) {
      notify(error.message || t("toast.metadataError"), "error");
    } finally {
      setSaving(false);
    }
  };

  const applyAll = async () => {
    if (!selectedItem || !items.length) return;
    setSaving(true);
    try {
      await Promise.all(items.map((item) => bridge.applyMetadata({
        ...item,
        capturedAt: selectedItem.capturedAt,
        address: selectedItem.address,
        note: selectedItem.note,
        outputFolder: settings.outputFolder,
        locale: settings.locale
      })));
      setItems((current) => current.map((item) => ({
        ...item,
        capturedAt: selectedItem.capturedAt,
        address: selectedItem.address,
        note: selectedItem.note
      })));
      notify(t("toast.batchSaved", { count: items.length }));
    } catch (error) {
      notify(error.message || t("toast.batchError"), "error");
    } finally {
      setSaving(false);
    }
  };

  const rotateSelected = async (direction) => {
    if (!selectedItem) return;
    setSaving(true);
    try {
      const result = await bridge.rotatePhoto({
        path: selectedItem.path,
        direction,
        outputFolder: settings.outputFolder,
        locale: settings.locale
      });
      setItems((current) => current.map((item) => (
        item.id === selectedId
          ? {
              ...item,
              url: result.url || item.url,
              width: item.height,
              height: item.width
            }
          : item
      )));
    } catch (error) {
      notify(error.message || t("toast.rotateError"), "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedItem) return;
    const confirmed = window.confirm(t("toast.confirmTrash", { name: selectedItem.fileName }));
    if (!confirmed) return;
    try {
      await bridge.trashPhoto({
        path: selectedItem.path,
        outputFolder: settings.outputFolder,
        locale: settings.locale
      });
      const remaining = items.filter((item) => item.id !== selectedId);
      setItems(remaining);
      setSelectedId(remaining[0]?.id || "");
      notify(t("toast.trashed"));
    } catch (error) {
      notify(error.message || t("toast.deleteError"), "error");
    }
  };

  return (
    <I18nContext.Provider value={i18nValue}>
      <div className="app-shell">
      <div className="titlebar">
        <div className="drag-region" />
        <WindowControls />
        <span className="titlebar-label">{t("app.name")}</span>
        <div className="titlebar-actions">
          <label className="language-picker">
            <span className="sr-only">{t("language.label")}</span>
            <select
              aria-label={t("language.label")}
              value={normalizeLocale(settings.locale)}
              onChange={(event) => setSettings((current) => ({
                ...current,
                locale: event.target.value
              }))}
              disabled={busy}
            >
              {supportedLocales.map((locale) => (
                <option value={locale} key={locale}>
                  {locale === "zh-CN" ? t("language.chinese") : t("language.english")}
                </option>
              ))}
            </select>
          </label>
          <button
            className="title-help"
            aria-label={t("help.label")}
            onClick={() => bridge.openHelp?.()}
          >
            <CircleHelp size={16} />
          </button>
        </div>
      </div>

      <div className="workspace">
        <SetupRail
          settings={settings}
          setSettings={setSettings}
          scanners={scanners}
          refreshing={refreshing}
          onRefresh={refreshScanners}
          onChooseFolder={chooseFolder}
          onScan={() => runScanAction(bridge.startScan)}
          onImport={() => runScanAction(bridge.importImage)}
          onDemo={() => runScanAction(bridge.loadDemo)}
          busy={busy}
        />
        <PreviewCanvas
          sourceUrl={sourceUrl}
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          progress={progress}
          busy={busy}
        />
        <Inspector
          item={selectedItem}
          onChange={updateSelected}
          onApply={applyOne}
          onBatchApply={applyAll}
          saving={saving}
          itemCount={items.length}
        />
        <Filmstrip
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRotate={rotateSelected}
          onDelete={deleteSelected}
          onReveal={() => bridge.revealOutput(settings.outputFolder)}
          disabled={saving || busy}
        />
        <footer className="statusbar">
          <span className="system-dot" />
          <span>{t("status.ready")}</span>
          <span className="status-separator" />
          <span>{settings.outputFolder}</span>
        </footer>
      </div>

      {toast ? (
        <div className={`toast ${toast.type}`} role="status">
          {toast.type === "error" ? <CircleHelp size={17} /> : <CheckCircle2 size={17} />}
          <span>{toast.message}</span>
        </div>
      ) : null}
      </div>
    </I18nContext.Provider>
  );
}
