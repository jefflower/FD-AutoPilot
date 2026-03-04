## /commit — 提交并推送到所有仓库

根据当前工作区改动，自动完成以下流程：

### 步骤

1. **检查状态**：运行 `git status`（不用 -uall）和 `git diff --stat` 查看所有改动
2. **分析改动**：根据改动内容生成简洁的中文 commit message（1-2 句话，聚焦"为什么"而非"改了什么"）
3. **暂存文件**：按文件名逐个 `git add`，不要用 `git add -A` 或 `git add .`。跳过 `.env`、credentials 等敏感文件
4. **提交**：使用以下格式提交（通过 HEREDOC 传递 message）：
   ```
   git commit -m "$(cat <<'EOF'
   <type>: <简要描述>

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
   type 为 feat / fix / refactor / docs / chore / style / test 之一
5. **推送到所有仓库**：依次推送到当前分支的所有远程仓库
   ```bash
   git push origin <当前分支>
   git push gitee <当前分支>
   ```
6. **确认结果**：运行 `git status` 确认工作区干净

### 注意事项

- 如果没有任何改动，直接告知用户"没有需要提交的改动"
- 如果用户通过 $ARGUMENTS 传入了自定义 commit message，直接使用该 message，不再自动生成
- 提交前如果 pre-commit hook 失败，修复问题后创建**新提交**，不要用 --amend
- 推送失败时告知用户具体错误，不要用 --force
- 推送完成后报告每个仓库的推送结果
