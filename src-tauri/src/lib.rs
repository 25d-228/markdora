use std::path::{Component, Path, PathBuf};
#[cfg(target_os = "windows")]
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

const SUPPORTED_IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "avif"];

fn has_supported_image_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_IMAGE_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

fn resolve_preview_image(document_path: &Path, image_source: &str) -> Result<PathBuf, String> {
    if image_source.is_empty()
        || image_source.contains([':', '\\'])
        || image_source.starts_with("//")
    {
        return Err("The preview image destination is not a relative path.".into());
    }

    let relative_path = Path::new(image_source);
    if relative_path.is_absolute()
        || relative_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("The preview image destination is not a safe descendant path.".into());
    }

    if !has_supported_image_extension(relative_path) {
        return Err("The preview image type is not supported.".into());
    }

    let canonical_document = document_path
        .canonicalize()
        .map_err(|_| "The active document is unavailable.".to_string())?;
    if !canonical_document.is_file() {
        return Err("The active document path is not a file.".into());
    }

    let document_directory = document_path
        .parent()
        .ok_or_else(|| "The active document has no parent directory.".to_string())?
        .canonicalize()
        .map_err(|_| "The active document directory is unavailable.".to_string())?;
    let candidate = document_directory
        .join(relative_path)
        .canonicalize()
        .map_err(|_| "The preview image is unavailable.".to_string())?;

    if !candidate.starts_with(&document_directory) {
        return Err("The preview image is outside the document directory.".into());
    }
    if !candidate.is_file() {
        return Err("The preview image path is not a file.".into());
    }
    if !has_supported_image_extension(&candidate) {
        return Err("The preview image type is not supported.".into());
    }

    Ok(candidate)
}

#[tauri::command]
fn authorize_preview_image(
    app: AppHandle,
    document_path: String,
    image_source: String,
) -> Result<String, String> {
    let document_path = PathBuf::from(document_path);
    if !app.fs_scope().is_allowed(&document_path) {
        return Err("The active document is not in the file-system scope.".into());
    }

    let image_path = resolve_preview_image(&document_path, &image_source)?;
    app.asset_protocol_scope()
        .allow_file(&image_path)
        .map_err(|_| "The preview image could not be authorized.".to_string())?;

    image_path
        .into_os_string()
        .into_string()
        .map_err(|_| "The preview image path is not valid UTF-8.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![authorize_preview_image]);

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

#[cfg(test)]
mod tests {
    use super::resolve_preview_image;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time must follow the Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("markdora-preview-{}-{unique}", std::process::id()));
            fs::create_dir(&path).expect("test directory should be created");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).expect("test directory should be removed");
        }
    }

    fn create_document(root: &Path) -> PathBuf {
        let document = root.join("document.md");
        fs::write(&document, "# Document").expect("document should be written");
        document
    }

    #[test]
    fn resolves_a_supported_descendant_file() {
        let root = TestDirectory::new();
        let document = create_document(root.path());
        let image_directory = root.path().join("images");
        fs::create_dir(&image_directory).expect("image directory should be created");
        let image = image_directory.join("diagram.PNG");
        fs::write(&image, b"image").expect("image should be written");

        let resolved = resolve_preview_image(&document, "images/diagram.PNG")
            .expect("supported descendant should resolve");

        assert_eq!(resolved, image.canonicalize().expect("image should exist"));
        assert!(resolved.is_file());
    }

    #[test]
    fn rejects_traversal_absolute_urls_unsupported_missing_and_directories() {
        let parent = TestDirectory::new();
        let document_directory = parent.path().join("document");
        fs::create_dir(&document_directory).expect("document directory should be created");
        let document = create_document(&document_directory);
        let outside_image = parent.path().join("outside.png");
        fs::write(&outside_image, b"image").expect("outside image should be written");
        let directory = document_directory.join("folder.png");
        fs::create_dir(&directory).expect("image-like directory should be created");
        let unsupported = document_directory.join("image.svg");
        fs::write(&unsupported, b"image").expect("unsupported file should be written");

        assert!(resolve_preview_image(&document, "../outside.png").is_err());
        assert!(resolve_preview_image(&document, &outside_image.to_string_lossy()).is_err());
        assert!(resolve_preview_image(&document, "https://example.com/image.png").is_err());
        assert!(resolve_preview_image(&document, "image.svg").is_err());
        assert!(resolve_preview_image(&document, "missing.png").is_err());
        assert!(resolve_preview_image(&document, "folder.png").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_that_escapes_the_document_directory() {
        use std::os::unix::fs::symlink;

        let parent = TestDirectory::new();
        let document_directory = parent.path().join("document");
        fs::create_dir(&document_directory).expect("document directory should be created");
        let document = create_document(&document_directory);
        let outside_image = parent.path().join("outside.png");
        fs::write(&outside_image, b"image").expect("outside image should be written");
        symlink(&outside_image, document_directory.join("linked.png"))
            .expect("image symlink should be created");

        assert!(resolve_preview_image(&document, "linked.png").is_err());
    }
}
