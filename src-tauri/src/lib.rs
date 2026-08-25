#[cfg(target_os = "windows")]
use tauri::{Manager, PhysicalPosition, PhysicalSize, Rect, Webview, WindowEvent};

#[cfg(target_os = "windows")]
fn resize_webview(webview: &Webview, size: PhysicalSize<u32>) -> tauri::Result<()> {
    webview.set_bounds(Rect {
        position: PhysicalPosition::new(0, 0).into(),
        size: size.into(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(target_os = "windows")]
    let builder = builder.setup(|app| {
        let window = app
            .get_webview_window("main")
            .expect("main webview window should be configured");
        let webview = window.as_ref().clone();

        window.on_window_event(move |event| {
            let size = match event {
                WindowEvent::Resized(size) => *size,
                WindowEvent::ScaleFactorChanged { new_inner_size, .. } => *new_inner_size,
                _ => return,
            };

            resize_webview(&webview, size)
                .expect("failed to synchronize webview with native client area");
        });

        resize_webview(window.as_ref(), window.inner_size()?)?;

        Ok(())
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
