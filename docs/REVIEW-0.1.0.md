# 0.1.0 源码审查 / Source review

本记录对应 `v0.1.0` 发布后的 `main` 源码。已发布的标签、安装包和校验值保留原样。

These decisions apply to source changes on `main` after `v0.1.0`. The existing tag, downloads and checksums identify the original release.

| Gemini 项目 / Finding | 决定与依据 | Decision and scope |
| --- | --- | --- |
| P1-1 · 正式版诊断 / Stable diagnostics | 已修。正式版和既有 Beta 都检查适配，用错版本的 renderer 不能为新版本背书。 | Fixed. Stable and beta versions report unsupported or unverified adapters. A matching live profile can confirm a newer build. |
| P1-2 · 启动互斥 / Launcher mutex | 已修。以非阻塞方式取得互斥锁，处理上个进程异常退出的情形，并在释放句柄后显示重复启动提示。 | Fixed. Acquisition uses `WaitOne(0)` and handles abandoned ownership. A duplicate launch dialog holds no mutex handle. |
| P1-3 · 恢复入口 / Recovery exit code | 已修。实验入口透传退出码 4，使快捷方式可以显示「恢复 Loader」。 | Fixed. A Loader restart request retains exit code 4 through the experimental entry point. |
| P1-4 · 桥接租约 / Bridge ownership | 已修。移除全局命名管道，使用 Windows 用户本地目录中的 SQLite 排他文件锁，按后台 PID 和创建时间区分实例。 | Fixed. The bundled runtime holds an exclusive lock in the user profile. Separate profiles and backend instances are independent. Windows releases the lock when its holder exits. No extra service is required. |
| P1-5 · 管理员诊断 / Elevated tools | 部分采纳。系统命令改用 System32 下的路径。把提权脚本和报告输出移出可写工作区需要另行设计；这些可选维护脚本只适合可信的源码目录。 | Partly addressed. System tools use qualified paths. Isolating the elevated code and report destinations remains open. Use these optional maintainer scripts only from a trusted checkout. |
| P1-6 · 首启与状态 / First run and status | 已修。实际启动可创建缺失的 Codex 主目录；只读检查保持只读。无法证明普通后台归属时返回 `null`。隔离探针向实验构建提供已核对的桌面版本。 | Fixed. First launch prepares the profile, check-only mode avoids creating it, and unproven stock ownership is reported as unknown. The isolated probe passes the verified desktop version. |
| P2-1 · 安装所有权 / Installer ownership | 延后。卸载标记、已修改包和历史格式要一起测试，避免对第三方文件认错所有权。 | Deferred pending an install–upgrade–uninstall matrix with modified packages, unrelated files, BOM and CRLF inputs. |
| P2-2 · 档位与回执 / Tier records and receipts | 部分采纳。磁盘 UUID 统一小写，二次检查确认同一选择、模型和档位，并使用最新页面状态。延后缩容拒绝后重试、监控模式清除与后台记录同步、以及文件重试策略。模型名验证已与页面对齐。相同毫秒仍保守判定。 | Canonical IDs and fresh confirmation are fixed. Model identifiers now follow the renderer rules. Persistent tier semantics and file retries still need backend integration tests. Equal timestamps cannot prove that a turn followed a selection. |
| P2-3 · 环境变量 / Environment | 已修。回退时识别混合大小写的实验变量，保留用户配置的其他 CLI。 | Fixed. Fallback strips case variants of experimental overrides and preserves an unrelated CLI path. |
| P2-4 · 恢复窗口 / Recovery UI | 部分采纳。枚举桌面时先筛登录会话，异步操作完成后检查窗口是否已关闭。独立 CLI 与桌面进程的进一步辨别留待多会话实测。 | Partly addressed. The recovery UI handles closure during asynchronous work and checks session before exit state. Ambiguous process identity continues to block termination. |
| P2-5 · Loader 响应 / Loader replies | 已修。输入管道提前关闭时仍读取子进程的最终结构化响应。 | Fixed. An input `EPIPE` leaves the command result to the subprocess completion callback. Other input errors propagate. |
| P2-6 · 包体 / Installer layout | 采纳许可文件排序，避免普通安装因读取许可而解压实验组件。保留 100 MB 为参考值，符合以离线安装体验优先的要求。 | Private Loader notices now precede optional experimental payloads. The size target stays advisory to preserve offline setup. |
| P2-7 · 旧 MCP 源 / Missing MCP catalog | 延后。旧目录被删除后缺少所有权凭证，不能自动删除可能由用户添加的同名源。 | Deferred until catalog ownership can be established even when the prior directory is gone. |
| P2-8 · 多用户进程发现 / Process discovery | 延后全链路改动。需要多个 Windows 登录会话以及不同桌面可执行文件名的测试环境。 | Full launcher process filtering is deferred pending multi-session and executable-name fixtures. |
| P2-9 · 文件系统与默认档 / Filesystem and default tier | 延后。非 NTFS 复制回退必须保留文件完整性校验；恢复默认档需在对应 Rust 后台重新验收。 | Deferred pending non-NTFS integrity tests and backend acceptance for models without a compaction limit. |
| P2-10 · 安装目录与集合寿命 / Storage and retention | 延后。日志迁移涉及现有安装，缓存淘汰还会改变预警重置和历史对话跟随行为。 | Deferred. Log migration and cache eviction need upgrade and long-running session coverage. |
| P2-11 · 旧日志原型 / Historical log probe | 保留为历史研究工具，并在说明中明确用途。发行左栏直接读取当前窗口的原生状态。 | Retained as a historical probe. The shipped sidebar reads native renderer state; the prototype is outside its execution path. |
| P3 · 文档、构建与测试 / Release hygiene | 已同步中英文文档、六张图、随包说明、复现入口、审查 ZIP 和第三方说明；构建会输出发布名的恢复工具。加强 AST 校验和测试目录清理。托管 CI 与管理员实机测试留待后续。 | Updated bilingual guides, media, package docs, reproduction links, review ZIP and backend attribution. Launcher builds produce the named recovery asset. Parser checks and test cleanup were tightened. Hosted CI and elevated end-to-end tests remain open. |

## 如何复核 / Verification

在仓库根目录运行以下命令。桥接租约的跨进程用例使用支持 `node:sqlite` 的 Node；Windows 实验入口使用随包锁定的运行时。

Run these commands from the repository root. The cross-process lease test uses Node with `node:sqlite`. The experimental Windows launcher uses the pinned bundled runtime.

```powershell
node scripts/check.mjs
node --test --test-isolation=none "tests/*.test.mjs"
pwsh -File scripts/build-launcher.ps1
node scripts/build-sidebar.mjs
python scripts/package-sidebar.py --review-source
```
