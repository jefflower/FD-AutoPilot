# MQ 自动回复功能修复清单

## ✅ 已验证的正确代码

### 1. Rust 消费循环 (src-tauri/src/mq_consumer.rs:270-274)
```rust
if q_type == "reply" {
    // 直接 await，阻塞等待当前任务完成后才处理下一条消息
    self_clone.handle_reply_delivery(...).await;
}
```
✅ 使用直接 `await`，确保串行执行

### 2. Rust handle_reply_delivery (src-tauri/src/mq_consumer.rs:437)
```rust
let result = self.generate_reply_and_submit(&app, &msg, &auth_token).await;
```
✅ 会阻塞等待 `generate_reply_and_submit` 完成

### 3. Rust generate_reply_and_submit (src-tauri/src/mq_consumer.rs:634)
```rust
let result = match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
    // ... 等待前端发送 complete_reply_task
}
```
✅ 会阻塞等待 oneshot channel 的信号

### 4. 前端全局监听 (src/AppNew.tsx:129)
```typescript
const unlistenReply = listen('mq-reply-request', (event) => handleMqTask(event, 'reply'));
```
✅ 正确监听事件并设置 mqTarget

### 5. 前端任务处理 (src/components/server/ServerTaskWorkspace.tsx:141)
```typescript
success = await detailRef.current.handleTriggerAiReply(true);
await invoke('complete_reply_task', { ticketId: id, success });
```
✅ 会 await AI 完成，然后调用 complete_reply_task

### 6. Shadow Window 全局锁 (src/services/notebookShadow.ts:69)
```typescript
const releaseLock = await this.acquireLock();
```
✅ 全局互斥锁确保同时只有一个查询

## 🔍 诊断步骤

### 步骤 1：重新编译 Rust 代码
```bash
cd fd-client
rm -rf src-tauri/target  # 清理旧的构建
npm run tauri build
```

### 步骤 2：检查日志输出

运行程序后，应该看到以下日志序列（按时间顺序）：

```
🔄 [CONSUMER LOOP] Got reply message, will AWAIT handle_reply_delivery...
📨 Received Reply Task MQ Message (len: 156)
📝 [TASK START] Processing reply for ticket #1001
⏳ [TASK #1001] Calling generate_reply_and_submit (will await rx)...
📡 Emitted mq-reply-request for ticket #1001
⏳ [CRITICAL] About to AWAIT rx for ticket #1001 (timeout: 300s)...

... (前端处理，30-60秒) ...

[Workspace MQ] 🚀 Starting AI Reply for ticket #1001...
[NotebookShadow] Query lock acquired
... AI 生成 ...
[NotebookShadow] Query lock released
[Workspace MQ] ✅ AI Reply completed for ticket #1001, duration: 45.2s
[Workspace MQ] 📡 Sent ACK signal to Rust backend for ticket #1001

🎯 [complete_reply_task] Called for ticket #1001, success: true
✅ [complete_reply_task] Found tx for #1001, sending signal...
📤 [complete_reply_task] Signal sent successfully for #1001

✅ [CRITICAL] rx RECEIVED for ticket #1001 after 45.23s, success: true
✅ [TASK #1001] Reply task completed and ACKed
🏁 [TASK #1001] handle_reply_delivery FINISHED
🔄 [CONSUMER LOOP] handle_reply_delivery returned, continuing loop...

═══════════════════════════════════════════════════════════════

🔄 [CONSUMER LOOP] Got reply message, will AWAIT handle_reply_delivery...  ← 现在才处理下一个
```

### 步骤 3：检查异常情况

#### 异常 1：立即处理下一个
```
⏳ [CRITICAL] About to AWAIT rx for ticket #1001...
🔄 [CONSUMER LOOP] Got reply message...  ← 不应该立即出现！
```
**原因**：`await rx` 立即返回了
**解决**：检查是否有代码提前调用了 `tx.send` 或 drop 了 rx

#### 异常 2：没收到 complete_reply_task
```
⏳ [CRITICAL] About to AWAIT rx for ticket #1001...
... (等待 5 分钟) ...
⏳ [CRITICAL] rx TIMEOUT for ticket #1001 after 300s
```
**原因**：前端没调用 `complete_reply_task`
**解决**：
- 检查浏览器控制台是否有 JavaScript 错误
- 检查是否有 `processingMqId.current` 检查跳过了处理
- 确认 `detailRef.current` 是否存在

#### 异常 3：pending_acks 找不到
```
🎯 [complete_reply_task] Called for ticket #1001
❌ [complete_reply_task] No pending task found for #1001
```
**原因**：pending_acks 被提前清理或 ID 不匹配
**解决**：检查是否有其他代码路径清理了 pending_acks

## 🛠️ 常见问题修复

### 问题 1：有多个客户端在运行
**症状**：同时看到多个 "Starting AI Reply"
**解决**：只保留一个客户端进程

```bash
# macOS
ps aux | grep "fd-client" | grep -v grep
# 如果有多个，kill 掉多余的
```

### 问题 2：App.tsx 的 MQTaskRunner 冲突
**症状**：看到重复的事件监听
**解决**：确认 main.tsx 使用的是 AppNew

```typescript
// main.tsx 应该是：
import AppNew from "./AppNew";
// 不是：
// import App from "./App";
```

### 问题 3：前端状态去重逻辑误杀
**症状**：第二个任务被忽略
**解决**：检查 AppNew.tsx:116-119 的去重逻辑

```typescript
if (lastTaskRef.current?.id === data.ticketId && ... && (now - lastTaskRef.current.time) < 10000) {
    return;  // ← 这里可能导致任务被跳过
}
```

## 🎯 快速验证脚本

创建一个测试脚本发送 2 个工单到 MQ：

```bash
# 测试：连续发送 2 个工单
cd fd-server
# 触发两个工单进入 PENDING_REPLY 状态
# 观察日志，第二个应该在第一个完成后才开始
```

## 📊 性能指标

正常情况下，每个工单的处理时间：
- AI 生成：30-60 秒
- 总耗时：35-65 秒（包含网络、解析、保存）

如果看到：
- ❌ 处理时间 < 5 秒：说明没等待 AI 完成
- ❌ 超时 300 秒：说明前端没发送 ACK 信号
- ✅ 30-60 秒：正常

## 📝 日志关键字搜索

```bash
# 搜索关键日志
tail -f app.log | grep -E "\[CRITICAL\]|\[CONSUMER LOOP\]|complete_reply_task"
```

## ✅ 验证通过标准

1. ✅ 第一个工单开始处理
2. ✅ 看到 "About to AWAIT rx"
3. ✅ 等待 30-60 秒
4. ✅ 看到 "rx RECEIVED"
5. ✅ 看到 "handle_reply_delivery returned"
6. ✅ **然后才**看到第二个工单的 "Got reply message"

---

如果以上都检查了还有问题，请把**完整的日志**发给我！
