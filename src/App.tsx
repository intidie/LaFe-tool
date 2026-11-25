import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, AppInfo, engine, mergeSettings, Meta, Settings } from "./api";
import { CleanerTab, LipSyncTab, SubtitlesTab } from "./components/Tabs";
import { Bind, Button, Notice, Select, Toggle } from "./components/ui";

type Tab = "sub" | "ls" | "clean";
const TABS: [Tab, string][] = [["sub", "Subtítulos"], ["ls", "Lip-sync (PNGtuber)"], ["clean", "ExifCleaner"]];

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("sub");
  const [panel, setPanel] = useState(false);
  const [fatal, setFatal] = useState("");
  const saveTimer = useRef<number>();

  useEffect(() => {
    (async () => {
      try {
        const [m, i, saved] = await Promise.all([engine<Meta>("meta"), api.appInfo(), api.loadSettings()]);
        setMeta(m);
        setInfo(i);
        setS(mergeSettings(m, saved));
      } catch (e) {
        setFatal(String(e));
      }
    })();
  }, []);

  // La última configuración se guarda sola (con un pequeño retardo para no escribir en cada tecla).
  useEffect(() => {
    if (!s) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => api.saveSettings(s).catch(() => {}), 400);
  }, [s]);

  const set = useCallback((k: string, v: unknown) => setS((old) => (old ? { ...old, [k]: v } : old)), []);

  if (fatal) {
    return (
      <div className="boot">
        <Logo />
        <Notice kind="error"><b>No se pudo iniciar el motor de LaFe Tool.</b><pre>{fatal}</pre></Notice>
        <Button onClick={() => location.reload()}>Reintentar</Button>
      </div>
    );
  }
  if (!meta || !s || !info) {
    return <div className="boot"><Logo /><div className="muted"><span className="spinner" /> Iniciando…</div></div>;
  }

  const b: Bind = { s, set };
  const pickOut = async () => {
    const d = await open({ directory: true, defaultPath: s.out_dir || info.default_output });
    if (typeof d === "string") set("out_dir", d);
  };
  const reset = () => setS({ ...meta.defaults, script: s.script });

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="topbar-right">
          <span className={`chip ${s.clean_meta ? "on" : ""}`} title="Limpieza automática con ExifCleaner al exportar">
            🧹 {s.clean_meta ? "Metadatos limpios" : "Sin limpiar"}
          </span>
          <Button kind="ghost" onClick={() => setPanel(!panel)}>⚙ Ajustes</Button>
        </div>
      </header>

      {panel && (
        <div className="drawer-backdrop" onClick={() => setPanel(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <h3>Ajustes</h3>
            <div className="field">
              <span className="field-label">Carpeta de salida</span>
              <div className="pick">
                <span className="pick-name" title={s.out_dir || info.default_output}>{s.out_dir || info.default_output}</span>
                <Button kind="ghost" onClick={pickOut}>Elegir…</Button>
              </div>
              <div className="btn-row">
                <Button kind="ghost" onClick={async () => api.openPath(await api.ensureDir(s.out_dir))}>Abrir carpeta</Button>
                {s.out_dir && <Button kind="ghost" onClick={() => set("out_dir", "")}>Usar la predeterminada</Button>}
              </div>
            </div>
            <Toggle b={b} k="clean_meta" label="Limpiar metadatos al exportar (ExifCleaner)" />
            <p className="muted small">Cada video y audio exportado pasa por ExifCleaner (ExifTool): se borran todas las
              etiquetas y las fechas de QuickTime, sin recodificar.
              {info.exiftool ? " ExifTool: ✓ disponible." : " ⚠ ExifTool no encontrado."}</p>
            <Select b={b} k="prev_size" label="Tamaño de la vista previa" options={meta.options.prev_size} />
            <div className="field">
              <span className="field-label">Fuentes subidas</span>
              <div className="btn-row"><Button kind="ghost" onClick={() => api.openPath(info.fonts_dir)}>Abrir carpeta de fuentes</Button></div>
            </div>
            <Button kind="danger" onClick={reset}>↺ Restablecer valores de fábrica</Button>
            <p className="muted small">La última configuración usada se guarda sola y se restaura al abrir la app.</p>
            <p className="muted small">LaFe Tool v{info.version}{info.bundled_ffmpeg ? "" : " · FFmpeg del sistema"}</p>
          </aside>
        </div>
      )}

      {!meta.ffmpeg && <Notice kind="error">No se encontró FFmpeg. Reinstala LaFe Tool.</Notice>}
      <main className="content">
        <div hidden={tab !== "sub"}><SubtitlesTab b={b} meta={meta} onFonts={(fonts) => setMeta({ ...meta, fonts })} /></div>
        <div hidden={tab !== "ls"}><LipSyncTab b={b} meta={meta} /></div>
        <div hidden={tab !== "clean"}><CleanerTab exiftool={info.exiftool} active={tab === "clean"} /></div>
      </main>
    </div>
  );
}

function Logo() {
  return (
    <div className="logo">
      <span className="logo-mark">LF</span>
      <span className="logo-text">LaFe <b>Tool</b></span>
    </div>
  );
}
