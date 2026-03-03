/// fd-bridge: 独立 Agent Runtime HTTP 服务器
///
/// 提供与 Tauri 内嵌 bridge 相同的 HTTP 端点，但无需 Tauri GUI。
/// 用于浏览器模式开发测试：fd-web 通过 Vite 代理访问 /bridge/* 端点。
///
/// 启动方式:
///   cargo run --bin fd-bridge --no-default-features
///
/// 端点:
///   GET  /bridge/health           健康检查
///   POST /bridge/translate        Gemini CLI 翻译工单
///   POST /bridge/gemini           通用 Gemini CLI 执行
///   POST /bridge/sync-translate   同步翻译回复

#[tokio::main]
async fn main() {
    eprintln!("╔══════════════════════════════════════════╗");
    eprintln!("║  fd-bridge — Agent Runtime HTTP Server   ║");
    eprintln!("║  Port: 9987                              ║");
    eprintln!("╚══════════════════════════════════════════╝");
    fd_client::bridge_server::run_standalone().await;
}
