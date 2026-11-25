//! Carpetas de la app. Las fuentes de fábrica se copian a la carpeta de datos del usuario, donde también se
//! guardan las que el usuario sube (así sobreviven a las actualizaciones).

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct AppPaths {
    /// Recursos empaquetados (motor, ffmpeg, exiftool, fuentes de fábrica).
    pub resources: PathBuf,
    pub fonts: PathBuf,
    pub temp: PathBuf,
    pub logs: PathBuf,
    pub settings: PathBuf,
}

impl AppPaths {
    pub fn init(app: &AppHandle) -> Result<Self, String> {
        let res_root = app.path().resource_dir().map_err(|e| e.to_string())?;
        let resources = res_root.join("resources");
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let local = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        let p = Self {
            resources: if resources.is_dir() { resources } else { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources") },
            fonts: data.join("fonts"),
            temp: local.join("temp"),
            logs: local.join("logs"),
            settings: data.join("ajustes.json"),
        };
        for d in [&p.fonts, &p.temp, &p.logs] {
            std::fs::create_dir_all(d).map_err(|e| format!("No se pudo crear {}: {e}", d.display()))?;
        }
        p.seed_fonts();
        Ok(p)
    }

    /// Copia las fuentes incluidas (y sus licencias) si aún no están en la carpeta del usuario.
    fn seed_fonts(&self) {
        let Ok(entries) = std::fs::read_dir(self.resources.join("fonts")) else { return };
        for e in entries.flatten() {
            let dst = self.fonts.join(e.file_name());
            if e.path().is_file() && !dst.exists() {
                let _ = std::fs::copy(e.path(), dst);
            }
        }
    }

    pub fn ffmpeg_dir(&self) -> PathBuf {
        let bin = self.resources.join("ffmpeg").join("bin");
        if bin.is_dir() {
            bin
        } else {
            self.resources.join("ffmpeg")
        }
    }

    /// PATH para el motor: primero ffmpeg/ffprobe empaquetados, luego el PATH del sistema.
    pub fn search_path(&self) -> std::ffi::OsString {
        let mut dirs = vec![self.ffmpeg_dir()];
        if let Some(p) = std::env::var_os("PATH") {
            dirs.extend(std::env::split_paths(&p));
        }
        std::env::join_paths(dirs).unwrap_or_default()
    }

    pub fn has_bundled_ffmpeg(&self) -> bool {
        self.ffmpeg_dir().join(exe("ffmpeg")).is_file()
    }
}

pub fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

pub fn default_output() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|h| Path::new(&h).join("Videos").join("LaFe Tool"))
        .unwrap_or_else(|| PathBuf::from("LaFe Tool"))
}
