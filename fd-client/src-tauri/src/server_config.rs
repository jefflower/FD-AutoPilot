//! 服务端 URL 配置管理
//!
//! 在 Tauri app data 目录下存储 `server_url.txt`，
//! 记录用户配置的远程服务端地址。
//! 首次运行默认为 DEFAULT_SERVER_URL。

use std::fs;
use std::path::PathBuf;

pub const DEFAULT_SERVER_URL: &str = "http://47.110.152.25:9988";
const CONFIG_FILE_NAME: &str = "server_url.txt";

/// 获取配置文件路径
fn config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(CONFIG_FILE_NAME))
}

/// 读取已保存的服务端 URL，无配置则返回默认值
pub fn read_server_url(app: &tauri::AppHandle) -> String {
    config_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_SERVER_URL.to_string())
}

/// 保存服务端 URL
pub fn write_server_url(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let path = config_path(app).ok_or("无法获取应用数据目录")?;

    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    fs::write(&path, url.trim()).map_err(|e| format!("写入配置失败: {}", e))?;
    eprintln!("[server_config] 已保存服务端地址: {}", url.trim());
    Ok(())
}

// =========== Tauri Commands ===========

use tauri::Manager;

#[tauri::command]
pub fn get_server_url(app: tauri::AppHandle) -> String {
    read_server_url(&app)
}

#[tauri::command]
pub fn set_server_url(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let url = url.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return Err("URL 不能为空".to_string());
    }
    // 简单校验
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL 必须以 http:// 或 https:// 开头".to_string());
    }
    write_server_url(&app, &url)?;

    // 导航主窗口到新地址
    if let Some(window) = app.get_webview_window("main") {
        let navigate_url: tauri::Url = url.parse().map_err(|e| format!("URL 解析失败: {}", e))?;
        window
            .navigate(navigate_url)
            .map_err(|e| format!("导航失败: {}", e))?;
        eprintln!("[server_config] 主窗口已导航到: {}", url);
    }
    Ok(url)
}
