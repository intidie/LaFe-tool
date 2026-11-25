//! Instalación de fuentes subidas por el usuario: .zip con fuentes dentro, o .ttf/.otf/.ttc sueltos.
//! Se guardan como `usuario_<nombre>` en la carpeta de fuentes de la app y quedan disponibles para siempre.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::Path;

const FONT_EXTS: [&str; 3] = ["ttf", "otf", "ttc"];
const MAX_BYTES: u64 = 25 * 1024 * 1024;

fn ext_of(name: &str) -> String {
    Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// Nombre de familia de una fuente válida (None si los bytes no son una fuente).
fn family_of(data: &[u8]) -> Option<String> {
    let face = ttf_parser::Face::parse(data, 0).ok()?;
    let names = face.names();
    let pick = |id: u16| {
        names.into_iter().filter(|n| n.name_id == id).find_map(|n| n.to_string()).filter(|s| !s.trim().is_empty())
    };
    pick(ttf_parser::name_id::TYPOGRAPHIC_FAMILY).or_else(|| pick(ttf_parser::name_id::FAMILY))
}

fn safe_name(name: &str) -> String {
    let base = Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or("fuente");
    base.chars().map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '_' }).collect()
}

fn install_one(name: &str, data: &[u8], fonts_dir: &Path, fams: &mut BTreeSet<String>) -> Result<(), String> {
    let Some(fam) = family_of(data) else { return Ok(()) };
    let dst = fonts_dir.join(format!("usuario_{}", safe_name(name)));
    std::fs::write(&dst, data).map_err(|e| format!("No se pudo guardar {}: {e}", dst.display()))?;
    fams.insert(fam);
    Ok(())
}

/// Instala las fuentes de `files` y devuelve las familias instaladas.
pub fn install(files: &[String], fonts_dir: &Path) -> Result<Vec<String>, String> {
    let mut fams = BTreeSet::new();
    for f in files {
        let path = Path::new(f);
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("fuente").to_string();
        let ext = ext_of(&name);
        if ext == "zip" {
            let file = std::fs::File::open(path).map_err(|e| format!("No se pudo abrir {name}: {e}"))?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("{name} no es un .zip válido: {e}"))?;
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
                let inner = entry.name().to_string();
                if entry.is_dir() || inner.contains("__MACOSX") || !FONT_EXTS.contains(&ext_of(&inner).as_str()) {
                    continue;
                }
                if entry.size() > MAX_BYTES {
                    continue;
                }
                let mut data = Vec::with_capacity(entry.size() as usize);
                entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
                install_one(&inner, &data, fonts_dir, &mut fams)?;
            }
        } else if FONT_EXTS.contains(&ext.as_str()) {
            let data = std::fs::read(path).map_err(|e| format!("No se pudo leer {name}: {e}"))?;
            if data.len() as u64 <= MAX_BYTES {
                install_one(&name, &data, fonts_dir, &mut fams)?;
            }
        }
    }
    Ok(fams.into_iter().collect())
}
