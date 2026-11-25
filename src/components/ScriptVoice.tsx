import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, engine, firstWords, JobResult, Meta, prepareRobot } from "../api";
import { Result } from "./Result";
import { Bind, Button, Card, NumberIn, Notice, Row, Select, Slider } from "./ui";

export function ScriptVoice({ b, meta }: { b: Bind; meta: Meta }) {
  const { s } = b;
  const robot = s.voice === meta.robot_entry;
  const [sample, setSample] = useState<string>("");
  const [busy, setBusy] = useState<"" | "sample" | "mp3">("");
  const [err, setErr] = useState("");
  const [mp3, setMp3] = useState<JobResult | null>(null);
  const words = s.script.trim() ? s.script.trim().split(/\s+/).length : 0;

  const loadTxt = async () => {
    const f = await open({ multiple: false, filters: [{ name: "Texto", extensions: ["txt"] }] });
    if (typeof f === "string") b.set("script", await api.readText(f));
  };

  const run = async (kind: "sample" | "mp3") => {
    if (!s.script.trim()) return setErr("Escribe el guion primero.");
    setBusy(kind);
    setErr("");
    try {
      const text = kind === "sample" ? firstWords(s.script) : s.script.trim();
      const robot_dir = await prepareRobot(meta, s, text);
      if (kind === "sample") {
        const r = await engine<{ mp3: string }>("tts", { settings: s, sample: true, robot_dir });
        setSample(`data:audio/mpeg;base64,${r.mp3}`);
      } else {
        setMp3(await engine<JobResult>("tts", { settings: s, robot_dir }, { clean: s.clean_meta }));
      }
    } catch (e) {
      setErr(`No se pudo generar la voz: ${e}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card title="Guion y voz" icon="✍️" aside={<span className="muted">{words} palabras</span>}>
      <textarea className="script" value={s.script} placeholder="Escribe o pega aquí el guion…"
        onChange={(e) => b.set("script", e.target.value)} />
      <div className="btn-row">
        <Button kind="ghost" onClick={loadTxt}>📄 Cargar guion (.txt)</Button>
      </div>
      <Select b={b} k="voice" label="Voz" options={meta.options.voice} />
      {robot ? (
        <>
          <Row cols="1fr 1fr 1fr 1fr">
            <NumberIn b={b} k="r_amp" label="Amplitude" min={0} max={200} step={5} />
            <NumberIn b={b} k="r_pitch" label="Pitch" min={0} max={99} />
            <NumberIn b={b} k="r_speed" label="Speed" min={80} max={450} step={5} />
            <NumberIn b={b} k="r_gap" label="Word gap" min={0} max={50} />
          </Row>
          <Row>
            <Select b={b} k="r_lang" label="Voice" options={meta.options.r_lang} />
            <Select b={b} k="r_variant" label="Variant" options={meta.options.r_variant} />
          </Row>
        </>
      ) : (
        <Row>
          <Slider b={b} k="speed" label="Velocidad" min={-50} max={50} step={5} unit=" %" />
          <Slider b={b} k="pitch" label="Tono" min={-50} max={50} step={5} unit=" Hz" />
        </Row>
      )}
      <Row>
        <Button full busy={busy === "sample"} onClick={() => run("sample")}>🔊 Probar voz (12 palabras)</Button>
        <Button full busy={busy === "mp3"} onClick={() => run("mp3")}>🎙️ Generar solo el audio (MP3)</Button>
      </Row>
      {sample && <audio src={sample} controls autoPlay style={{ width: "100%" }} />}
      {mp3 && <Result r={mp3} />}
      {err && <Notice kind="error">{err}</Notice>}
    </Card>
  );
}
