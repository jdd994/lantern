// The Aura desktop/mobile shell. It does two jobs the browser can't:
//  1. Give the web app a native HTTP client (tauri-plugin-http) so it can reach a
//     LAN device like a Hue bridge, past the browser's CORS / mixed-content /
//     self-signed-cert walls.
//  2. Put Aura in the menu bar / tray, so the room is one click away without
//     opening a window.
// Everything else — the whole UI — is the same Vite build that runs on the web.
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show Aura", true, None::<&str>)?;
            let all_off = MenuItem::with_id(app, "all_off", "All lights off", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &all_off, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Aura")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    // The UI owns the lights, so the tray just asks it to act.
                    "all_off" => {
                        let _ = app.emit("aura://all-off", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Aura");
}
