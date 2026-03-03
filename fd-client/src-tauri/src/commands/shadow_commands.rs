//! Shadow Window Tauri commands.
//!
//! Generic shadow window management + NotebookLM compatibility layer.

use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder, WebviewUrl};

/// Generic Shadow Window IPC bridge initialization script (shared by all shadow windows).
const SHADOW_INIT_SCRIPT: &str = r#"
    (function() {
        console.log('[Shadow] initialization script running...');
        window.__TAURI_SHADOW__ = true;

        // Wait for Tauri internal initialization to complete
        function waitForTauri(callback) {
            if (window.__TAURI_INTERNALS__) {
                window.__TAURI__ = {
                    core: {
                        invoke: function(cmd, args) {
                            return window.__TAURI_INTERNALS__.invoke(cmd, args);
                        }
                    }
                };
                console.log('[Shadow] IPC bridge ready');
                callback();
            } else {
                setTimeout(() => waitForTauri(callback), 100);
            }
        }

        waitForTauri(function() {
            console.log('[Shadow] state fully initialized');
        });
    })();
"#;

// =========== Generic Shadow Window Commands ===========

/// Open (or reuse) a generic shadow window.
#[tauri::command]
pub async fn open_shadow_window(
    app: AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    println!(
        "[Rust] open_shadow_window called with label: {}, url: {}",
        label, url
    );

    // If window already exists, check URL and navigate if needed
    if let Some(window) = app.get_webview_window(&label) {
        println!(
            "[Rust] Shadow window '{}' already exists, checking URL...",
            label
        );
        let current_url = window.url().map_err(|e| e.to_string())?;
        if current_url.as_str() != url {
            println!("[Rust] URL mismatch, navigating to new URL: {}", url);
            window
                .navigate(url.parse().map_err(|e| format!("Invalid URL '{}': {}", url, e))?)
                .map_err(|e| e.to_string())?;
        } else {
            println!("[Rust] URL already matches, reusing existing window");
        }
        return Ok(());
    }

    // Create new window (hidden by default)
    println!(
        "[Rust] Creating new shadow window '{}' with URL: {}",
        label, url
    );
    let builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(url.parse()
            .map_err(|e| format!("Invalid URL '{}': {}", url, e))?),
    )
    .title(format!("Shadow: {}", label))
    .inner_size(1280.0, 1000.0)
    .visible(false)
    .initialization_script(SHADOW_INIT_SCRIPT);

    let _window = builder.build().map_err(|e| {
        println!("[Rust] Failed to build shadow window '{}': {}", label, e);
        e.to_string()
    })?;

    println!("[Rust] Shadow window '{}' created successfully", label);
    Ok(())
}

/// Execute a JS script in the specified shadow window.
#[tauri::command]
pub async fn execute_shadow_js(
    app: AppHandle,
    label: String,
    script: String,
) -> Result<(), String> {
    println!(
        "[Rust] execute_shadow_js called, label={}, script_len={}",
        label,
        script.len()
    );
    if let Some(window) = app.get_webview_window(&label) {
        println!(
            "[Rust] Found shadow window '{}', executing script...",
            label
        );
        window.eval(&script).map_err(|e| {
            println!("[Rust] Script eval failed on '{}': {}", label, e);
            e.to_string()
        })?;
        println!("[Rust] Script executed successfully on '{}'", label);
        Ok(())
    } else {
        println!("[Rust] ERROR: Shadow window '{}' not found!", label);
        Err(format!("Shadow window '{}' not found", label))
    }
}

/// Toggle visibility of the specified shadow window.
#[tauri::command]
pub async fn toggle_shadow_window(
    app: AppHandle,
    label: String,
    visible: bool,
) -> Result<(), String> {
    println!(
        "[Rust] toggle_shadow_window called, label={}, visible={}",
        label, visible
    );
    if let Some(window) = app.get_webview_window(&label) {
        if visible {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        } else {
            window.hide().map_err(|e| e.to_string())?;
        }
        Ok(())
    } else if visible {
        Err(format!(
            "Shadow window '{}' not found, cannot show",
            label
        ))
    } else {
        // Window doesn't exist and we want to hide it -- no-op
        Ok(())
    }
}

/// Get the visibility state of the specified shadow window.
#[tauri::command]
pub async fn get_shadow_window_visibility(
    app: AppHandle,
    label: String,
) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.is_visible().map_err(|e| e.to_string())
    } else {
        Ok(false)
    }
}

/// Close and destroy the specified shadow window (release resources).
#[tauri::command]
pub async fn close_shadow_window(app: AppHandle, label: String) -> Result<(), String> {
    println!("[Rust] close_shadow_window called, label={}", label);
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
        println!("[Rust] Shadow window '{}' closed", label);
        Ok(())
    } else {
        println!(
            "[Rust] Shadow window '{}' not found, nothing to close",
            label
        );
        Ok(()) // Idempotent
    }
}

// =========== NotebookLM Compatibility Layer Commands ===========

#[tauri::command]
pub async fn open_notebook_window(
    app: AppHandle,
    notebook_id: String,
    notebook_url: Option<String>,
) -> Result<(), String> {
    println!(
        "[Rust] open_notebook_window called with notebook_id: {}, notebook_url: {:?}",
        notebook_id, notebook_url
    );
    let url = match notebook_url {
        Some(ref u) if !u.is_empty() => u.clone(),
        _ => format!(
            "https://notebooklm.google.com/notebook/{}",
            notebook_id
        ),
    };
    open_shadow_window(app, "notebook_shadow".to_string(), url).await
}

#[tauri::command]
pub async fn forward_shadow_event(
    app: AppHandle,
    event: String,
    payload: String,
) -> Result<(), String> {
    println!(
        "[Rust] forward_shadow_event: event={}, payload_len={}",
        event,
        payload.len()
    );
    app.emit(&event, payload).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn execute_notebook_js(app: AppHandle, script: String) -> Result<(), String> {
    execute_shadow_js(app, "notebook_shadow".to_string(), script).await
}

#[tauri::command]
pub async fn get_shadow_result(app: AppHandle) -> Result<String, String> {
    println!("[Rust] get_shadow_result called");
    if let Some(window) = app.get_webview_window("notebook_shadow") {
        let extract_script = r#"
            (function() {
                try {
                    // AI replies live in .to-user-container .message-text-content
                    const responses = document.querySelectorAll('.to-user-container .message-text-content');
                    const lastResponse = responses[responses.length - 1];
                    const text = lastResponse ? (lastResponse.innerText || lastResponse.textContent || "").trim() : "";

                    // Detect completion: copy button means generation is done
                    const isFinished = !!document.querySelector('.chat-message-pair:last-child .xap-copy-to-clipboard');

                    const result = JSON.stringify({ text: text, finished: isFinished });
                    console.log('[Shadow] Extraction done, length:', text.length, 'finished:', isFinished);

                    // Send back to Rust via invoke
                    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
                        window.__TAURI__.core.invoke('forward_shadow_event', {
                            event: 'shadow-result',
                            payload: result
                        }).then(() => {
                            console.log('[Shadow] Result sent via invoke');
                        }).catch(e => {
                            console.error('[Shadow] invoke error:', e);
                        });
                    } else {
                        console.error('[Shadow] __TAURI__.core.invoke not available');
                    }
                } catch (e) {
                    console.error('[Shadow] Extraction error:', e);
                }
            })();
        "#;

        window.eval(extract_script).map_err(|e| e.to_string())?;

        // Placeholder -- actual result comes back via event
        Ok("__PENDING__".to_string())
    } else {
        Err("Shadow window not found".to_string())
    }
}

#[tauri::command]
pub async fn get_notebook_window_visibility(app: AppHandle) -> Result<bool, String> {
    get_shadow_window_visibility(app, "notebook_shadow".to_string()).await
}

#[tauri::command]
pub async fn toggle_notebook_window(
    app: AppHandle,
    visible: bool,
    notebook_id: Option<String>,
    notebook_url: Option<String>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("notebook_shadow") {
        if visible {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        } else {
            window.hide().map_err(|e| e.to_string())?;
        }
        // Emit global event so all frontend components update button state
        app.emit("notebook-window-visibility-changed", visible)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else if visible {
        // Window doesn't exist but we need to show it -- create first
        if let Some(nb_id) = notebook_id {
            open_notebook_window(app.clone(), nb_id, notebook_url).await?;
            // Show after creation
            if let Some(window) = app.get_webview_window("notebook_shadow") {
                window.show().map_err(|e| e.to_string())?;
                window.set_focus().map_err(|e| e.to_string())?;
                app.emit("notebook-window-visibility-changed", true)
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        } else {
            Err("Cannot create shadow window: notebook_id not provided".to_string())
        }
    } else {
        // Window doesn't exist and we want to hide -- success (already hidden)
        Ok(())
    }
}
