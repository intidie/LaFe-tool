import { useEffect, useMemo, useRef, useState } from "react";
import { engine, PreviewResult, Settings } from "../api";
import { Button, Notice } from "./ui";

/** Claves que no afectan a la imagen de la vista previa (no disparan un nuevo render). */
const NOT_VISUAL = new Set([
  "voice", "speed", "pitch", "r_lang", "r_variant", "r_amp", "r_pitch", "r_speed", "r_gap", "src_mode", "audio_path",
  "noise", "minsil", "fps", "codec", "crf", "inc_audio", "out_dir", "clean_meta",
  "ls_audio", "ls_noise", "ls_minsil", "ls_res", "ls_aspect", "ls_fps", "ls_crf",
]);

function b64ToUrl(b64: string, type: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

export function Preview({ s }: { s: Settings }) {
  const visual = useMemo(() => {
    const v: Settings = {};
    for (const [k, val] of Object.entries(s)) if (!NOT_VISUAL.has(k)) v[k] = val;
    return JSON.stringify(v);
  }, [s]);
  const [block, setBlock] = useState(1);
  const [t, setT] = useState(400);
  const [prev, setPrev] = useState<PreviewResult | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [clip, setClip] = useState<{ key: string; url: string } | null>(null);
  const [clipBusy, setClipBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await engine<PreviewResult>("preview", { settings: JSON.parse(visual), block, t_ms: t });
        if (id !== seq.current) return;
        setPrev(r);
        setErr("");
      } catch (e) {
        if (id === seq.current) setErr(String(e));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 110);
    return () => clearTimeout(timer);
  }, [visual, block, t]);

  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);

  const playClip = async () => {
    setClipBusy(true);
    try {
      const r = await engine<{ mp4: string }>("clip", { settings: JSON.parse(visual) });
      setClip({ key: visual, url: b64ToUrl(r.mp4, "video/mp4") });
    } catch (e) {
      setErr(String(e));
    } finally {
      setClipBusy(false);
    }
  };

  const blocks = prev?.blocks ?? 1;
  const dur = prev?.dur_ms ?? 800;
  const showClip = clip && clip.key === visual;

  return (
    <div className="preview">
      <div className="preview-head">
        <h3>Vista previa</h3>
        <span className="muted">{prev ? `${prev.w}×${prev.h} · fondo #00008B` : ""}</span>
      </div>
      <div className={`stage ${loading ? "loading" : ""}`}>
        {showClip
          ? <video src={clip!.url} autoPlay loop muted playsInline />
          : prev && <img src={`data:image/png;base64,${prev.png}`} alt="Vista previa" />}
        {!prev && !err && <div className="stage-empty"><span className="spinner" /> Preparando vista previa…</div>}
      </div>
      {!showClip && (
        <div className="scrub">
          {blocks > 1 && (
            <label className="field">
              <span className="field-label">Bloque de texto <b>{Math.min(block, blocks)}</b> / {blocks}</span>
              <input type="range" min={1} max={blocks} value={Math.min(block, blocks)} onChange={(e) => setBlock(Number(e.target.value))} />
            </label>
          )}
          <label className="field">
            <span className="field-label">Instante de la animación <b>{Math.min(t, dur)} ms</b></span>
            <input type="range" min={0} max={dur} step={20} value={Math.min(t, dur)} onChange={(e) => setT(Number(e.target.value))} />
          </label>
        </div>
      )}
      <div className="btn-row">
        {showClip
          ? <Button full onClick={() => setClip(null)}>Volver al fotograma</Button>
          : <Button full busy={clipBusy} onClick={playClip}>Reproducir animaciones</Button>}
      </div>
      {prev?.warnings.map((w) => <Notice key={w} kind="warn">{w}</Notice>)}
      {err && <Notice kind="error"><pre>{err}</pre></Notice>}
    </div>
  );
}
