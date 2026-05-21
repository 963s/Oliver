use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![get_embedded_device_token])
    .setup(|app| {
      if cfg!(debug_assertions) {
        let _ = app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        );
      }
      try_start_embedded_backend(app.handle())?;
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if matches!(event, tauri::RunEvent::Exit) {
        if let Some(state) = app_handle.try_state::<BackendChild>() {
          if let Ok(mut guard) = state.inner().0.lock() {
            if let Some(mut child) = guard.take() {
              let _ = child.kill();
              let _ = child.wait();
            }
          }
        }
      }
    });
}

/// Holds the spawned Node API process (production macOS bundle only).
pub struct BackendChild(pub std::sync::Mutex<Option<std::process::Child>>);

#[tauri::command]
fn get_embedded_device_token(app: tauri::AppHandle) -> Result<String, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let path = dir.join("embedded-device.json");
  read_or_create_device_token(&path)
}

fn read_or_create_device_token(path: &std::path::Path) -> Result<String, String> {
  if path.exists() {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    return v
      .get("deviceToken")
      .and_then(|x| x.as_str())
      .map(|s| s.to_string())
      .ok_or_else(|| "invalid embedded-device.json".to_string());
  }
  let mut buf = [0u8; 32];
  use rand::RngCore;
  rand::thread_rng().fill_bytes(&mut buf);
  let token: String = buf.iter().map(|b| format!("{:02x}", b)).collect();
  let payload = serde_json::json!({ "deviceToken": token });
  std::fs::write(
    path,
    serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?,
  )
  .map_err(|e| e.to_string())?;
  Ok(token)
}

fn try_start_embedded_backend(handle: &tauri::AppHandle) -> Result<(), String> {
  use std::path::PathBuf;
  use std::process::{Command, Stdio};
  use tauri::path::BaseDirectory;

  let node: PathBuf = handle
    .path()
    .resolve("embedded-backend/node", BaseDirectory::Resource)
    .map_err(|e| e.to_string())?;
  if !node.exists() {
    return Ok(());
  }

  let backend_dir = node
    .parent()
    .ok_or_else(|| "embedded-backend path".to_string())?
    .to_path_buf();
  let entry = backend_dir.join("dist").join("index.js");
  if !entry.exists() {
    return Err(format!("missing embedded entry: {}", entry.display()));
  }

  let data_dir = handle.path().app_data_dir().map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
  let db_path = data_dir.join("salon.db");
  let token_path = data_dir.join("embedded-device.json");
  let token = read_or_create_device_token(&token_path)?;

  let mut cmd = Command::new(&node);
  cmd
    .arg(&entry)
    .current_dir(&backend_dir)
    .env("DATABASE_PATH", db_path.as_os_str())
    .env("PORT", "3000")
    .env("OLIVER_ROOS_EMBEDDED_DEVICE_TOKEN", &token)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());

  let child = cmd
    .spawn()
    .map_err(|e| format!("spawn embedded backend: {e}"))?;

  handle.manage(BackendChild(std::sync::Mutex::new(Some(child))));
  Ok(())
}
