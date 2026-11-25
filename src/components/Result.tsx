import { convertFileSrc } from "@tauri-apps/api/core";
import { api, JobResult } from "../api";
import { Button, Notice } from "./ui";

export function Result({ r }: { r: JobResult }) {
  const ext = r.path.split(".").pop()?.toLowerCase() ?? "";
  const c = r.cleaned;
  return (
    <div className="result">
      <Notice kind="ok">
        <b>Listo.</b> {r.info}
        <div className="path">{r.path}</div>
      </Notice>
      {c && (c.ok
        ? <Notice kind="ok">🧹 ExifCleaner: {c.before} etiquetas de metadatos → {c.after}</Notice>
        : <Notice kind="warn">ExifCleaner no pudo limpiar el archivo: {c.error}</Notice>)}
      {ext === "mp4" && <video className="result-video" src={convertFileSrc(r.path)} controls />}
      {ext === "mp3" && <audio src={convertFileSrc(r.path)} controls style={{ width: "100%" }} />}
      {ext === "mov" && <p className="muted">Los .mov (ProRes/DNxHR) no se reproducen aquí: ábrelo en Premiere Pro.</p>}
      <div className="btn-row">
        <Button onClick={() => api.openPath(r.path)}>Abrir</Button>
        <Button onClick={() => api.openPath(r.path, true)}>Mostrar en la carpeta</Button>
      </div>
    </div>
  );
}
