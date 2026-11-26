"""Motor de render de LaFe Tool.

Proceso hijo del backend en Rust (src-tauri/src/engine.rs). Protocolo: una petición JSON por línea en stdin
    {"id": 1, "cmd": "preview", "args": {...}}
y por stdout, una línea JSON por evento:
    {"id": 1, "type": "progress", "value": 0.4, "msg": "Renderizando"}
    {"id": 1, "type": "result", "data": {...}}   |   {"id": 1, "type": "error", "message": "..."}
Cada petición se atiende en su propio hilo (las previsualizaciones no esperan a un render largo).
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import uuid
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path

# Sin ventanas de consola para ffmpeg/ffprobe: el motor corre sin consola, así que cada hijo abriría la suya.
if os.name == "nt":
    _orig_init = subprocess.Popen.__init__

    def _no_window_init(self, *a, **kw):
        kw["creationflags"] = kw.get("creationflags", 0) | 0x08000000
        _orig_init(self, *a, **kw)

    subprocess.Popen.__init__ = _no_window_init  # type: ignore[method-assign]

from media import (  # noqa: E402
    ASPECT_MAP, CRF_MAP, RES_MAP, build_intervals, detect_silence, ffmpeg_available, get_duration, make_lipsync,
    speech_segments, target_dims,
)
from robot_tts import (  # noqa: E402
    ROBOT_DEFAULTS, ROBOT_ENTRY, ROBOT_LANGS, ROBOT_VARIANTS, ROBOT_WAV_DIR, make_robot_id,
)
from sapi_tts import list_voices as sapi_voices  # noqa: E402
from subtitles import (  # noqa: E402
    CODECS, ENTRY_STYLES, EXIT_STYLES, MOSAIC_MODES, MOTION_STYLES, CaptionStyle, Word, _font_info, _metrics,
    block_duration_ms, estimate_word_timings, font_substitutions, list_font_families, name_from_text,
    preview_block_count, render_captions, render_preview_clip, render_preview_png, synthesize_with_timings, tokenize,
    unique_path,
)

VOICES = {
    "Español (España) - Álvaro (Masculino)": "es-ES-AlvaroNeural",
    "Español (España) - Elvira (Femenino)": "es-ES-ElviraNeural",
    "Español (México) - Jorge (Masculino)": "es-MX-JorgeNeural",
    "Español (México) - Dalia (Femenino)": "es-MX-DaliaNeural",
    "Español (Colombia) - Gonzalo (Masculino)": "es-CO-GonzaloNeural",
    "Español (Colombia) - Salome (Femenino)": "es-CO-SalomeNeural",
}
SRC_TTS = "Generar voz con TTS (tiempos exactos por palabra)"
SRC_UPLOAD = "Usar un audio propio (tiempos estimados)"
OTHER_FONT = "Otra (escribir el nombre)..."
AUTO_FONT = "Automática (Stamp RSPK si está instalada)"
PREV_SIZES = {"Pequeña": 420, "Mediana": 560, "Grande": 720}

DEFAULTS = {
    "script": "",
    "voice": "Español (Colombia) - Salome (Femenino)", "speed": 50, "pitch": -25,
    "r_lang": "es-la - Spanish, Latin America", "r_variant": "None", "r_amp": ROBOT_DEFAULTS["amp"],
    "r_pitch": ROBOT_DEFAULTS["pitch"], "r_speed": ROBOT_DEFAULTS["speed"], "r_gap": ROBOT_DEFAULTS["gap"],
    "src_mode": SRC_TTS, "audio_path": "", "noise": -35, "minsil": 0.25,
    "font": "Bebas Neue", "font_custom": "", "size": 150.0, "bold": False, "italic": True, "underline": False,
    "upper": False, "fill_on": True, "fill_color": "#FFFFFF", "stroke_on": True, "stroke_color": "#000000",
    "stroke": 4.0, "box_on": False, "box_color": "#000000", "box_op": 100, "box_pad": 10.0, "box_radius": 0.0,
    "shadow_on": False, "shadow_color": "#000000", "shadow_dist": 6.0, "shadow_op": 60,
    "words": 1, "chars": 10, "entry": "Pop: crece", "exit": "Sin animación de salida",
    "motion": "Sin movimiento continuo", "in_ms": 110, "out_ms": 160, "letters": True, "wobble": True,
    "mosaic": "Sin mosaico", "mosaic_px": 36, "mosaic_ms": 300, "poster": True, "invert": False, "grain": False,
    "meme": False, "meme_font": AUTO_FONT, "meme_q": 35, "meme_cond": 100, "meme_w": 92, "hl": True,
    "hl_color": "#FFE600", "sx": 135.0, "sy": 308.0, "track": -55.0, "lead": -54.0, "px": 535.1, "py": 500.0,
    "res": "2K (2560x1440)", "aspect": "9:16 (Vertical)", "fps": 60, "codec": next(iter(CODECS)),
    "crf": "Máxima (CRF 18)", "inc_audio": True,
    "ls_audio": "", "ls_noise": -35, "ls_minsil": 0.10, "ls_res": "1080p Full HD (1920x1080)",
    "ls_aspect": "16:9 (Horizontal)", "ls_fps": 30, "ls_crf": "Alta (CRF 23)",
    "out_dir": "", "fonts_folder": "", "clean_meta": True, "prev_size": "Grande",
}
OPTIONS = {
    "voice": list(VOICES) + [ROBOT_ENTRY], "r_lang": list(ROBOT_LANGS), "r_variant": list(ROBOT_VARIANTS),
    "src_mode": [SRC_TTS, SRC_UPLOAD], "entry": list(ENTRY_STYLES), "exit": list(EXIT_STYLES),
    "motion": list(MOTION_STYLES), "mosaic": list(MOSAIC_MODES), "res": list(RES_MAP), "aspect": list(ASPECT_MAP),
    "fps": [24, 30, 60], "codec": list(CODECS), "crf": list(CRF_MAP), "ls_res": list(RES_MAP),
    "ls_aspect": list(ASPECT_MAP), "ls_fps": [24, 30, 60], "ls_crf": list(CRF_MAP), "prev_size": list(PREV_SIZES),
}

def refresh_voice_options() -> None:
    """Añade al menú las voces SAPI instaladas en Windows (Loquendo, Microsoft…), entre Edge y la robótica."""
    OPTIONS["voice"] = list(VOICES) + list(sapi_voices()) + [ROBOT_ENTRY]


FONTS_DIR = Path(".")
TEMP_DIR = Path(tempfile.gettempdir()) / "lafe-tool"
_out_lock = threading.Lock()


def emit(obj: dict) -> None:
    line = json.dumps(obj, ensure_ascii=False)
    with _out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


# --------------------------------------------------------------------------- #
# Ajustes -> estilo / voz
# --------------------------------------------------------------------------- #
def norm(s: dict) -> dict:
    """Ajustes completos y válidos: lo que falte o no encaje se toma de DEFAULTS."""
    out = dict(DEFAULTS)
    for k, v in (s or {}).items():
        d = DEFAULTS.get(k)
        if d is None or isinstance(v, bool) != isinstance(d, bool):
            continue
        if isinstance(d, (int, float)) and not isinstance(d, bool) and isinstance(v, (int, float)):
            v = type(d)(v)
        if type(v) is type(d) and (k not in OPTIONS or v in OPTIONS[k]):
            out[k] = v
    return out


def style_of(s: dict) -> CaptionStyle:
    font = s["font_custom"].strip() if s["font"] == OTHER_FONT else s["font"]
    return CaptionStyle(
        font_family=font or DEFAULTS["font"], font_size=s["size"], italic=s["italic"], bold=s["bold"],
        underline=s["underline"], uppercase=s["upper"], fill_on=s["fill_on"], fill=s["fill_color"],
        stroke_on=s["stroke_on"], stroke=s["stroke_color"], stroke_px=s["stroke"],
        box_on=s["box_on"], box_color=s["box_color"], box_opacity=s["box_op"], box_pad=s["box_pad"],
        box_radius=s["box_radius"], shadow_on=s["shadow_on"], shadow_color=s["shadow_color"],
        shadow_dist=s["shadow_dist"], shadow_opacity=s["shadow_op"],
        scale_x=s["sx"], scale_y=s["sy"], tracking=s["track"], leading=s["lead"], pos_x=s["px"], pos_y=s["py"],
        words_per_block=s["words"], max_chars_line=s["chars"], highlight=s["hl"], highlight_color=s["hl_color"],
        entry_style=ENTRY_STYLES[s["entry"]], exit_style=EXIT_STYLES[s["exit"]], motion=MOTION_STYLES[s["motion"]],
        in_ms=s["in_ms"], out_ms=s["out_ms"], letter_anim=s["letters"], wobble=s["wobble"],
        mosaic=MOSAIC_MODES[s["mosaic"]], mosaic_px=s["mosaic_px"], mosaic_ms=s["mosaic_ms"],
        poster=s["poster"], invert=s["invert"], grain=s["grain"], meme=s["meme"],
        meme_font="" if s["meme_font"] == AUTO_FONT else s["meme_font"], meme_quality=s["meme_q"],
        meme_condense=s["meme_cond"], meme_width=s["meme_w"],
    )


def voice_args(s: dict) -> tuple:
    sapi = sapi_voices()
    if s["voice"] in sapi:
        return sapi[s["voice"]], f"{s['speed']:+d}%", ""
    if s["voice"] == ROBOT_ENTRY:
        return make_robot_id(s["r_lang"], s["r_variant"], s["r_amp"], s["r_pitch"], s["r_speed"], s["r_gap"]), "", ""
    return VOICES[s["voice"]], f"{s['speed']:+d}%", f"{s['pitch']:+d}Hz"


def out_dir(s: dict) -> Path:
    raw = (s.get("out_dir") or "").strip().strip('"')
    d = Path(os.path.expandvars(raw)).expanduser() if raw else Path.home() / "Videos" / "LaFe Tool"
    d.mkdir(parents=True, exist_ok=True)
    return d


# --------------------------------------------------------------------------- #
# Cachés
# --------------------------------------------------------------------------- #
_tts_cache: "dict[tuple, tuple]" = {}


def tts(text: str, voice_id: str, rate: str, pitch: str, robot_dir: str = ""):
    """(mp3 bytes, palabras, modo). Se cachea: cambiar el estilo y volver a renderizar no repite el TTS."""
    key = (text, voice_id, rate, pitch)
    if key in _tts_cache:
        return _tts_cache[key]
    ROBOT_WAV_DIR.set(robot_dir)
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "a.mp3"
        words, mode = synthesize_with_timings(text, voice_id, rate, pitch, out)
        res = (out.read_bytes(), tuple((w.text, w.start, w.end) for w in words), mode)
    if len(_tts_cache) > 6:
        _tts_cache.pop(next(iter(_tts_cache)))
    _tts_cache[key] = res
    return res


@lru_cache(maxsize=160)
def cached_png(style_json: str, text: str, w: int, h: int, block: int, t_ms: int):
    return render_preview_png(CaptionStyle(**json.loads(style_json)), text, FONTS_DIR, w, h, block, t_ms)


@lru_cache(maxsize=6)
def cached_clip(style_json: str, text: str, w: int, h: int):
    return render_preview_clip(CaptionStyle(**json.loads(style_json)), text, FONTS_DIR, w, h)


def font_list() -> list:
    return list_font_families(str(FONTS_DIR)) + [OTHER_FONT]


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def preview_dims(s: dict) -> tuple:
    pw, ph = target_dims(s["res"], s["aspect"])
    sc = PREV_SIZES[s["prev_size"]] / max(pw, ph)
    return int(pw * sc) // 2 * 2, int(ph * sc) // 2 * 2


def job_dir() -> Path:
    d = TEMP_DIR / f"job_{uuid.uuid4().hex[:8]}"
    d.mkdir(parents=True)
    return d


# --------------------------------------------------------------------------- #
# Comandos
# --------------------------------------------------------------------------- #
def cmd_meta(a, say):
    refresh_voice_options()
    return {"sapi_voices": list(sapi_voices()), "defaults": DEFAULTS, "options": OPTIONS, "fonts": font_list(), "other_font": OTHER_FONT,
            "auto_font": AUTO_FONT, "robot_entry": ROBOT_ENTRY, "src_tts": SRC_TTS, "src_upload": SRC_UPLOAD,
            "robot_langs": ROBOT_LANGS, "robot_variants": ROBOT_VARIANTS,
            "codec_crf": {k: v["uses_crf"] for k, v in CODECS.items()}, "ffmpeg": ffmpeg_available()}


def cmd_fonts(a, say):
    for f in (list_font_families, _font_info, _metrics, cached_png, cached_clip):
        f.cache_clear()
    return {"fonts": font_list()}


def cmd_tokenize(a, say):
    return {"tokens": tokenize(a.get("text", ""))}


def cmd_preview(a, say):
    s = norm(a["settings"])
    style = style_of(s)
    style_json = json.dumps(asdict(style))
    text = " ".join(tokenize(s["script"])[:40])
    n = preview_block_count(text, style)
    block = max(1, min(int(a.get("block", 1)), n)) - 1
    dur = block_duration_ms(text, style, block)
    t_ms = max(0, min(int(a.get("t_ms", 400)), dur))
    pw, ph = preview_dims(s)
    png, log = cached_png(style_json, text, pw, ph, block, t_ms)
    if not png:
        raise RuntimeError("No se pudo generar la previsualización.\n" + log[-1200:])
    warn = [f"La fuente «{r}» no está instalada: se usa «{u}». Súbela en «Fuentes»." for r, u in font_substitutions(log)]
    return {"png": b64(png), "blocks": n, "block": block + 1, "dur_ms": dur, "t_ms": t_ms, "w": pw, "h": ph,
            "warnings": warn}


def cmd_clip(a, say):
    s = norm(a["settings"])
    style_json = json.dumps(asdict(style_of(s)))
    text = " ".join(tokenize(s["script"])[:40])
    pw, ph = preview_dims(s)
    clip, log = cached_clip(style_json, text, pw * 3 // 4 // 2 * 2, ph * 3 // 4 // 2 * 2)
    if not clip:
        raise RuntimeError("No se pudo generar el clip.\n" + log[-1200:])
    return {"mp4": b64(clip)}


def cmd_tts(a, say):
    """Audio de la voz. sample=True: solo las 12 primeras palabras, devuelto en base64 (no se guarda)."""
    s = norm(a["settings"])
    text = (a.get("text") or s["script"]).strip()
    if not text:
        raise RuntimeError("Escribe el guion primero.")
    if a.get("sample"):
        text = " ".join(text.split()[:12])
    say(0.1, "Generando voz")
    mp3 = tts(text, *voice_args(s), a.get("robot_dir", ""))[0]
    if a.get("sample"):
        return {"mp3": b64(mp3)}
    path = unique_path(out_dir(s), name_from_text(text), "mp3")
    path.write_bytes(mp3)
    return {"path": str(path), "info": "Audio de voz (MP3)"}


def cmd_render(a, say):
    s = norm(a["settings"])
    text = s["script"].strip()
    if not text:
        raise RuntimeError("Escribe el guion primero.")
    upload = s["src_mode"] == SRC_UPLOAD
    if upload and not Path(s["audio_path"]).is_file():
        raise RuntimeError("Elige un archivo de audio o cambia la fuente del audio a TTS.")
    work = job_dir()
    try:
        if upload:
            say(0.02, "Analizando audio")
            audio = Path(s["audio_path"])
            segs = speech_segments(build_intervals(get_duration(audio), detect_silence(audio, s["noise"], s["minsil"])))
            words, mode = estimate_word_timings(tokenize(text), segs), "estimados"
        else:
            say(0.02, "Generando voz y tiempos por palabra")
            mp3, wt, mode = tts(text, *voice_args(s), a.get("robot_dir", ""))
            audio = work / "audio.mp3"
            audio.write_bytes(mp3)
            words = [Word(*w) for w in wt]
        if not words:
            raise RuntimeError("No se obtuvieron palabras con tiempos. Revisa el texto y el audio.")
        total = get_duration(audio) + 0.4
        w, h = target_dims(s["res"], s["aspect"])
        codec = CODECS[s["codec"]]
        final = unique_path(out_dir(s), name_from_text(text), codec["ext"])
        t0 = time.time()
        tmp_out = work / f"out.{codec['ext']}"
        ok, err = render_captions(words, style_of(s), w, h, s["fps"], s["codec"], CRF_MAP[s["crf"]], FONTS_DIR, work,
                                  tmp_out, audio if s["inc_audio"] else None, total, progress=say)
        if not ok:
            raise RuntimeError("Falló el renderizado.\n" + err)
        shutil.move(str(tmp_out), str(final))
        return {"path": str(final), "info": f"{len(words)} palabras · tiempos {mode} · {w}x{h} @ {s['fps']} fps · "
                                            f"{codec['ext'].upper()} · renderizado en {time.time() - t0:.0f} s"}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def cmd_lipsync(a, say):
    s = norm(a["settings"])
    talking, silent = [Path(p) for p in a.get("talking", [])], [Path(p) for p in a.get("silent", [])]
    text = s["script"].strip()
    if not (talking and silent):
        raise RuntimeError("Elige al menos una imagen «hablando» y una «silencio».")
    if not (s["ls_audio"] or text):
        raise RuntimeError("Elige un audio o escribe un guion para generar la voz.")
    work = job_dir()
    try:
        if s["ls_audio"]:
            audio = Path(s["ls_audio"])
        else:
            say(0.02, "Generando voz")
            audio = work / "audio.mp3"
            audio.write_bytes(tts(text, *voice_args(s), a.get("robot_dir", ""))[0])
        w, h = target_dims(s["ls_res"], s["ls_aspect"])
        final = unique_path(out_dir(s), name_from_text(text, fallback="lipsync") + "_lipsync", "mp4")
        ok, err, n = make_lipsync(audio, talking, silent, work / "out.mp4", work, w, h, s["ls_fps"],
                                  CRF_MAP[s["ls_crf"]], s["ls_noise"], s["ls_minsil"], progress=say)
        if not ok:
            raise RuntimeError("Falló el renderizado.\n" + err)
        shutil.move(str(work / "out.mp4"), str(final))
        return {"path": str(final), "info": f"{n} segmentos · {w}x{h} @ {s['ls_fps']} fps"}
    finally:
        shutil.rmtree(work, ignore_errors=True)


COMMANDS = {"meta": cmd_meta, "fonts": cmd_fonts, "tokenize": cmd_tokenize, "preview": cmd_preview,
            "clip": cmd_clip, "tts": cmd_tts, "render": cmd_render, "lipsync": cmd_lipsync}


def handle(req: dict) -> None:
    rid = req.get("id")
    last = [0.0]

    def say(value: float, msg: str = "") -> None:
        now = time.time()
        if now - last[0] > 0.25 or value >= 1:
            last[0] = now
            emit({"id": rid, "type": "progress", "value": round(float(value), 4), "msg": msg})

    try:
        fn = COMMANDS.get(req.get("cmd"))
        if fn is None:
            raise RuntimeError(f"Comando desconocido: {req.get('cmd')}")
        emit({"id": rid, "type": "result", "data": fn(req.get("args") or {}, say)})
    except Exception as exc:  # noqa: BLE001
        emit({"id": rid, "type": "error", "message": str(exc) or exc.__class__.__name__,
              "trace": traceback.format_exc()[-2000:]})


def main() -> None:
    global FONTS_DIR, TEMP_DIR
    args = sys.argv[1:]
    if "--fonts" in args:
        FONTS_DIR = Path(args[args.index("--fonts") + 1])
    if "--temp" in args:
        TEMP_DIR = Path(args[args.index("--temp") + 1])
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=refresh_voice_options, daemon=True).start()   # lista de voces SAPI en segundo plano
    for old in TEMP_DIR.glob("job_*"):
        shutil.rmtree(old, ignore_errors=True)
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stdin.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    emit({"id": 0, "type": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if line:
            threading.Thread(target=handle, args=(json.loads(line),), daemon=True).start()


if __name__ == "__main__":
    main()
