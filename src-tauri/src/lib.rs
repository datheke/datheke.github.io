// opener: abre el login de Google en el navegador. oauth: servidor local que recibe la respuesta de Google.
// fs: escribe la copia visible en Documentos/Datheke (solo ahí, ver capabilities).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_oauth::init())
    .plugin(tauri_plugin_fs::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
