// opener: abre el login de Google en el navegador. oauth: servidor local que recibe la respuesta de Google.
// fs: escribe la copia visible en Documentos/Datheke (solo ahí, ver capabilities).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_oauth::init())
    .plugin(tauri_plugin_fs::init());
  // biometric: huella para abrir las notas con clave (solo en el celular).
  #[cfg(mobile)]
  let builder = builder.plugin(tauri_plugin_biometric::init());
  builder
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
