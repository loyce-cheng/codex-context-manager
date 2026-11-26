# 已加载对话的容量调整原型

Context Lens 的独立后台实验为 Codex app-server 增加了按对话设置模型窗口的请求。当前桌面版 `26.1117.3838.0` 对应 `rust-v0.171.0-alpha.13`。左栏发行包使用桌面自带的后台。[当前上游源码](https://github.com/openai/codex/tree/581161ab41e643d942e1e1b5f561034060bf18e3)

| 后台标签 | 补丁 | 上游提交 |
| --- | --- | --- |
| rust-v0.171.0-alpha.13 | `context-window-0.171.0-alpha.13.patch` | `581161ab41e643d942e1e1b5f561034060bf18e3` |
| rust-v0.169.1 | `context-window.patch` | `c376cf7396eff83ce4c6ac61b9553df142e7a0be` |
| rust-v0.169.0-alpha.11.1 | `context-window.patch` | `226fa88979b1a9d76dc36f339ee9c5fbdb2c8e7f` |

## 使用官方后台的隔离桌面实验

Windows x64 开发机可在仓库根目录用 PowerShell 7 运行以下探针。它读取当前注册的 Codex 安装，为一次性桌面资料和本地模拟模型创建两条合成对话。源码中的测试适配器编译在本次资料目录内。它只尝试给预先登记的 Target 对话的首次合格恢复请求加上 `512k` 预设。Control 用于核对同一后台的默认容量。该入口未随安装包发布。

```powershell
pwsh -NoProfile -File experiments/desktop-context-window/probe-desktop-host.ps1 -FixtureAdapter -ObserveSeconds 120
```

只复测适配器和官方后台时，可用 `-ProtocolOnly` 替换 `-ObserveSeconds 120`，此时不会启动桌面。

若隔离窗口显示 **Context Lens fixture Target**，打开它并发送简短的测试文字。若窗口要求登录，可让测试超时退出。结果位于本次 `.research/desktop-host-<UUID>/report.json`。各字段代表不同阶段：

| 字段 | 通过条件 |
| --- | --- |
| `protocolTest` | 测试客户端经适配器恢复两条对话并发送本地模拟回合，官方后台分别报告 Target `486400`、Control `258400`。 |
| `desktopHandshake` | 测试桌面实际发出初始化请求，收到官方后台与请求 ID 匹配的成功响应。 |
| `desktopTargetResume` | 测试桌面自然恢复了符合条件的合成 Target，适配器已将预设放入请求。 |
| `liveCapacityVerified` | 同一桌面恢复请求获得正确对话、模型和提供方的确认，后续新回合收到匹配的 `486400` 原生读数并成功结束。 |

探针成功退出表示桌面握手和进程归属验证通过。桌面真实调档要以最后一项为准。只有模拟对话阶段通过时，不能将该版本列入正式扩容兼容表。

## 左栏接入实验

Alpha 12 在用户松开滑块、用键盘确认档位或清除预设时生成一次选择。实验桥接进程读取 Loader 的公开 `inspect` 操作，核对当前本地对话、模型和提交时间，然后原子写入该对话自己的 JSON 文件。已有预览不会在启动时自动提交。后台在正常的 `turn/start` 通过会话所有权和输入检查后读取档位，沿用单对话接口的模型上限、当前用量和压缩阈值校验。正在生成的回合保留已捕获的窗口。左栏读数仍来自原生用量事件。

在应用对应版本的后台补丁后运行以下命令准备和构建桌面候选程序。桌面调用完整 CLI 的 `app-server` 子命令，还会传入 analytics、插件工作目录及 Windows 运行环境参数。

```sh
python experiments/desktop-context-window/prepare-desktop-tiers.py <upstream-checkout>
# 在 <upstream-checkout>/codex-rs 下构建
cargo build --locked -p codex-cli --bin codex
```

从项目根目录运行隔离测试。浏览器测试需要 Playwright 和 Chromium，可以用 `PLAYWRIGHT_MODULE` 和 `CHROME_PATH` 指定已有安装。

```sh
node scripts/probe-capacity-protocol.mjs "<完整实验 CLI>" --desktop-cli --loaded-window=patched --complete --desktop-tiers --sidebar-browser
```

实验进程使用单独的 `CODEX_HOME`。只有显式设置 `CONTEXT_LENS_DESKTOP_TIERS=1` 的后台才读取该目录下的 `context-lens-desktop-tiers-v1/<threadId>.json`。桥接进程与后台必须指向同一目录。读取失败、模型不匹配或缩容会立即触发压缩时，聊天继续使用已有窗口。选择新档位后，以后续一回合的原生 `thread/tokenUsage/updated` 确认结果。

桌面探针 `probe-desktop-host.ps1 -Cli <完整实验 CLI>` 为已核对过的 Windows 桌面版本创建新的 Electron 资料目录和后台目录，并检查该桌面进程实际启动的子程序。加 `-Stock` 可运行官方后台对照。进程选择与原对话的用量验收分别记录。

### 在本机试用

#### 后台体积实验

在已配置 MSVC 和仓库锁定 Rust 工具链的构建 shell 中，先设置本机 Cargo 缓存、`RUSTY_V8_ARCHIVE` 与 `RUSTY_V8_SRC_BINDING_PATH`，再运行 `build-size-candidate.ps1 -CrateRoot <已应用补丁的 codex-rs> -TargetDirectory <项目下 .research 中的候选目录>`。它以锁定依赖离线构建完整 CLI，将产物和日志写入独立目录。当前体积优化候选已在隔离测试中验证双对话容量、实测回执和自动压缩。个人窗口仍以正式登记的实验文件哈希选择后台。

维护者可用 `build-desktop-setup.py --portable-loader <固定发行 ZIP> --measure-backend <候选 CLI>` 配合原有 `--iscc`、`--codex-source` 参数试打完整载荷；可选 `--measure-large-dictionary` 对比强压缩。测量编译不会发布安装器。构建多版本 Loader 时，`loader/build.ps1 -DesktopVersion 26.1117.3838.0 -AdditionalDesktopVersions 26.1117.4957.0 -StageOnly` 使用同一份组件测试两个精确版本，同时核对启动时选定的桌面版本。多版本实验另需传入已固定的源码 ZIP 和 .NET SDK。

Windows 26.1117.4957.0 的专用 Loader 随本机实验入口选择，旧版 3838 的构建保存在原目录。4957 的隔离桌面实际启动了实验后台，并在测试后退出。双对话回合使用独立资料目录和本地模拟模型。切换个人窗口后，以该窗口下一回合的原生容量确认实际效果。

日常监控使用“Codex + Context Lens”。要启用单对话扩容，打开 `dist/launcher/Context-Lens-Experimental.exe`。首次从普通模式切换时，启动器会等最多 15 分钟供你保存并完全退出 Codex，然后自动启动。关闭等待提示可以取消。进入实验模式后，打开原来的本地对话，拖到 512k，看到“已提交”再发一条消息。这个版本在该档位报告的有效窗口是 486,400。以后为同一窗口中的其他聊天调档也在各自下一回合生效。

本机桌面和开始菜单另有 **Codex + Context Lens（实验扩容）**。保存工作并完全退出普通 Codex 后，可随时从这个入口直接启动实验模式。要在其他已完成构建的机器上创建同名入口，运行 `dist/launcher/Context-Lens-Experimental.exe --install-shortcuts`。

实验启动器使用单独编译的 Loader 0.6.2 和 Windows 注册的 Codex 启动别名。隔离桌面实测覆盖了最终编译的启动组件、返回的桌面进程 ID、父子关系和实际后台路径。两个聊天的容量回执使用同一份完整 CLI 和本地模型夹具验证。个人桌面原对话的生效依据是选档后下一回合的原生容量。

在有 PowerShell 7、Git、Visual C++ Build Tools、Windows SDK 和 .NET SDK 10.0.403 的 Win11 机器上，可以用 `loader/build.ps1 -SourceArchive <上游源码 ZIP> -Dotnet <dotnet.exe>` 复建独立 Loader。下载固定提交的源码 ZIP 并由构建脚本核对 SHA-256。脚本从干净源码应用启动补丁并生成完整文件清单。维护者发布新构建前需要复测，再更新 `loader/release.mjs` 中固定的清单摘要。[上游源码 ZIP](https://codeload.github.com/JHees/codex-script-loader/zip/c9d38d66c6643e6780a67e280488a36f53b6da4e)

实验入口校验桌面版本和本地候选程序的 SHA-256。Codex 更新到尚未验证的版本时走普通左栏启动流程。后台文件是本地构建产物，单独导入左栏 ZIP 只会安装左栏。Windows 桌面选中实验程序、完整 CLI 接收桌面参数、只读沙箱允许读取并拒绝写入，以及两个隔离聊天的原生容量均已实测。

桌面执行代码工具还依赖与后台相邻的 `codex-code-mode-host.exe`。正常启动时，若实验目录缺少该文件，启动器从已安装的匹配版本 Codex 包复制并校验 SHA-256。`--check` 只做校验。选档时如果一条回复已经开始，该回合的原生容量会保留到结束；下一条消息可以在同一对话验证新容量。

## 使用语义

调用方在实验 API 连接上发送 `thread/contextWindow/set`。服务端使用请求中的对话 ID 查找已加载的会话，检查当前连接是否可以操作该对话，再校验模型和档位。普通客户端遇到未知方法即可判断后台缺少这项能力。

```json
{
  "id": 12,
  "method": "thread/contextWindow/set",
  "params": {
    "threadId": "<已加载的对话 ID>",
    "expectedModel": "gpt-6-astra",
    "selection": { "tokens": 512000 }
  }
}
```

- 选择只保存在该会话的内存配置中。已经捕获的回合继续使用原窗口，下一回合在同一 ID 上读取新窗口。卸载会话或退出后台后，这项选择随会话释放。
- 后台从当前模型目录读取原始默认值、最大值和可用比例。目录缺少边界、模型身份不匹配、容量超界时会返回错误。下一回合会重新核对目录，模型或边界变动导致选择不适用时使用原有设置。侧栏可继续使用固定档位，后台接受范围内的整数 token 数。
- `"selection": "default"` 恢复这条对话启动时继承的设置，包括原来的压缩策略。使用量达到新窗口或新基础压缩阈值时，改档会被拒绝并保留上次选择。重复提交已选档位可以安全重试。
- 回执包括 `threadId`、`model`、`rawTokens`、`usableTokens` 和 `autoCompactTokenLimit`。将来接入左栏时，应等对应对话、对应新回合的 `thread/tokenUsage/updated` 确认实测容量。没有新回合时可以显示“下回合生效”。

### Astra 的 512k 档

| 数值 | 含义 |
| --- | --- |
| 512,000 | 用户选择的原始窗口 |
| 486,400 | 此版本按 95% 计算的可用窗口，也是新回合应报告的容量 |
| 460,800 | 总上下文的基础压缩阈值。原型申请可用窗口的 95%，Codex 再按原始窗口的 90% 取较小值 |

压缩由 Codex 在回合内的检查点调度，实际触发时机还受缓冲和回合末策略影响。当前官方后台在 512k 档处理长合成历史时发出了开始压缩事件，同一份历史在 768k 档没有触发该事件。[窗口计算](https://github.com/openai/codex/blob/581161ab41e643d942e1e1b5f561034060bf18e3/codex-rs/protocol/src/openai_models.rs) · [原生压缩判断](https://github.com/openai/codex/blob/581161ab41e643d942e1e1b5f561034060bf18e3/codex-rs/core/src/session/context_window.rs)

## 复现

在开发机上克隆上述标签，在克隆的仓库根目录应用补丁。下面的 `<实验目录>` 指本说明所在目录。检查与测试仅针对独立源码副本。

```sh
git rev-parse HEAD
git apply --check "<实验目录>/<对应版本补丁>"
git apply "<实验目录>/<对应版本补丁>"
python "<实验目录>/check-policy.py" .
```

`0.171.0-alpha.13` 的源码标签已写入发布版本号，随附锁文件中的 174 个本地包仍标为 `0.0.0`。编译此标签前，在独立源码副本运行 `python "<实验目录>/prepare-release-lock.py" .`。脚本校验输入和输出的完整哈希，只同步这 174 个本地版本号。第三方依赖、Git 提交和校验和均与发布标签一致。之后可使用 Cargo 的 `--locked` 选项。

轻量检查需要 Git、Python 3 和 Rust。当前版本使用上游锁定的 Rust 1.99.1。检查会编译补丁中的容量策略，并将上游窗口计算方法与 Astra 目录数据放入最小 Rust 测试程序。可用 `--rustc` 指定编译器，用 `--build-dir` 指定专用测试目录。

具备该版本 Codex 构建依赖的开发机可运行两项后台集成测试。第一项检查已捕获回合、实际用量保护和压缩基础阈值。第二项启动真实 app-server，使用本地模拟模型响应，比较同一进程中两条聊天的原生用量通知，并检查恢复默认设置。

```sh
cd codex-rs
cargo test --locked -p codex-core --lib context_window_set_keeps_captured_turn_and_checks_native_usage
cargo test --locked -p codex-app-server --test all context_window_set_changes_only_the_next_turn_of_one_loaded_thread
```

当前上游将协议导出预先打包。0.171.0-alpha.13 补丁包含上游生成器产生的实验协议包，其中已核对 `thread/contextWindow/set`。后续修改请求或回执结构时，在 `codex-rs` 内运行 `python app-server-protocol/scripts/write_schema_fixtures.py --experimental`，然后重新构建。本地验收还直接向独立进程发送请求，核对运行时是否支持。

## 本次验证

### Windows 11 25H2 复测

2026-11-21，桌面日志报告后台仍为 `0.171.0-alpha.13`。使用校验过发布 SHA-256 的同版本官方独立后台和本机模拟模型完成 4 个对照回合。默认聊天的原生用量通知报告 258,400，可用窗口按 512k 启动的聊天报告 486,400。对已加载的默认聊天提交扩容请求得到“未知方法”，两条聊天各自的读数保持原值。

同一份 1,880,000 字节的合成历史在 512k 档触发并完成了自动压缩。后续请求携带了模拟摘要；模拟提供方报告的用量从 483,995 下降到 34,068。768k 档正常完成回合，没有触发压缩。测试中的 token 数由模拟提供方计算。复测时可在下列两个命令中将可执行文件替换为同版本的独立 app-server。

```sh
node scripts/probe-capacity-protocol.mjs "<官方 app-server>" --standalone --loaded-window=stock --complete
node scripts/probe-auto-compaction.mjs "<官方 app-server>" --standalone --complete
```

同版本实验后台已在这台 Win11 上用 MSVC 和 Rust 1.99.1 编译并通过双对话实测。A、B 均以默认容量启动。在 A 的模拟模型请求进行中选择 512k，当前回合仍报告 258,400，A 下一回合报告 486,400。同时采样的 B 报告 258,400。对 A 请求 900k 收到拒绝后仍为 486,400，恢复默认后回到 258,400。八个回合都已完成，读数逐一核对了各自的原生用量通知。全程由同一后台进程持有两个对话 ID。

本机使用 Visual Studio 2022 Build Tools 14.44、Windows SDK 10.0.26100.0 和 `x86_64-pc-windows-msvc` Rust 工具链。源码编译时按该标签的清单校验 V8 152.2.0 的 Windows 库和 Rust 绑定，分别设置 `RUSTY_V8_ARCHIVE` 和 `RUSTY_V8_SRC_BINDING_PATH`。应用补丁并对齐锁文件后，在 `codex-rs` 运行 `cargo build --locked -p codex-app-server --bin codex-app-server` 即可构建独立测试程序。[上游 V8 构建依赖校验](https://github.com/openai/codex/blob/581161ab41e643d942e1e1b5f561034060bf18e3/.github/actions/setup-rusty-v8/action.yml)

在用 RPC 热调档位后，相同长输入在 512k 档完成压缩，在 768k 档直接完成回合。桌面应用仍使用官方后台，左栏保存的档位暂未连接到这个实验进程。

```sh
node scripts/probe-capacity-protocol.mjs "<实验 app-server>" --standalone --loaded-window=patched --complete
node scripts/probe-auto-compaction.mjs "<实验 app-server>" --standalone --hot --complete
```

### 桌面 26.1117.3838.0 与后台 0.171.0-alpha.13

2026-11-20，从同一官方后台启动两条隔离聊天。默认的 A 报告 258,400，按 512k 启动的 B 报告 486,400。对已加载的 A 调用 `thread/contextWindow/set` 得到 `-32600 unknown variant`。再次采样时 A、B 分别仍为 258,400 和 486,400，两个 ID 都在已加载列表。数值来自对应回合的原生 `task_started.model_context_window` 记录。离线测试使用缺少密钥的测试提供方，回合在模型调用阶段失败。

另一次测试在独占的后台中卸载并恢复 A 的同一 ID。恢复时传入 512k 后，A 从 258,400 变成 486,400，同时 B 保持 258,400。重启这个独立后台后，按 A 保存的 768k 档恢复，读到 729,600，B 仍为 258,400。自然恢复时需要重新带上档位。桌面要使用这条路径，还需要由宿主协调会话释放和恢复。

在 Context Lens 仓库根目录运行以下命令可复测。脚本将临时聊天写入 `.research` 下独立的 `CODEX_HOME`。运行实验编译出的独立 app-server 时用 `--standalone`。

```sh
node scripts/probe-capacity-protocol.mjs "<官方 codex 路径>" --loaded-window=stock
node scripts/probe-capacity-protocol.mjs "<已编译 codex-app-server 路径>" --standalone --loaded-window=patched
node scripts/probe-capacity-protocol.mjs "<官方 codex 路径>" --local-turn --natural-resume --explicit-expansion --cold-resume
node scripts/probe-auto-compaction.mjs "<官方 codex 路径>"
```

补丁模式会核对同一对话改档、重复提交、越界拒绝、恢复默认值、另一条聊天以及全局设置。原型的 4 项轻量 Rust 测试已经通过。官方后台已实测发出压缩开始事件，本机模拟模型的 HTTP 请求超时，摘要生成与后续回合尚待验证。

### 较早版本

2026-11-20 的桌面版本 `26.1111.9664.0` 使用后台 `0.169.1`。同一份补丁已成功应用到新版官方标签，4 项轻量 Rust 检查在这个版本通过。已安装后台导出的实验协议共 184 个请求，其中 `thread/settings/update`、`turn/settings/update`、`turn/start` 都没有容量字段，也没有 `thread/contextWindow/set` 方法。桌面启动代码有选择其他 CLI 的分支，但还需要在独立桌面实例中验证后台选取、会话所有权和原有执行权限。左栏继续显示原生用量，拖动时保存本对话的预设。[0.169.1 源码](https://github.com/openai/codex/tree/c376cf7396eff83ce4c6ac61b9553df142e7a0be)

补丁已在原始提交的干净文件上回放，11 个 Rust 源文件与开发副本一致。4 项轻量 Rust 检查、17 项 Context Lens 既有容量回归检查通过。完整 app-server 构建停在 Cargo 检出 V8 的 libc++ 子模块，Windows 报路径过长。两项后台集成测试已随补丁交付，尚待运行。桌面原对话的热扩容和长对话实际发生压缩仍待实测。
