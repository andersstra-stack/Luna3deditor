use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde::Serialize;
use tauri::Manager;

/// Skriver tekst (f.eks. scene-JSON) til en fil valgt av brukeren eller Claude.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Kunne ikke skrive {path}: {e}"))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Kunne ikke lese {path}: {e}"))
}

/// Brukes til modellimport. Returneres som rå bytes (ArrayBuffer i JS), ikke som JSON-tall.
#[tauri::command]
fn read_binary_file(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Kunne ikke lese {path}: {e}"))
}

/// Brukes til GLB-eksport.
#[tauri::command]
fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Kunne ikke skrive {path}: {e}"))
}

#[derive(Serialize)]
struct ScriptOutput {
    stdout: String,
    stderr: String,
    code: i32,
}

/// Mappa med Python-modulen `luna3d`: pakket som ressurs, eller rett fra repoet under utvikling.
fn scripting_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("scripting");
        if bundled.join("luna3d.py").exists() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("scripting")
}

/// Python-kommandoer å prøve, i rekkefølge. LUNA_PYTHON overstyrer.
fn python_candidates() -> Vec<(String, Vec<String>)> {
    if let Ok(custom) = std::env::var("LUNA_PYTHON") {
        return vec![(custom, vec![])];
    }
    vec![("python".into(), vec![]), ("py".into(), vec!["-3".into()]), ("python3".into(), vec![])]
}

/// Kjører et Python-skript med `python -m luna3d skript.py`. Scenen sendes inn som en
/// midlertidig JSON-fil; skriptets endringer kommer tilbake i stdout (tolkes i scripting.ts).
#[tauri::command]
async fn run_python_script(app: tauri::AppHandle, path: String, scene_json: String) -> Result<ScriptOutput, String> {
    let dir = scripting_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let scene_file = std::env::temp_dir().join(format!("luna3d-scene-{}-{stamp}.json", std::process::id()));
        fs::write(&scene_file, scene_json).map_err(|e| format!("Kunne ikke skrive scenefil: {e}"))?;

        let mut last_error = String::from("fant ikke Python");
        for (exe, pre_args) in python_candidates() {
            let mut cmd = Command::new(&exe);
            cmd.args(&pre_args)
                .args(["-m", "luna3d", &path])
                .env("PYTHONPATH", &dir)
                .env("PYTHONIOENCODING", "utf-8")
                .env("LUNA3D_SCENE_FILE", &scene_file);
            #[cfg(windows)]
            {
                // Ikke vis et konsollvindu mens skriptet kjører.
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000);
            }
            match cmd.output() {
                Ok(out) => {
                    let _ = fs::remove_file(&scene_file);
                    return Ok(ScriptOutput {
                        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
                        code: out.status.code().unwrap_or(-1),
                    });
                }
                Err(e) => last_error = format!("{exe}: {e}"),
            }
        }
        let _ = fs::remove_file(&scene_file);
        Err(format!("Kunne ikke starte Python ({last_error}). Installer Python 3 eller sett LUNA_PYTHON."))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            write_text_file,
            read_text_file,
            read_binary_file,
            write_binary_file,
            run_python_script
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
