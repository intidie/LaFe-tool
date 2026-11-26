"""Voces SAPI 5 instaladas en Windows (Microsoft, Loquendo, IVONA, etc.) con tiempos exactos por palabra.

Se usa System.Speech desde PowerShell de 64 y de 32 bits: muchas voces clásicas (como Loquendo) solo se registran
para procesos de 32 bits. El evento SpeakProgress da el instante de cada palabra en el audio.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import wave
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Tuple

from subtitles import Word, tokenize

PREFIX = "sapi:"
WINDIR = os.environ.get("SystemRoot", r"C:\Windows")
POWERSHELL = {
    "64": Path(WINDIR) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe",
    "32": Path(WINDIR) / "SysWOW64" / "WindowsPowerShell" / "v1.0" / "powershell.exe",
}

_CSHARP = r"""
using System; using System.Text; using System.Globalization; using System.Speech.Synthesis;
public static class LafeSapi {
  public static string Voices() {
    var sb = new StringBuilder();
    using (var s = new SpeechSynthesizer()) {
      foreach (var v in s.GetInstalledVoices()) {
        if (!v.Enabled) continue;
        sb.Append(v.VoiceInfo.Name).Append('\t').Append(v.VoiceInfo.Culture.Name).Append('\n');
      }
    }
    return sb.ToString();
  }
  public static string Speak(string voice, int rate, string text, string wav) {
    var sb = new StringBuilder(); var gate = new object();
    using (var s = new SpeechSynthesizer()) {
      s.SelectVoice(voice); s.Rate = rate; s.SetOutputToWaveFile(wav);
      s.SpeakProgress += (o, e) => { lock (gate) {
        sb.Append(e.AudioPosition.TotalMilliseconds.ToString(CultureInfo.InvariantCulture)).Append('\t')
          .Append(e.CharacterPosition).Append('\n'); } };
      s.Speak(text);
      s.SetOutputToNull();
    }
    return sb.ToString();
  }
}
"""

_PS = r"""
param([string]$cfg)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$c = Get-Content -Raw -Encoding UTF8 $cfg | ConvertFrom-Json
Add-Type -ReferencedAssemblies System.Speech -TypeDefinition (Get-Content -Raw -Encoding UTF8 $c.cs)
if ($c.op -eq 'voices') { $r = [LafeSapi]::Voices() }
else { $r = [LafeSapi]::Speak($c.voice, [int]$c.rate, [string]$c.text, $c.wav) }
[IO.File]::WriteAllText($c.out, $r, [Text.Encoding]::UTF8)
"""


def is_sapi(voice_id: str) -> bool:
    return voice_id.startswith(PREFIX)


def _run(bits: str, cfg: dict, timeout: int = 600) -> str:
    ps = POWERSHELL.get(bits)
    if not ps or not ps.exists():
        raise RuntimeError(f"PowerShell de {bits} bits no disponible")
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / "s.cs").write_text(_CSHARP, encoding="utf-8")
        (d / "s.ps1").write_text(_PS, encoding="utf-8-sig")
        cfg = {**cfg, "cs": str(d / "s.cs"), "out": str(d / "out.txt")}
        (d / "cfg.json").write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
        r = subprocess.run([str(ps), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
                            str(d / "s.ps1"), str(d / "cfg.json")], capture_output=True, text=True, timeout=timeout)
        out = d / "out.txt"
        if r.returncode != 0 or not out.exists():
            raise RuntimeError((r.stderr or r.stdout or "SAPI falló").strip()[-500:])
        return out.read_text(encoding="utf-8-sig")


@lru_cache(maxsize=1)
def list_voices() -> Dict[str, str]:
    """{etiqueta del menú: id}. Las voces de 64 bits tienen prioridad; las de 32 bits se añaden si faltan."""
    if os.name != "nt":
        return {}
    found: Dict[str, Tuple[str, str]] = {}
    for bits in ("64", "32"):
        try:
            for line in _run(bits, {"op": "voices"}, timeout=60).splitlines():
                name, _, culture = line.partition("\t")
                if name and name not in found:
                    found[name] = (bits, culture)
        except Exception:
            continue
    return {f"Windows · {n}" + (f" ({c})" if c else ""): f"{PREFIX}{b}:{n}" for n, (b, c) in sorted(found.items())}


def synthesize_sapi(text: str, voice_id: str, rate: str, out_path: Path) -> Tuple[List[Word], str]:
    """Genera el MP3 con la voz SAPI y devuelve (palabras con tiempos, "exacto"). rate "+20%" -> Rate -10..10."""
    _, bits, name = voice_id.split(":", 2)
    m = re.search(r"-?\d+", rate or "")
    sapi_rate = max(-10, min(10, round(int(m.group()) / 5))) if m else 0
    clean = " ".join(tokenize(text))
    tokens = clean.split(" ") if clean else []
    if not tokens:
        return [], "exacto"
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "v.wav"
        raw = _run(bits, {"op": "speak", "voice": name, "rate": sapi_rate, "text": clean, "wav": str(wav)})
        with wave.open(str(wav), "rb") as w:
            duration = w.getnframes() / float(w.getframerate())
        # Palabra que contiene cada posición de carácter -> instante de inicio.
        offsets, pos = [], 0
        for t in tokens:
            offsets.append(pos)
            pos += len(t) + 1
        starts: List[float] = [-1.0] * len(tokens)
        for line in raw.splitlines():
            ms, _, cpos = line.partition("\t")
            try:
                t_s, c = float(ms) / 1000.0, int(cpos)
            except ValueError:
                continue
            idx = max(i for i, o in enumerate(offsets) if o <= c) if c >= 0 else 0
            if starts[idx] < 0:
                starts[idx] = t_s
        # Palabras sin evento: se reparten entre las conocidas.
        known = [(i, s) for i, s in enumerate(starts) if s >= 0]
        if not known:
            step = duration / len(tokens)
            starts = [i * step for i in range(len(tokens))]
        else:
            for i in range(len(tokens)):
                if starts[i] >= 0:
                    continue
                prev = max(((j, s) for j, s in known if j < i), default=(-1, 0.0))
                nxt = min(((j, s) for j, s in known if j > i), default=(len(tokens), duration))
                starts[i] = prev[1] + (nxt[1] - prev[1]) * (i - prev[0]) / (nxt[0] - prev[0])
        words = []
        for i, t in enumerate(tokens):
            end = starts[i + 1] if i + 1 < len(tokens) else duration
            words.append(Word(t, starts[i], max(end, starts[i] + 0.05)))
        c = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-ar", "48000", "-c:a", "libmp3lame",
                            "-q:a", "2", str(out_path)], capture_output=True, text=True)
        if c.returncode != 0 or not out_path.exists():
            raise RuntimeError(f"No se pudo crear el MP3: {c.stderr[-300:]}")
    return words, "exacto"
