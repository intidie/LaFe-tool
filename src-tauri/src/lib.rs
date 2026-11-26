//! Backend de LaFe Tool (Tauri v2).

mod engine;
mod exifcleaner;
mod fonts;
mod paths;

use base64::Engine as _;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, RunEvent, State};

use engine::Engine;
use exifcleaner::CleanReport;
use paths::AppPaths;

#[derive(Serialize)]
struct AppInfo {
    version: String,
    fonts_dir: String,
    default_output: String,
    exiftool: bool,
    bundled_ffmpeg: bool,
}

fn paths(app: &AppHandle) -> State<'_, AppPaths> {
    app.state::<AppPaths>()
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    let p = paths(&app);
    AppInfo {
        version: app.package_info().version.to_string(),
        fonts_dir: p.fonts.to_string_lossy().into(),
        default_output: paths::default_output().to_string_lossy().into(),
        exiftool: exifcleaner::locate(&p.resources).is_some(),
        bundled_ffmpeg: p.has_bundled_ffmpeg(),
    }
}

/// Llama al motor de render. Si `clean` es true y el resultado trae `path`, el archivo pasa por ExifCleaner.
#[tauri::command]
async fn engine(app: AppHandle, cmd: String, args: Value, tag: Option<String>, clean: Option<bool>) -> Result<Value, String> {
    let p = paths(&app).inner().clone();
    let eng = app.state::<Engine>();
    let mut data = eng.call(&app, &p, &cmd, args, tag).await?;
    if clean.unwrap_or(false) {
        if let Some(out) = data.get("path").and_then(Value::as_str).map(std::path::PathBuf::from) {
            let report = match exifcleaner::locate(&p.resources) {
                Some(tool) => {
                    let tmp = p.temp.clone();
                    tauri::async_runtime::spawn_blocking(move || exifcleaner::clean(&tool, &out, &tmp))
                        .await
                        .map_err(|e| e.to_string())?
                }
                None => CleanReport {
                    path: out.to_string_lossy().into(),
                    before: 0,
                    after: 0,
                    ok: false,
                    error: Some("ExifTool no está disponible".into()),
                },
            };
            data["cleaned"] = serde_json::to_value(report).unwrap_or(Value::Null);
        }
    }
    Ok(data)
}

/// ExifCleaner sobre archivos que el usuario elige o arrastra (se sobrescriben, como en ExifCleaner).
#[tauri::command]
async fn clean_files(app: AppHandle, files: Vec<String>) -> Result<Vec<CleanReport>, String> {
    let p = paths(&app).inner().clone();
    let tool = exifcleaner::locate(&p.resources).ok_or("ExifTool no está disponible. Reinstala LaFe Tool.")?;
    tauri::async_runtime::spawn_blocking(move || {
        files.iter().map(|f| exifcleaner::clean(&tool, std::path::Path::new(f), &p.temp)).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn install_fonts(app: AppHandle, files: Vec<String>) -> Result<Vec<String>, String> {
    let fams = fonts::install(&files, &paths(&app).fonts)?;
    if fams.is_empty() {
        return Err("Los archivos no contienen fuentes .ttf/.otf válidas.".into());
    }
    Ok(fams)
}

/// Importa todas las fuentes de una carpeta (p. ej. la colección Stamp RSPK del usuario). Se llama en cada arranque.
#[tauri::command]
fn import_font_folder(app: AppHandle, folder: String) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(&folder).map_err(|e| format!("No se pudo abrir {folder}: {e}"))?;
    let files: Vec<String> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    fonts::install(&files, &paths(&app).fonts)
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Value {
    std::fs::read_to_string(&paths(&app).settings)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let path = paths(&app).settings.clone();
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, &path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Guarda los WAV por palabra de la voz robótica (sintetizados con meSpeak.js en la interfaz).
#[tauri::command]
fn save_robot_wavs(app: AppHandle, wavs: Vec<String>) -> Result<String, String> {
    let root = paths(&app).temp.join("robot");
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    for (i, w) in wavs.iter().enumerate() {
        let data = base64::engine::general_purpose::STANDARD.decode(w).map_err(|e| e.to_string())?;
        std::fs::write(root.join(format!("w{i:05}.wav")), data).map_err(|e| e.to_string())?;
    }
    Ok(root.to_string_lossy().into())
}

/// Abre un archivo o carpeta con la app predeterminada; `reveal` lo selecciona en el Explorador.
#[tauri::command]
fn open_path(path: String, reveal: Option<bool>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer");
        if reveal.unwrap_or(false) {
            c.raw_arg(format!("/select,\"{}\"", path.replace('/', "\\")));
        } else {
            c.arg(path.replace('/', "\\"));
        }
        c.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = reveal;
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener).arg(path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<String, String> {
    let p = if path.trim().is_empty() { paths::default_output() } else { std::path::PathBuf::from(path.trim()) };
    std::fs::create_dir_all(&p).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    Ok(p.to_string_lossy().into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Engine::new())
        .setup(|app| {
            let p = AppPaths::init(app.handle())?;
            app.manage(p);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            engine,
            clean_files,
            install_fonts,
            import_font_folder,
            load_settings,
            save_settings,
            read_text_file,
            save_robot_wavs,
            open_path,
            ensure_dir
        ])
        .build(tauri::generate_context!())
        .expect("error al iniciar LaFe Tool");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<Engine>().shutdown();
        }
    });
}
