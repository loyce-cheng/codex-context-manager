# Codex Context Manager 0.1.1

## 简体中文

- Codex 更新后，已安装实验组件的用户可继续从原快捷方式启动。遇到未验收的版本时，启动器先尝试打开普通监控，然后使用临时配置与本机模拟对话，检查新官方后台的单对话容量、恢复默认档和自动压缩行为。结果按桌面版本、后台文件摘要和测试版本缓存。
- 更新包含正式版本诊断、重复点击启动器、Loader 恢复引导、首次启动和 Windows 用户间的管道隔离修复。
- 隔离测试中，选定对话配置为 `512k` 后实测 `486.4k`，对照对话保持 `258.4k`。在桌面 `26.1120.6357.0` 上，还确认了适配器握手和目标对话可被列出。该版本的桌面新回合扩容仍待验收。安装包中启用真实扩容的组合仍为 Codex `26.1117.3838.0` 或 `26.1117.4957.0` 配合 Loader `0.6.2`。

保存工作并退出 Codex 和 Loader，再运行 Windows x64 Setup 即可覆盖升级。仅使用独立左栏扩展的用户可导入新版 ZIP。可用 `Get-FileHash -Algorithm SHA256` 对照发布附件中的校验文件。

## English

- After a Codex update, users who installed the experimental components can keep using their existing shortcut. For an unverified desktop version, the launcher first tries to open monitoring, then tests per-chat capacity, restoration of the default tier, and compaction against the packaged backend using temporary local fixture chats. Results are cached by desktop version, backend digest, and test revision.
- This update fixes stable-version diagnostics, repeated launcher clicks, Loader recovery guidance, first launch, and isolation of named pipes between Windows users.
- In the isolated protocol test, the selected chat measured `486.4k` at the `512k` tier and the control chat stayed at `258.4k`. Desktop `26.1120.6357.0` also acknowledged the adapter and listed the target chat. Expansion on a new turn submitted from that desktop is still awaiting verification. The installer enables live expansion for Codex `26.1117.3838.0` or `26.1117.4957.0` with Loader `0.6.2`.

Save your work and exit Codex and Loader before running the Windows x64 installer for an in-place upgrade. For sidebar-only installations, import the updated ZIP. Use `Get-FileHash -Algorithm SHA256` to verify downloads against the published checksums.
