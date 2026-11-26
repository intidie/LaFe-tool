import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { api, CleanReport, engine, JobResult, Meta, onProgress, prepareRobot } from "../api";
import { Preview } from "./Preview";
import { Result } from "./Result";
import { ScriptVoice } from "./ScriptVoice";
import { StyleEditor } from "./StyleEditor";
import { Bind, Button, Card, Check, Notice, Progress, Row, Select, Slider } from "./ui";

const name = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Ejecuta un trabajo largo del motor con barra de progreso. */
function useJob(tag: string) {
  const [prog, setProg] = useState<{ value: number; msg: string } | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const un = onProgress(tag, (value, msg) => setProg({ value, msg }));
    return () => { un.then((f) => f()); };
  }, [tag]);
  const run = async (fn: () => Promise<JobResult>) => {
    setResult(null);
    setErr("");
    setProg({ value: 0, msg: "Preparando" });
    try {
      setResult(await fn());
    } catch (e) {
      setErr(String(e));
    } finally {
      setProg(null);
    }
  };
  return { prog, result, err, run, busy: prog !== null };
}

function PickFile({ label, value, onPick, exts, kind }: {
  label: string; value: string; onPick: (p: string) => void; exts: string[]; kind: string;
}) {
  const pick = async () => {
    const f = await open({ multiple: false, filters: [{ name: kind, extensions: exts }] });
    if (typeof f === "string") onPick(f);
  };
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="pick">
        <span className={`pick-name ${value ? "" : "muted"}`} title={value}>{value ? name(value) : "Ningún archivo"}</span>
        <Button kind="ghost" onClick={pick}>Elegir…</Button>
        {value && <Button kind="ghost" onClick={() => onPick("")}>Quitar</Button>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Subtítulos
// --------------------------------------------------------------------------- //
export function SubtitlesTab({ b, meta, onFonts }: { b: Bind; meta: Meta; onFonts: (f: string[]) => void }) {
  const { s } = b;
  const job = useJob("render");
  const render = () => job.run(async () => {
    const robot_dir = s.src_mode === meta.src_tts ? await prepareRobot(meta, s, s.script.trim()) : "";
    return engine<JobResult>("render", { settings: s, robot_dir }, { tag: "render", clean: s.clean_meta });
  });
  return (
    <div className="split">
      <div className="controls">
        <ScriptVoice b={b} meta={meta} />
        <Card title="Audio del video">
          <div className="segmented">
            {[meta.src_tts, meta.src_upload].map((o) => (
              <button key={o} className={s.src_mode === o ? "active" : ""} onClick={() => b.set("src_mode", o)}>{o}</button>
            ))}
          </div>
          {s.src_mode === meta.src_upload && (
            <>
              <PickFile label="Audio" value={s.audio_path} onPick={(p) => b.set("audio_path", p)} exts={["mp3", "wav", "m4a"]} kind="Audio" />
              <Row>
                <Slider b={b} k="noise" label="Umbral de ruido" min={-50} max={-10} unit=" dB" />
                <Slider b={b} k="minsil" label="Pausa mínima" min={0.1} max={0.8} step={0.05} unit=" s" />
              </Row>
            </>
          )}
        </Card>
        <StyleEditor b={b} meta={meta} onFonts={onFonts} />
      </div>
      <aside className="side">
        <Preview s={s} />
        <div className="export">
          <h3>Exportar</h3>
          <Row>
            <Select b={b} k="res" label="Resolución" options={meta.options.res} />
            <Select b={b} k="aspect" label="Relación de aspecto" options={meta.options.aspect} />
            <Select b={b} k="fps" label="FPS" options={meta.options.fps} />
            <Select b={b} k="crf" label="Calidad (H.264)" options={meta.options.crf} disabled={!meta.codec_crf[s.codec]} />
          </Row>
          <Select b={b} k="codec" label="Códec (todos compatibles con Premiere Pro)" options={meta.options.codec}
            hint="H.264 pesa poco. ProRes/DNxHR conservan mejor los bordes para el chroma key pero pesan mucho." />
          <Check b={b} k="inc_audio" label="Incluir el audio en el video" />
          <Button kind="primary" full busy={job.busy} onClick={render}>Generar video con subtítulos</Button>
          {job.prog && <Progress {...job.prog} />}
          {job.err && <Notice kind="error"><pre>{job.err}</pre></Notice>}
          {job.result && <Result r={job.result} />}
        </div>
      </aside>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Lip-sync (PNGtuber)
// --------------------------------------------------------------------------- //
function ImageList({ title, list, setList }: { title: string; list: string[]; setList: (l: string[]) => void }) {
  const add = async () => {
    const f = await open({ multiple: true, filters: [{ name: "Imágenes", extensions: ["png", "jpg", "jpeg"] }] });
    if (f && f.length) setList([...list, ...(f as string[])]);
  };
  return (
    <div className="imglist">
      <div className="imglist-head"><b>{title}</b><Button kind="ghost" onClick={add}>Añadir</Button></div>
      <div className="thumbs">
        {list.map((p, i) => (
          <figure key={p + i} className="thumb" title={p}>
            <img src={convertFileSrc(p)} alt="" />
            <button onClick={() => setList(list.filter((_, j) => j !== i))}>Quitar</button>
          </figure>
        ))}
        {!list.length && <span className="muted small">Sin imágenes</span>}
      </div>
    </div>
  );
}

export function LipSyncTab({ b, meta }: { b: Bind; meta: Meta }) {
  const { s } = b;
  const [talking, setTalking] = useState<string[]>([]);
  const [silent, setSilent] = useState<string[]>([]);
  const job = useJob("lipsync");
  const render = () => job.run(async () => {
    const robot_dir = s.ls_audio ? "" : await prepareRobot(meta, s, s.script.trim());
    return engine<JobResult>("lipsync", { settings: s, talking, silent, robot_dir }, { tag: "lipsync", clean: s.clean_meta });
  });
  return (
    <div className="split">
      <div className="controls">
        <Card title="Imágenes">
          <p className="muted small">Alterna imágenes «hablando» y «silencio» según el audio. Sin audio propio, usa la voz del guion.</p>
          <Row>
            <ImageList title="Hablando" list={talking} setList={setTalking} />
            <ImageList title="Silencio" list={silent} setList={setSilent} />
          </Row>
        </Card>
        <Card title="Audio">
          <PickFile label="Audio propio (opcional)" value={s.ls_audio} onPick={(p) => b.set("ls_audio", p)} exts={["mp3", "wav", "m4a"]} kind="Audio" />
          <Row>
            <Slider b={b} k="ls_noise" label="Umbral de ruido" min={-50} max={-10} unit=" dB" hint="Más alto: evita falsos positivos por ruido." />
            <Slider b={b} k="ls_minsil" label="Sensibilidad" min={0.05} max={0.5} step={0.01} unit=" s" hint="Bajo: cambio muy reactivo. Alto: evita parpadeos." />
          </Row>
        </Card>
        <ScriptVoice b={b} meta={meta} />
      </div>
      <aside className="side">
        <div className="export">
          <h3>Exportar lip-sync</h3>
          <Row>
            <Select b={b} k="ls_res" label="Resolución" options={meta.options.ls_res} />
            <Select b={b} k="ls_aspect" label="Relación de aspecto" options={meta.options.ls_aspect} />
            <Select b={b} k="ls_fps" label="FPS" options={meta.options.ls_fps} />
            <Select b={b} k="ls_crf" label="Calidad" options={meta.options.ls_crf} />
          </Row>
          <Button kind="primary" full busy={job.busy} onClick={render}>Generar video lip-sync</Button>
          {job.prog && <Progress {...job.prog} />}
          {job.err && <Notice kind="error"><pre>{job.err}</pre></Notice>}
          {job.result && <Result r={job.result} />}
        </div>
      </aside>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// ExifCleaner
// --------------------------------------------------------------------------- //
export function CleanerTab({ exiftool, active }: { exiftool: boolean; active: boolean }) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const [rows, setRows] = useState<CleanReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [err, setErr] = useState("");

  const clean = async (files: string[]) => {
    if (!files.length) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.cleanFiles(files);
      setRows((old) => [...r, ...old]);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (!activeRef.current) return;
      if (e.payload.type === "over" || e.payload.type === "enter") setHover(true);
      else if (e.payload.type === "leave") setHover(false);
      else if (e.payload.type === "drop") {
        setHover(false);
        clean(e.payload.paths);
      }
    });
    return () => { un.then((f) => f()); };
  }, []);

  const pick = async () => {
    const f = await open({ multiple: true });
    if (f && f.length) clean(f as string[]);
  };

  return (
    <div className="cleaner">
      <div className={`dropzone ${hover ? "hover" : ""}`} onClick={pick}>
        {busy ? <><span className="spinner" /> Limpiando…</> : (
          <>
            <div><b>Arrastra aquí videos, audios o imágenes</b> o haz clic para elegirlos</div>
            <div className="muted small">ExifCleaner: se borran todos los metadatos (EXIF, XMP, QuickTime, fechas, GPS…) y se sobrescribe el archivo.</div>
          </>
        )}
      </div>
      {!exiftool && <Notice kind="error">ExifTool no está disponible. Reinstala LaFe Tool.</Notice>}
      {err && <Notice kind="error">{err}</Notice>}
      {rows.length > 0 && (
        <table className="table">
          <thead><tr><th>Archivo</th><th>Antes</th><th>Después</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.path + i}>
                <td title={r.path}>{name(r.path)}</td>
                <td>{r.before}</td>
                <td>{r.ok ? r.after : "—"}</td>
                <td>{r.ok ? <span className="ok">Limpio</span> : <span className="bad" title={r.error ?? ""}>Error: {r.error}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
