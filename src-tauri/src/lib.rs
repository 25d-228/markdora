#[cfg(target_os = "windows")]
use tauri::webview::PageLoadEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(target_os = "windows")]
    let builder = builder.on_page_load(|webview, payload| {
        if webview.label() == "main" && payload.event() == PageLoadEvent::Finished {
            webview
                .window()
                .show()
                .expect("failed to show the main window after its page loaded");
        }
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
