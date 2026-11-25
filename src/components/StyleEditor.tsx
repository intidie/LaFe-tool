import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, engine, Meta } from "../api";
import { Bind, Button, Card, Check, ColorToggle, NumberIn, Notice, Row, Select, Slider } from "./ui";

export function StyleEditor({ b, meta, onFonts }: { b: Bind; meta: Meta; onFonts: (fonts: string[]) => void }) {
  const { s } = b;
  const meme = !!s.meme;
  const poster = !!s.poster;
  const [fontMsg, setFontMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const memeFonts = [meta.auto_font, ...meta.fonts.filter((f) => f !== meta.other_font)];

  const uploadFonts = async () => {
    const files = await open({ multiple: true, filters: [{ name: "Fuentes", extensions: ["zip", "ttf", "otf", "ttc"] }] });
    if (!files || !files.length) return;
    try {
      const fams = await api.installFonts(files as string[]);
      const r = await engine<{ fonts: string[] }>("fonts");
      onFonts(r.fonts);
      setFontMsg({ ok: true, text: `Fuentes instaladas: ${fams.join(", ")}` });
    } catch (e) {
      setFontMsg({ ok: false, text: String(e) });
    }
  };

  return (
    <>
      <Card title="Fuente y texto" icon="🔤">
        <Row cols="1fr auto">
          <Select b={b} k="font" label="Fuente" options={meta.fonts} disabled={meme} />
          <div className="field end"><Button kind="ghost" onClick={uploadFonts} title=".zip con fuentes, .ttf u .otf">⬆ Subir fuente (.zip)</Button></div>
        </Row>
        {fontMsg && <Notice kind={fontMsg.ok ? "ok" : "error"}>{fontMsg.text}</Notice>}
        {s.font === meta.other_font && !meme && (
          <label className="field">
            <span className="field-label">Nombre exacto de la fuente instalada</span>
            <input type="text" value={s.font_custom} onChange={(e) => b.set("font_custom", e.target.value)} />
          </label>
        )}
        <Row cols="1.2fr 1fr 1fr 1fr 1.3fr">
          <NumberIn b={b} k="size" label="Tamaño" min={10} max={400} disabled={meme} />
          <Check b={b} k="bold" label="Negrita" disabled={meme && s.meme_font === meta.auto_font} />
          <Check b={b} k="italic" label="Cursiva" disabled={meme} />
          <Check b={b} k="underline" label="Subrayado" disabled={meme} />
          <Check b={b} k="upper" label="MAYÚSCULAS" />
        </Row>
        {poster && !meme && (
          <p className="muted small">Con «Estilo cartel» activo se ignoran negrita, cursiva, mayúsculas, relleno, trazo, fondo,
            sombra, escalas, tracking, interlineado y resaltado (los fija el cartel).</p>
        )}
      </Card>

      <Card title="Rellenar · Trazo · Fondo · Sombra" icon="🎨">
        <ColorToggle b={b} k="fill" label="Rellenar" />
        <ColorToggle b={b} k="stroke" label="Trazo (contorno exterior)" disabled={meme} />
        <NumberIn b={b} k="stroke" label="Grosor del trazo (px)" min={0} max={30} step={0.5} disabled={!s.stroke_on || meme} />
        <ColorToggle b={b} k="box" label="Fondo (marco sólido de color)" />
        <Row cols="2fr 1fr 1fr">
          <Slider b={b} k="box_op" label="Opacidad del fondo" min={0} max={100} unit=" %" disabled={!s.box_on} />
          <NumberIn b={b} k="box_pad" label="Margen (px)" min={0} max={100} disabled={!s.box_on} />
          <NumberIn b={b} k="box_radius" label="Esquinas (px)" min={0} max={200} step={2} disabled={!s.box_on} />
        </Row>
        <ColorToggle b={b} k="shadow" label="Sombra" disabled={meme} />
        <Row>
          <NumberIn b={b} k="shadow_dist" label="Distancia de la sombra (px)" min={0} max={60} disabled={!s.shadow_on || meme} />
          <Slider b={b} k="shadow_op" label="Opacidad de la sombra" min={0} max={100} unit=" %" disabled={!s.shadow_on || meme} />
        </Row>
        <div className="color-toggle">
          <Check b={b} k="hl" label="Resaltar la palabra activa" disabled={meme} />
          <input type="color" value={s.hl_color} disabled={!s.hl || meme} onChange={(e) => b.set("hl_color", e.target.value.toUpperCase())} />
        </div>
      </Card>

      <Card title="Bloques y animación" icon="✨">
        <Row>
          <Slider b={b} k="words" label="Palabras por bloque" min={1} max={4} />
          <Slider b={b} k="chars" label="Máx. caracteres por línea" min={6} max={24} />
        </Row>
        <Row cols="3fr 1fr">
          <Select b={b} k="entry" label="Animación de entrada" options={meta.options.entry} disabled={meme} />
          <NumberIn b={b} k="in_ms" label="Duración (ms)" min={60} max={600} step={10} disabled={meme} />
        </Row>
        <Row cols="3fr 1fr">
          <Select b={b} k="exit" label="Animación de salida" options={meta.options.exit} disabled={meme} />
          <NumberIn b={b} k="out_ms" label="Duración (ms)" min={60} max={600} step={10} disabled={meme} />
        </Row>
        <Select b={b} k="motion" label="Movimiento continuo" options={meta.options.motion} disabled={meme} />
        <Row>
          <Check b={b} k="letters" label="Animar letras alternas (1 s)" disabled={meme} />
          <Check b={b} k="wobble" label="Vaivén del recuadro cada 0,5 s (±2 px)" disabled={meme} />
        </Row>
      </Card>

      <Card title="Mosaico (solo sobre el subtítulo)" icon="🧩" defaultOpen={false}>
        <Select b={b} k="mosaic" label="Efecto mosaico" options={meta.options.mosaic} />
        <Row>
          <Slider b={b} k="mosaic_px" label="Tamaño del mosaico" min={4} max={120} unit=" px" disabled={s.mosaic === "Sin mosaico"} />
          <Slider b={b} k="mosaic_ms" label="Duración" min={80} max={1000} step={20} unit=" ms"
            disabled={s.mosaic === "Sin mosaico" || s.mosaic === "Siempre"} />
        </Row>
      </Card>

      <Card title="Estilos especiales" icon="🪧">
        <h4>Estilo cartel (SADE · SUPER STAR · INTI-NET)</h4>
        <Row cols="1fr 1fr 1fr">
          <Check b={b} k="poster" label="Estilo cartel serif" disabled={meme} />
          <Check b={b} k="invert" label="Invertir colores" disabled={!poster || meme} />
          <Check b={b} k="grain" label="Granulado" disabled={meme} />
        </Row>
        <h4>Estilo meme (texto simple, baja calidad)</h4>
        <Check b={b} k="meme" label="Texto repartido por toda la pantalla y de baja calidad" />
        {meme && (
          <>
            <Row cols="1fr 1fr 1fr">
              <Slider b={b} k="meme_q" label="Calidad" min={5} max={100} hint="Más bajo = más borroso" />
              <Slider b={b} k="meme_cond" label="Ancho de letra" min={50} max={120} unit=" %" />
              <Slider b={b} k="meme_w" label="Ancho del bloque" min={40} max={100} unit=" %" />
            </Row>
            <Select b={b} k="meme_font" label="Fuente del meme" options={memeFonts} />
            <p className="muted small">Color de la letra = «Rellenar». Marco centrado = «Fondo». Sin «Stamp RSPK One-Medium»
              (súbela con «Subir fuente») se usa Cousine Bold. Recomendado: 4-6 palabras por bloque y 12-16 caracteres por línea.</p>
          </>
        )}
      </Card>

      <Card title="Transformar (valores de Premiere Pro)" icon="📐" defaultOpen={false}>
        <Row>
          <NumberIn b={b} k="sx" label="Escala horizontal (%)" min={10} max={600} disabled={meme} />
          <NumberIn b={b} k="sy" label="Escala vertical (%)" min={10} max={600} disabled={meme} />
          <NumberIn b={b} k="track" label="Tracking" min={-500} max={500} disabled={meme} />
          <NumberIn b={b} k="lead" label="Interlineado" min={-300} max={300} disabled={meme} />
          <NumberIn b={b} k="px" label="Posición X (sobre 1080)" min={0} max={4000} disabled={meme} />
          <NumberIn b={b} k="py" label="Posición Y (sobre 1920)" min={0} max={4000} disabled={meme} />
        </Row>
      </Card>
    </>
  );
}
