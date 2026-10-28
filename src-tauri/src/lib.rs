// opener: abre el login de Google en el navegador. oauth: servidor local que recibe la respuesta de Google.
// fs: escribe la copia visible en Documentos/Datheke (solo ahí, ver capabilities). notification: avisos de recordatorios.
// sharekit: "Enviar copia" abre el menú de compartir del aparato.
// En la PC, Datheke queda en segundo plano al cerrar la ventana (iconito junto al reloj) para que los recordatorios
// suenen, arranca con Windows (oculto) y solo hay una ventana a la vez: abrirlo de nuevo muestra la que ya está.
#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
fn show(app: &tauri::AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  // La de una sola ventana tiene que ir primero.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)));
  let builder = builder
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_oauth::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_notification::init());
  // biometric: huella para abrir las notas con clave; sharekit: menú de compartir (solo en el celular).
  #[cfg(mobile)]
  let builder = builder.plugin(tauri_plugin_biometric::init()).plugin(tauri_plugin_sharekit::init());
  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--oculto"])))
    .setup(|app| {
      use tauri::menu::{Menu, MenuItem};
      use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
      let abrir = MenuItem::with_id(app, "abrir", "Abrir Datheke", true, None::<&str>)?;
      let salir = MenuItem::with_id(app, "salir", "Salir de Datheke", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&abrir, &salir])?;
      let mut tray = TrayIconBuilder::with_id("datheke")
        .tooltip("Datheke: tus recordatorios siguen activos")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
          "abrir" => show(app),
          "salir" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, e| {
          if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            show(tray.app_handle());
          }
        });
      if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
      }
      tray.build(app)?;
      // Al arrancar con Windows queda oculta, solo con el iconito.
      if std::env::args().any(|a| a == "--oculto") {
        if let Some(w) = app.get_webview_window("main") {
          let _ = w.hide();
        }
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    });
  builder
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
