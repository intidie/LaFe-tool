//! Limpieza de metadatos con el mismo método que ExifCleaner (https://github.com/szTheory/exifcleaner, MIT).
//!
//! ExifCleaner ejecuta ExifTool con `-all=` y, en archivos de video/audio, borra además las fechas de QuickTime
//! (`QUICKTIME_DATE_REMOVAL_ARGS` en src/domain/exif/exif.ts) y sobrescribe el original (`-overwrite_original`).
//! Aquí se replican exactamente esos argumentos, con el mismo ExifTool para Windows que distribuye ExifCleaner
//! (empaquetado en resources/exiftool). Los argumentos viajan por un archivo de argumentos en UTF-8 (`-@`) para que
//! las rutas con tildes o ñ funcionen.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::Value;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// ExifCleaner: QUICKTIME_DATE_REMOVAL_ARGS
const QUICKTIME_DATE_REMOVAL_ARGS: [&str; 6] = [
    "-QuickTime:CreateDate=",
    "-QuickTime:ModifyDate=",
    "-TrackCreateDate=",
    "-TrackModifyDate=",
    "-MediaCreateDate=",
    "-MediaModifyDate=",
];
const MEDIA_EXTS: [&str; 10] = ["mp4", "mov", "m4v", "m4a", "3gp", "3g2", "avi", "mkv", "webm", "mp3"];
/// Grupos que describen el archivo, no metadatos que se puedan borrar (ExifCleaner tampoco los cuenta).
const SYSTEM_GROUPS: [&str; 5] = ["SourceFile", "ExifTool", "System", "File", "Composite"];

#[derive(Serialize, Clone)]
pub struct CleanReport {
    pub path: String,
    pub before: usize,
    pub after: usize,
    pub ok: bool,
    pub error: Option<String>,
}

fn exiftool_cmd(exiftool: &Path) -> Command {
    let mut c = Command::new(exiftool);
    #[cfg(windows)]
    c.creation_flags(0x0800_0000);
    c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    c
}

/// Ejecuta ExifTool con los argumentos escritos en un archivo `-@` (UTF-8).
fn run(exiftool: &Path, args: &[String], tmp: &Path) -> Result<String, String> {
    let argfile = tmp.join(format!("exif_{}_{}.args", std::process::id(), nanos()));
    std::fs::write(&argfile, args.join("\n") + "\n").map_err(|e| e.to_string())?;
    let out = exiftool_cmd(exiftool)
        .args(["-charset", "filename=utf8", "-@"])
        .arg(&argfile)
        .output()
        .map_err(|e| format!("No se pudo ejecutar ExifTool: {e}"));
    let _ = std::fs::remove_file(&argfile);
    let out = out?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { "ExifTool terminó con error".into() } else { err });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn nanos() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

/// Número de etiquetas de metadatos (lo que ExifCleaner muestra antes y después).
pub fn count_tags(exiftool: &Path, file: &Path, tmp: &Path) -> Result<usize, String> {
    let args = vec!["-json".into(), "-G1:2:4".into(), file.to_string_lossy().to_string()];
    let json: Value = serde_json::from_str(&run(exiftool, &args, tmp)?).map_err(|e| e.to_string())?;
    let obj = json.get(0).and_then(Value::as_object).ok_or("Respuesta de ExifTool no válida")?;
    Ok(obj.keys().filter(|k| !SYSTEM_GROUPS.contains(&k.split(':').next().unwrap_or(""))).count())
}

/// Argumentos de escritura de ExifCleaner para `file` (sin opciones de «preservar»: se borra todo).
fn sanitize_args(file: &Path) -> Vec<String> {
    let mut args: Vec<String> = vec!["-all=".into()];
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if MEDIA_EXTS.contains(&ext.as_str()) {
        args.extend(QUICKTIME_DATE_REMOVAL_ARGS.iter().map(|s| s.to_string()));
    }
    if ext == "tif" || ext == "tiff" {
        args.push("-CommonIFD0=".into());
    }
    args.push("-overwrite_original".into());
    args.push(file.to_string_lossy().to_string());
    args
}

pub fn clean(exiftool: &Path, file: &Path, tmp: &Path) -> CleanReport {
    let mut rep = CleanReport { path: file.to_string_lossy().to_string(), before: 0, after: 0, ok: false, error: None };
    if !file.is_file() {
        rep.error = Some("El archivo no existe".into());
        return rep;
    }
    rep.before = count_tags(exiftool, file, tmp).unwrap_or(0);
    match run(exiftool, &sanitize_args(file), tmp) {
        Ok(_) => {
            rep.after = count_tags(exiftool, file, tmp).unwrap_or(0);
            rep.ok = true;
        }
        Err(e) => rep.error = Some(e),
    }
    rep
}

/// ExifTool empaquetado (resources/exiftool/exiftool.exe) o, si no está, el del PATH.
pub fn locate(resources: &Path) -> Option<PathBuf> {
    let bundled = resources.join("exiftool").join(if cfg!(windows) { "exiftool.exe" } else { "exiftool" });
    if bundled.is_file() {
        return Some(bundled);
    }
    let name = if cfg!(windows) { "exiftool.exe" } else { "exiftool" };
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).map(|d| d.join(name)).find(|c| c.is_file()))
        .flatten()
}
