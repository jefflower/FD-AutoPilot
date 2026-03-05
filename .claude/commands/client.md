## /client — 启动 fd-client 桌面客户端

启动 Tauri 桌面客户端（含内嵌 fd-bridge）。

### 步骤

1. **检查端口占用**：检查 9987 端口是否已有 fd-bridge 进程在运行
   - 如果有，先终止旧进程：`kill <pid>`
2. **启动客户端**：在后台运行
   ```bash
   cd fd-client && npm run tauri dev
   ```
3. **等待编译**：观察输出，等待 Rust 编译完成并出现 `listening on` 日志
4. **报告结果**：
   - 启动成功：告知用户客户端窗口已弹出
   - 端口冲突：终止旧进程后重试
   - 编译失败：报告具体错误

### 注意事项

- fd-client 内嵌了 fd-bridge（端口 9987），启动前需确保端口未被占用
- 如果只需要 bridge 而不需要 GUI 窗口，使用 `cd fd-client/src-tauri && cargo run --bin fd-bridge --no-default-features`
- 命令在后台运行，不阻塞对话
