// The Aura desktop/mobile shell. It does three jobs the browser can't:
//  1. Give the web app a native HTTP client (tauri-plugin-http) so it can reach a
//     LAN device like a Hue bridge, past the browser's CORS / mixed-content /
//     self-signed-cert walls.
//  2. Put Aura in the menu bar / tray, so the room is one click away without
//     opening a window.
//  3. Keep the schedulers alive with the window closed: closing hides to the
//     tray instead of exiting, and a steady heartbeat (below) keeps the webview's
//     automation/rhythm engines ticking even when a hidden page's own timers get
//     throttled. The logic all stays in the web app — one scheduler, two worlds.
// Everything else — the whole UI — is the same Vite build that runs on the web.
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        // Start-at-login, off by default — a toggle in Settings, never assumed.
        // When it does launch us, "--hidden" starts Aura straight in the tray.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        // Closing the window is "put it away", not "stop my lights' schedule" —
        // Aura keeps running in the tray. Quit (tray menu) is the real exit.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
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

            // The heartbeat. A hidden webview's own timers get throttled
            // (Chromium clamps a hidden page toward once-a-minute), which would
            // stretch fades and blunt motion triggers. IPC events aren't
            // throttled — so the engines in the web app also listen for this
            // tick (lib/cadence.ts) and run on their own cadence from
            // whichever source fires first.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                let _ = handle.emit("aura://tick", ());
            });

            // Launched at login (or any launch with --hidden): straight to the
            // tray, no window stealing the morning.
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Aura")
        .run(|_app, _event| {
            // macOS: clicking the dock icon while the window is hidden should
            // bring it back — the platform's own "reopen" gesture.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if let Some(w) = _app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
}
