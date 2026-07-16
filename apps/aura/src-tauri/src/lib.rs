// The Aura desktop/mobile shell. It does one job the browser can't: give the web
// app a native HTTP client (tauri-plugin-http) so it can reach a LAN device like a
// Hue bridge, past the browser's CORS / mixed-content / self-signed-cert walls.
// Everything else — the whole UI — is the same Vite build that runs on the web.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running Aura");
}
