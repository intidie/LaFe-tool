//! Puente con el motor de render (engine/engine.py, empaquetado con PyInstaller en resources/engine).
//!
//! El motor es un proceso hijo persistente: recibe una petición JSON por línea en stdin y responde por stdout con
//! eventos `progress`, `result` o `error` identificados por `id`. Así las previsualizaciones no pagan el arranque
//! del proceso y varias peticiones pueden ir en paralelo (el motor atiende cada una en su propio hilo).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::paths::AppPaths;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

type Reply = Result<Value, String>;

struct Pending {
    tx: oneshot::Sender<Reply>,
    tag: Option<String>,
}

struct Proc {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Clone, Serialize)]
struct ProgressEvent {
    tag: String,
    value: f64,
    msg: String,
}

pub struct Engine {
    proc: Mutex<Option<Proc>>,
    pending: Arc<Mutex<HashMap<u64, Pending>>>,
    next_id: AtomicU64,
}

impl Engine {
    pub fn new() -> Self {
        Self { proc: Mutex::new(None), pending: Arc::new(Mutex::new(HashMap::new())), next_id: AtomicU64::new(1) }
    }

    /// Comando para lanzar el motor: el ejecutable empaquetado o, en desarrollo, `python engine/engine.py`.
    fn command(paths: &AppPaths) -> Result<Command, String> {
        let exe = paths.resources.join("engine").join("lafe-engine.exe");
        let mut cmd = if exe.is_file() {
            Command::new(exe)
        } else if cfg!(debug_assertions) {
            let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("engine").join("engine.py");
            let python = std::env::var("LAFE_PYTHON").unwrap_or_else(|_| "python".into());
            let mut c = Command::new(python);
            c.arg(script);
            c
        } else {
            return Err("No se encontró el motor de render (resources/engine). Reinstala LaFe Tool.".into());
        };
        cmd.arg("--fonts").arg(&paths.fonts).arg("--temp").arg(&paths.temp);
        cmd.env("PATH", paths.search_path());
        cmd.env("PYTHONIOENCODING", "utf-8");
        cmd.env("PYTHONUTF8", "1");
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped());
        let log = std::fs::File::create(paths.logs.join("motor.log")).map_err(|e| e.to_string())?;
        cmd.stderr(Stdio::from(log));
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        Ok(cmd)
    }

    fn spawn(&self, app: &AppHandle, paths: &AppPaths) -> Result<Proc, String> {
        let mut child = Self::command(paths)?.spawn().map_err(|e| format!("No se pudo iniciar el motor: {e}"))?;
        let stdin = child.stdin.take().ok_or("Sin stdin del motor")?;
        let stdout = child.stdout.take().ok_or("Sin stdout del motor")?;
        let pending = Arc::clone(&self.pending);
        let app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
                let id = msg.get("id").and_then(Value::as_u64).unwrap_or(0);
                match msg.get("type").and_then(Value::as_str).unwrap_or("") {
                    "progress" => {
                        let tag = pending.lock().unwrap().get(&id).and_then(|p| p.tag.clone());
                        if let Some(tag) = tag {
                            let value = msg.get("value").and_then(Value::as_f64).unwrap_or(0.0);
                            let text = msg.get("msg").and_then(Value::as_str).unwrap_or("").to_string();
                            let _ = app.emit("engine-progress", ProgressEvent { tag, value, msg: text });
                        }
                    }
                    "result" => {
                        if let Some(p) = pending.lock().unwrap().remove(&id) {
                            let _ = p.tx.send(Ok(msg.get("data").cloned().unwrap_or(Value::Null)));
                        }
                    }
                    "error" => {
                        if let Some(p) = pending.lock().unwrap().remove(&id) {
                            let m = msg.get("message").and_then(Value::as_str).unwrap_or("Error del motor");
                            let _ = p.tx.send(Err(m.to_string()));
                        }
                    }
                    _ => {}
                }
            }
            // El motor terminó: se avisa a todo lo que esperaba respuesta.
            for (_, p) in pending.lock().unwrap().drain() {
                let _ = p.tx.send(Err("El motor de render se cerró inesperadamente. Inténtalo de nuevo.".into()));
            }
        });
        Ok(Proc { child, stdin })
    }

    /// Envía una petición y espera la respuesta. Si el motor no está vivo, lo (re)inicia.
    pub async fn call(
        &self,
        app: &AppHandle,
        paths: &AppPaths,
        cmd: &str,
        args: Value,
        tag: Option<String>,
    ) -> Reply {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, Pending { tx, tag });
        let line = json!({ "id": id, "cmd": cmd, "args": args }).to_string() + "\n";
        let sent = (|| -> Result<(), String> {
            let mut guard = self.proc.lock().unwrap();
            let alive = matches!(guard.as_mut().map(|p| p.child.try_wait()), Some(Ok(None)));
            if !alive {
                *guard = Some(self.spawn(app, paths)?);
            }
            let p = guard.as_mut().unwrap();
            p.stdin.write_all(line.as_bytes()).and_then(|_| p.stdin.flush()).map_err(|e| e.to_string())
        })();
        if let Err(e) = sent {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }
        rx.await.unwrap_or_else(|_| Err("Se perdió la respuesta del motor.".into()))
    }

    pub fn shutdown(&self) {
        if let Some(mut p) = self.proc.lock().unwrap().take() {
            // /T también cierra los ffmpeg que el motor tenga en marcha.
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &p.child.id().to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
            let _ = p.child.kill();
        }
    }
}
