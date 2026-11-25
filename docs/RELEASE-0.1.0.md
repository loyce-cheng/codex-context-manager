# Codex Context Manager 0.1.0

首个公开版本面向 Windows x64。原有 Context Lens 安装可直接覆盖升级。已有快捷方式和插件标识继续使用 Context Lens。

## 安装

1. 保存工作并退出 Codex 和 Loader。
2. 下载并运行 `Codex-Context-Manager-0.1.0-windows-x64-Setup.exe`。默认选项安装当前会话监控。
3. 从开始菜单的 **Context Lens → Codex + Context Lens** 启动，打开已有的本地对话。左栏显示有效容量和剩余百分比，剩余容量达到 20% 时变红并提醒。

安装包包含运行时和便携 Loader。已有兼容共享 Loader 的电脑会复用现有安装。只需要手动导入左栏的用户可下载 `context-lens-sidebar-0.1.0.zip`。遇到更新后 Loader 留在后台，可以打开开始菜单的 **恢复 Loader**，也可单独运行 `Codex-Context-Manager-0.1.0-Recovery.exe`。

## 兼容范围

普通监控会在启动时检查新版 Codex 的本机页面资源。实验扩容根据桌面版本、Loader 版本和后台文件单独启用。本次发布已验收的实验组合为 Codex `26.1117.3838.0` 或 `26.1117.4957.0`，搭配 Loader `0.6.2`。其他桌面版本可按页面适配结果使用普通监控。

安装包和独立恢复工具为未签名的 Windows 程序。可使用 `Get-FileHash -Algorithm SHA256` 核对下载文件与 Release 中的 `SHA256SUMS.txt`。卸载入口在 **Windows 设置 → 应用 → 已安装的应用 → Codex Context Manager**。
