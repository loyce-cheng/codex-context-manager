# 当前对话日志原型

本目录是实机验证用的只读原型，**没有接入 Alpha 2，也不进入其安装包**。

在 Windows Codex 26.1023.6123.0 上，应用日志的 `IAB_LIFECYCLE received browser sidebar owner sync` 事件提供 `ownerRoutePath`。本次实测路径为 `/local/<thread UUID>?hostId=local`，同时包含 Electron 的 `windowId` 和 `originWebContentsId`。它们不是 Windows HWND 或屏幕坐标。

必须使用页面路径里的 ID；同条日志的 `conversationId` 是浏览器所属上下文，可能与当前页面不同。创建事件、token 更新、窗口焦点以及 `thread_stream_view_activity_changed` 均不独立作为选择依据。

## 运行验证

使用已经从当前进程日志核实的窗口和 renderer ID，以及用户授权的新测试对话 ID：

```sh
node experiments/desktop-log-follow/probe.mjs --window <Electron窗口ID> --renderer <WebContentsID> --only-thread <新测试对话UUID> --seconds 60
```

程序从当前日志末尾开始，最多运行 180 秒，每 500ms 检查追加内容，自动退出。不重放旧记录来冒充当前状态。切到允许的测试对话时读取真实本地用量；切到其他可识别对话时清除身份并输出 `out-of-scope`。需要在程序启动后实际切换一次页面。

`--only-thread` 是本次验证的显式白名单，**不是已经自动发现所有新对话**。窗口和 renderer 参数也是验证输入，尚未实现用户无感的绑定过程。

## 重要边界

- 内部诊断日志不是官方稳定 API；仅验证了当前版本和单个主窗口。
- 尚未验证所有无对话页面是否都会写出该事件。没有事件时不能证明页面仍停留原处；该原型不得作为不受限制的正式自动跟随功能。
- 多窗口焦点、窗口关闭、主进程重启、日志权限错误和升级后的兼容性，仍需完整状态管理。
- `ownerRoutePath` 在宿主代码中位于日志的 sensitive 字段组；它在本机日志中可见，但其他配置或版本可能删去它。字段缺失不能猜测 UUID。
- 此原型只用于识别和读取，不执行热扩容、压缩或配置写入。
- 只保留日志中的事件身份和必要数字字段；不输出日志正文或对话内容。使用 2MB 追加读取上限，出现截断或缺口时清除状态；文件轮转策略仍需发行前的专门验证。

实测与后续开发条件见 [日志验证报告](../../docs/AUTO_FOLLOW_LOG_VALIDATION.zh-CN.md)。
