import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Settings = Record<string, any>;

export interface Meta {
  defaults: Settings;
  sapi_voices: string[];
  options: Record<string, (string | number)[]>;
  fonts: string[];
  other_font: string;
  auto_font: string;
  robot_entry: string;
  src_tts: string;
  src_upload: string;
  robot_langs: Record<string, string>;
  robot_variants: Record<string, string>;
  codec_crf: Record<string, boolean>;
  ffmpeg: boolean;
}

export interface AppInfo {
  version: string;
  fonts_dir: string;
  default_output: string;
  exiftool: boolean;
  bundled_ffmpeg: boolean;
}

export interface CleanReport {
  path: string;
  before: number;
  after: number;
  ok: boolean;
  error: string | null;
}

export interface JobResult {
  path: string;
  info: string;
  cleaned?: CleanReport;
}

export interface PreviewResult {
  png: string;
  blocks: number;
  block: number;
  dur_ms: number;
  t_ms: number;
  w: number;
  h: number;
  warnings: string[];
}

export const engine = <T>(cmd: string, args: Record<string, unknown> = {}, opts: { tag?: string; clean?: boolean } = {}) =>
  invoke<T>("engine", { cmd, args, tag: opts.tag ?? null, clean: opts.clean ?? false });

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  loadSettings: () => invoke<Settings>("load_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  cleanFiles: (files: string[]) => invoke<CleanReport[]>("clean_files", { files }),
  installFonts: (files: string[]) => invoke<string[]>("install_fonts", { files }),
  readText: (path: string) => invoke<string>("read_text_file", { path }),
  saveRobotWavs: (wavs: string[]) => invoke<string>("save_robot_wavs", { wavs }),
  openPath: (path: string, reveal = false) => invoke<void>("open_path", { path, reveal }),
  ensureDir: (path: string) => invoke<string>("ensure_dir", { path }),
  importFontFolder: (folder: string) => invoke<string[]>("import_font_folder", { folder }),
};

export function onProgress(tag: string, cb: (value: number, msg: string) => void) {
  return listen<{ tag: string; value: number; msg: string }>("engine-progress", (e) => {
    if (e.payload.tag === tag) cb(e.payload.value, e.payload.msg);
  });
}

/** Ajustes guardados mezclados con los de fábrica: solo se aceptan valores del mismo tipo y opciones válidas. */
export function mergeSettings(meta: Meta, saved: Settings): Settings {
  const out: Settings = { ...meta.defaults };
  for (const [k, v] of Object.entries(saved ?? {})) {
    const d = meta.defaults[k];
    if (d === undefined || typeof v !== typeof d) continue;
    if (meta.options[k] && !meta.options[k].includes(v)) continue;
    out[k] = v;
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Voz robótica: meSpeak.js en un Web Worker
// --------------------------------------------------------------------------- //
// mespeak-core.js trae su propio modo Web Worker: mensajes {job, args, jobId} -> {rsp, jobId, ...}.
let worker: Worker | null = null;
let seq = 0;
const voiceIds: Record<string, string> = {};

function job(name: string, args: unknown[]): Promise<any> {
  worker ??= new Worker("/mespeak/mespeak-core.js");
  const jobId = ++seq;
  return new Promise((resolve) => {
    const w = worker!;
    const handler = (e: MessageEvent) => {
      if (e.data?.jobId !== jobId) return;
      w.removeEventListener("message", handler);
      resolve(e.data);
    };
    w.addEventListener("message", handler);
    w.postMessage({ job: name, args, jobId });
  });
}

function toBase64(buf: ArrayBuffer | ArrayLike<number>): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf as ArrayBuffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function speakWords(o: { voice: string; variant: string; items: string[]; speed: number; pitch: number; amplitude: number }) {
  if (!voiceIds[o.voice]) {
    const r = await job("loadVoice", [`voices/${o.voice}.json`]);
    if (!r.success) throw new Error(`No se pudo cargar la voz ${o.voice}`);
    voiceIds[o.voice] = r.message;
  }
  const v = o.variant ? `${voiceIds[o.voice]}+${o.variant}` : voiceIds[o.voice];
  const wavs: string[] = [];
  for (const t of o.items) {
    const r = await job("speak", ["-w", "wav.wav", "-a", String(o.amplitude), "-g", "0", "-p", String(o.pitch), "-s", String(o.speed),
      "-b", "1", "-v", v, "--path=/espeak", t]);
    if (!r.audiodata) throw new Error("meSpeak no devolvió audio");
    wavs.push(toBase64(r.audiodata));
  }
  return wavs;
}

/** Si la voz elegida es la robótica, sintetiza cada palabra de `text` y devuelve la carpeta para el motor. */
export async function prepareRobot(meta: Meta, s: Settings, text: string): Promise<string> {
  if (s.voice !== meta.robot_entry || !text.trim()) return "";
  const { tokens } = await engine<{ tokens: string[] }>("tokenize", { text });
  if (!tokens.length) return "";
  const wavs = await speakWords({
    voice: meta.robot_langs[s.r_lang],
    variant: meta.robot_variants[s.r_variant],
    items: tokens,
    speed: s.r_speed,
    pitch: s.r_pitch,
    amplitude: s.r_amp,
  });
  return api.saveRobotWavs(wavs);
}

export const firstWords = (text: string, n = 12) => text.trim().split(/\s+/).slice(0, n).join(" ");
