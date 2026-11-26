# Context Lens 左栏扩展 · Sidebar extension 0.1.1

## 安装与使用

本 ZIP 是 Windows 版 Codex Script Loader 的 renderer 扩展。已有兼容 Loader 时，在 Codex 设置的 Script Loader 页面导入并启用 ZIP，再通过 Loader 打开一条本地对话。需要安装 Loader 或使用实验扩容时，可使用完整的 [Windows 安装包](https://github.com/loyce-cheng/codex-context-manager/releases/tag/v0.1.1)。

- **读数**：窄条显示 Codex 上报的有效容量和剩余百分比。前台每 500 毫秒检查一次当前对话，页面隐藏时暂停。读数随原生用量事件更新。两个「—」表示暂时没有可核对的用量；可打开已有记录的本地对话，或在新对话中完成一个回合。剩余 ≤ 20% 时显示 5 秒提醒，恢复到 > 25% 后可再次触发。
- **移动**：按住六点握柄向右拖出成为横向悬浮条。右击可切换竖向或固定回左栏。空间不足时停靠条会让出位置。显示偏好保存在本机。
- **选档**：按住进度条直接拖动，或使用方向键和回车。松手保存当前对话、当前模型的预设，约 1.5 秒后回到实测容量。普通模式只保存预设。实验模式看到「已提交」后再发消息，后续回合显示的实测容量用于确认是否生效。模型有效比例为 95% 时，`512k` 的预计容量是 `486.4k`。
- **更新**：ZIP 使用内置模型快照和页面适配表，含 `26.1117.4957.0` 和 `26.1120.5083.0`。完整启动器还会尝试核验新版页面；真实扩容按桌面、Loader 和后台的组合单独验收。更新后无读数可从开始菜单打开 **Context Lens → 查看状态**。Loader 残留时，先保存工作并退出 Codex，再用 **恢复 Loader**。
- **权限**：扩展声明 `dom`，在当前页面内运行。`inspect` 接受空对象并返回状态、当前读数与预设选择；`staged` 和 `measured` 分别确认提交与实测，仅对匹配的选择显示回执。显示偏好和对话预设保存在本机。Loader 脚本可访问页面，请从可信来源安装。

## Installation and use

This ZIP is a renderer extension for Codex Script Loader on Windows. With a compatible Loader installed, import and enable the ZIP in Codex Settings → Script Loader. Launch Codex through Loader and open a local chat. For a bundled Loader or experimental tier changes, use the [Windows installer](https://github.com/loyce-cheng/codex-context-manager/releases/tag/v0.1.1).

- **Read the meter.** It shows effective capacity reported by Codex and the percentage remaining. The visible page checks the current chat every 500 ms and pauses while hidden. Readings change when Codex supplies usage. Two dashes mean usage is unavailable. Open an existing local chat or complete a turn in a new one. At ≤ 20% remaining a five-second warning appears. It re-arms above 25%.
- **Move the meter.** Drag right from the six-dot grip to float horizontally. Right-click to switch orientation or dock again. The dock yields space to navigation controls. Layout preferences are stored locally.
- **Select a tier.** Drag the bar directly, or use the arrow keys and Enter. Releasing saves the preset for this chat and model. The display returns to measured capacity after about 1.5 seconds. Standard mode saves the preset only. In experimental mode, wait for *Submitted* before sending a message and confirm the result from a later turn. At 95% effective capacity, `512k` gives an estimated `486.4k`.
- **After an update.** The ZIP uses bundled model and page profiles, including `26.1117.4957.0` and `26.1120.5083.0`. The full launcher can also check new page assets. Experimental changes require a separately verified desktop, Loader, and backend combination. Open **Context Lens → 查看状态** (*Status*) if readings disappear. For a lingering Loader, save your work, exit Codex, and open **恢复 Loader** (*Recovery*).
- **Permissions.** The extension declares `dom` and runs in the current page. `inspect` accepts an empty object and reports status, readings, and the current selection. `staged` and `measured` deliver submission and measurement receipts for a matching choice. Preferences and presets are stored locally. Install Loader scripts from sources you trust.

[完整项目文档 / Project documentation](https://github.com/loyce-cheng/codex-context-manager)
