# dsh-evidence · 验证债务（终局门禁）

检测「声称完成但改了文件却没跑验证」，即"声明 ≠ 证据"。

- **订阅**：`session/event`（`tool/call` 追踪写文件/验证；`assistant/message` 检测"声称完成"）
- **发信号**：`ctx.emit('cvm/signal', { kind: 'evidence', active })`
- **对抗**：验证债务（说完成≠完成）

## 逻辑

```text
wroteFile：调用 edit/write/str_replace_editor
verified：调用 bash/pwsh（命令含 python/pytest/run 等验证关键词）
claimedDone：assistant 最终回答（不含 tool-call）命中"完成/搞定/已修复"等
终局门禁 = claimedDone && wroteFile && !verified
```

**时机**：只在"最终回答（不含工具调用）"判定"声称完成"，避免在实现阶段（edit 后还没验证）误触发——这是用教训换来的（见根文档"阶段语义"）。

## 注意

此插件在 C1 场景的独立贡献未被充分验证（判据需 bash 命令内容，headless 评测慢）。核心验证靠 convergence。
