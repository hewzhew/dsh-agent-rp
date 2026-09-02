# DSH Agent RP

DSH Agent RP 是运行在 DSH 上的原生角色扮演 Runtime。角色会直接作为顶层 Agent 行动；Persona、世界、提示策略、正则包、状态和记忆都是可以独立选择、复用与组合的一等资源，而不是某张角色卡的附属设置。

Character Card、Chat Completion 预设、World Info、MVU、EJS 和 Tavern Helper 是目前优先接入的内容格式。它们让已有创作可以进入这套 Runtime，但不会反过来定义它的能力边界。

## 现在可以体验什么

- 从「角色或世界书」入口选择传统角色对话或世界书场景，再组合 Persona、世界、提示策略、独立正则包与开场；已知的外部资源权限会在启动前一次处理。
- 导入 PNG、JSON、CHARX 角色卡，以及 World Info、Chat Completion 预设、独立正则包和 SillyTavern JSONL 聊天记录；角色、Persona、世界、预设与正则包可以分别保存和复用。
- 连续游玩一段可回溯的故事：重新生成、续写、切换回复版本、修改输入并创建分支，同时保存明确状态与长期记忆。
- 用「游玩场地」组合可执行世界、人物档案、可编辑的大纲、伏笔、公开历史、人物私有认知、原著资料和正文分区；当前人物可以先从世界模块提供的合法动作中行动，单独保留或使用自己获得的世界机会，再由研究、人物、导演、对白、分区与编辑 Worker 协作写成正文。
- 运行更复杂的社区内容：MVU、同步 EJS、世界书正则、显示正则、轻量 HTML 前端及一部分 Tavern Helper 脚本会进入各自受限的兼容环境，单项失败不会拖垮整段会话。
- 在沉浸视图与调试视图之间切换，查看实际生效的提示、世界召回、状态和运行诊断。

角色本身仍是顶层 Agent，角色对话直接发生在普通会话中。未启用故事工程时没有额外的旁白、协调器或 Character 子代理；启用故事工程后，人物 Worker 只在正文前依据各自私有认知提出行动，最终回复仍由顶层角色 Agent 展示。

一轮中的工作按用途分开：搜索等写作前工具会把结果交还角色，并继续使用当前角色与预设完成正文；可选的正文审阅 Worker 只接收角色已经写完的回复，不重新注入酒馆预设，审阅结果会作为可切换回复版本保存；正文后生成的图片只进入精简的呈现交接，同一回合首次生图尝试完成或失败后都会隐藏生图入口，下一回合才恢复；MVU 状态由后续 Worker 读取最终可见正文，依次生成候选操作并独立核验，只有核验结果可以结算。每项 Worker 都有独立请求和终止记录，单项失败会保留角色 Agent 原文并继续后续阶段。玩家明确要求保存长期记忆时，角色可以在可见回复末尾调用 `remember`，保存成功后直接结束本轮，不再为工具回执重写一次正文。

故事工程的文件模型、认知范围、写作流水线与失败降级见 [docs/story-engine.md](docs/story-engine.md)。它与正文审阅、状态结算的完整先后关系见 [docs/multi-agent-turn-workers.md](docs/multi-agent-turn-workers.md)。

## 安装

需要 Node.js 22.19+ 或 24+，以及 pnpm 11。没有 pnpm 时可以先运行 `npm install --global pnpm@11`。安装器会准备经过验证的 Agent Host，从 npm 的 `next` 标签安装或更新 Agent RP，并保留 `~/.dsh` 中已有的角色与会话；它不会静默安装全局工具。

### DSH Desktop

DSH Desktop 使用自己封装的 Node、pnpm、DSH Host、数据目录和当前激活的 profile，不会复用下面的 Windows Agent Host。当前正式版 DSH Desktop `2.0.2` 及其仓库中的 `2.0.3` 开发版本均固定在未包含安全插件事件写入能力的官方 DSH `0.1.1-rc.2`；把 Agent RP 安装进 Desktop profile 只能按纯对话兼容路径看待，不能完整保存 Agent/MVU 回合。

若只需协助验证纯对话兼容，可以从 Desktop 托盘打开它自带的 DSH Terminal，在当前激活的 profile 中安装插件后重启 Desktop：

```powershell
dsh plugin add '@hewzhew/dsh-agent-rp@next'
```

这条路径尚未列为完整支持入口。不要运行下面的 Windows 安装器来“覆盖” Desktop；它会创建一个独立 Agent Host，而不会修改 Desktop 安装包内部的运行时。完整支持需要 Desktop Host 提供与 Agent Host 等价的安全插件事件接口，或允许 Desktop 连接到经过验证的外部 Host。

### Windows

```powershell
$installerPath = Join-Path $env:TEMP 'install-dsh-agent-rp.ps1'
Invoke-WebRequest 'https://raw.githubusercontent.com/hewzhew/dsh-agent-rp/main/scripts/install-windows.ps1' -OutFile $installerPath
powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath -Start
```

当前 Agent Host 固定在官方 DSH `0.1.1-rc.2`，并通过 pnpm 的可审计补丁机制补上插件私有事件写入能力；依赖版本和补丁哈希都由锁文件约束，安装器还会实际导入 Session 模块验证能力已经生效。官方 DSH 发布等价接口后会移除这层补丁。直接运行官方 `@deepseek-ai/dsh@0.1.1-rc.2` 仍可使用纯对话兼容模式，但不能完整保存 Agent/MVU 回合记录；官方 runner 与 Agent Host 显示相同的 DSH 版本号，不能只按版本号判断能力。

安装器会在默认 DSH 数据目录生成稳定的 Agent RP 专用启动入口。以后更新时重新运行同一安装器；平时启动使用：

```powershell
& "$env:USERPROFILE\.dsh\bin\dsh-agent-rp.ps1"
```

设置过 `DSH_HOME` 时，安装器会打印该数据目录中的实际启动路径。不要改回 `npx -p @deepseek-ai/dsh@latest dsh --profile web`；这会重新进入尚未包含插件事件能力的官方 runner。若界面提示当前 Host 缺少安全插件事件能力，请关闭旧 DSH 后从上述专用入口启动。安装器发现默认端口 3080 已被其他进程占用时不会停止它或再启动第二个 DSH，而会显示进程 PID 和后续命令。

国内 npm registry 较慢时，可在安装器最后一行加 `-ChinaMirror`。这个选项会同时用于 Agent Host 依赖和 Agent RP 包；安装器脚本与 runner 文件仍从 GitHub 下载。

### macOS

Apple Silicon 与 Intel Mac 使用独立安装器。安装器会在 `~/.dsh/bin/dsh-agent-rp` 创建稳定入口，并使用与 Windows、Linux 相同的冻结 Agent Host 和插件事件补丁：

```bash
installer_path="$(mktemp)"
curl -fsSL https://raw.githubusercontent.com/hewzhew/dsh-agent-rp/main/scripts/install-macos.sh -o "$installer_path"
bash "$installer_path" --start
```

若缺少原生构建工具，请先运行 `xcode-select --install` 并安装 Python 3。使用自定义 `DSH_HOME` 时必须传入绝对路径；安装完成后始终使用安装器打印的专用入口启动，不能改回官方 runner。更新时以同一用户重新运行安装器。

### Linux

普通 Linux 桌面或服务器使用独立安装器。请以以后实际运行 DSH 的非特权用户执行；默认会在 `~/.dsh/bin/dsh-agent-rp` 创建稳定入口：

```bash
installer_path="$(mktemp)"
curl -fsSL https://raw.githubusercontent.com/hewzhew/dsh-agent-rp/main/scripts/install-linux.sh -o "$installer_path"
bash "$installer_path" --start
```

Debian/Ubuntu 若缺少原生构建工具，可先安装 `build-essential` 与 `python3`。使用自定义 `DSH_HOME` 时必须传入绝对路径；启动器会从自身位置恢复同一个数据目录，不会退回另一个 `~/.dsh`。更新时以同一用户重新运行安装器。

无桌面服务器、systemd、Cloudflare Tunnel 和反向代理部署见 [Linux 服务器部署](docs/linux-server.md)。`--trusted-host` 只允许指定 Host authority 通过 DSH 的可达性围栏，不提供账号、登录或访问控制；对公网暴露时必须另配认证层。

贡献者需要修改源码时，才应克隆仓库并在仓库根目录运行 `pnpm install`、`pnpm run build`，再让 Agent Host 的 `dsh plugin --profile web add .` 指向本地目录。

当前源码迁移固定 DSH `0.1.2-alpha.5` 和仓库内的最小 Host 补丁。先准备精确位于上游 tag 且已应用该补丁的 DSH checkout，再运行 `node scripts/dsh-alpha-dev.mjs setup --dsh-root ../dsh-alpha5-host`；这个零依赖入口从 `packages/` 和 `vendor/` 自动发现完整的 DSH 源码依赖闭包，并在临时 lockfile 作用域安装本地链接，不读取或改写本仓库的 `pnpm-workspace.yaml` 与 `pnpm-lock.yaml`。普通 `pnpm` 命令可能按锁文件恢复注册表依赖；`pnpm run check:dsh-alpha-source` 会重新链接源码并连续完成构建、类型检查和 Session 能力检查。`node scripts/dsh-alpha-dev.mjs preview --dsh-root ../dsh-alpha5-host --port 3182 --no-open` 会继续完整构建 Agent RP 的 Host、Client、扩展声明和修复命令，在 `.runtime/dsh-alpha-home` 创建隔离 profile 并以前台进程启动预览。也可用 `DSH_ALPHA_ROOT` 和 `DSH_ALPHA_HOME` 指定这两个目录。

早期安装器写入的版本不会自动迁移。若启动错误中出现 `.dsh\plugins\dsh-agent-rp`，请先把该目录移出 `plugins` 目录作备份，确认 DSH 能启动后，再按上面的 profile 命令安装。不要删除整个 `.dsh`，会话数据与旧插件目录不是一回事。

不要把未验收的 DSH 版本强行套用到当前 Host 补丁，也不要在 Issue 或日志里公开自己的 NPM Token。

### Android / Termux 预览

Termux 路线面向 ARM64、Android 11 及以上设备，目标是在手机本机运行、不让电脑保持开机。旧预览已经验证过安卓原生依赖、图片解码后备模块和本地启动，但当前安装入口正在迁移。

手机安装器仍固定在旧的 DSH `0.1.0-rc.6`，尚未迁移到当前 Agent Host runner，因此不适用于当前 `main` 的完整 Agent/MVU 回合。现有安装不要为了追随桌面版本而手工覆盖 DSH 包；新的 Termux 安装与更新暂缓，等安卓原生模块和 patched runner 一起完成实机验收后再恢复下面的正式命令。

旧安装仍可运行原来已经落盘的版本，但不要重新执行旧安装器更新到当前 `main`。

若启动或导入角色卡时遇到问题，运行 `dsh-agent-rp-doctor` 即可得到一份可直接贴到 Issue 的脱敏体检结果。它只检查版本、模块和 Android 文件系统能力，不读取令牌、角色卡或会话内容。

运行旧安装后仍可在同一部手机的浏览器打开 `http://127.0.0.1:3080`。角色卡和会话位于 `~/.dsh`；不要删除这个目录。当前路线不把老设备上的 bash 沙箱或编码 Agent 计入手机预览范围。

需要长时间把页面留在后台时，可以先在 Termux 运行 `termux-wake-lock`，结束后运行 `termux-wake-unlock`，避免系统过早挂起本地服务；这不会绕过 Android 的电池优化设置。

页面正常打开后，可以在 Chrome 或 Edge 的菜单中选择“添加到主屏幕”或“安装应用”。DSH 已提供全屏 Web App 清单，图标启动后仍会连接 Termux 中的本地服务；重启手机后需要先重新运行 `dsh-agent-rp --port 3080`。

## 第一次开聊

1. 在 DSH 中新建空白会话。
2. 打开 Agent RP，在「开始」分区选择「角色或世界书」。
3. 选择「角色对话」或「世界场景」。
4. 组合角色或场景、Persona、世界、提示策略与独立正则包；角色模式还可以选择开场白。
5. 启动前检查已知权限，然后进入游玩。会话中仍可打开资源库、设置与调试视图。

导入后的角色、Persona、世界、预设和独立正则包会分别进入资源库。角色卡内置世界书会同时拆成独立 World 资源，并保存角色到主世界的默认绑定；新会话从绑定 World 的独立快照完成世界召回与 MVU 状态处理，导出当前版本时再组装为 SillyTavern `character_book`。相同内容只保留一份 World，原始 PNG、JSON 或 CHARX 不会被改写。角色卡可以先移入收纳箱；只有没有历史会话引用时才能二次确认永久删除。预设可以在资源中心改名或移除；移除只删除可复用副本，不影响已经开始的会话。独立正则包从资源中心导入，在“角色或世界书”中按选择顺序组合；全局正则包先于预设和角色卡正则执行，内容会冻结到新会话，之后移除资源库副本不会改写已有会话。开始游玩后，“会话设置 → 世界书”可以直接添加资源中心已有世界书，或从文件导入新资源；两种方式都把当前内容冻结到本会话并排除重复资源。“会话设置 → 预设”可以调整提示模块与预设正则的开关；修改只属于当前会话。迁移 SillyTavern JSONL 聊天时可以直接选择资源中心已有角色卡，也可以从文件导入角色卡。

无需预先选择某个 Agent 预设；从空白的标准会话选择角色时，插件会自动进入角色会话。已经有聊天内容的普通会话不会被修改。

要迁移旧聊天，请从 Agent RP 工作台打开“迁移聊天”，选择 SillyTavern JSONL，再选用资源中心已有角色卡或导入一份新的 PNG、JSON、CHARX 角色卡。导入会创建新的角色对话，不会修改源文件或来源会话。

## 目前的范围

这个里程碑优先完成可靠的角色与世界场景闭环，而不是按功能数量追赶另一套前端。Agent 模式已经提供固定顺序的故事工程写作流水线、角色 Agent、正文审阅 Worker 与状态结算 Worker；正文审阅默认关闭，可以在 Agent RP 全局设置的「多 Agent 回合」中启用，并在启用时每轮增加一次轻量模型请求。存在结构化状态计划的回合固定增加候选与核验两次轻量请求；核验默认跟随会话模型，也可以显式选择另一个已配置模型来缩短后台等待。Worker 不会自行生成无边界任务图。故事工程已经支持多人物分别依据私有认知参与同一篇正文，但传统群聊界面、多个并列顶层角色 Agent 和重前端/独立前端还没有完成。

需要脚本或远程 HTML 的内容会在启动前检查已知的脚本、样式、字体、图片、媒体、嵌入页与数据连接，并把许可限制在对应角色、预设、脚本和来源；动态出现的新能力仍会在实际触发时确认。可执行 HTML、Tavern Helper、EJS 与世界书正则运行在不同的受限环境中，不会获得 DSH Host 的文件、进程、凭据或页面 DOM。兼容层仍在依据真实内容补全，但新增能力会优先沉淀为可复用接口，不按单张卡片堆特例。

需要 OAuth 或其他回执的外部登录不会给角色卡 iframe 增加弹窗、同源或顶层导航权限。轻前端或 Tavern Helper 脚本发起绝对 HTTPS 窗口请求后，DSH 会展示目标站点；玩家确认后通过独立中转窗口打开登录页，只把有界的登录回执送回发起请求的隔离运行时。中转界面会区分“回执通过安全检查”和“请求运行时已确认接收”，成功后只提供关闭操作，不会继续诱导重复登录。要求 Discord 身份、论坛会员或角色组资格的服务必须继续使用原有第三方 OAuth 与服务端授权判断；DSH 不会以本机身份替代、增加第二登录方式或自动回退。

不依赖既有第三方账号资格的开放服务可以选择接入 DSH 本机身份。玩家在 Agent RP 设置中创建身份后，已接入的轻前端、Tavern Helper 脚本或它们嵌入的 HTTPS 页面可请求一份五分钟有效、绑定目标来源、服务 nonce 和当前卡片或脚本身份的 ES256 证明；显示名称需要单独授权，私钥始终由 Host 保管。这项能力不是 Discord 或其他第三方 OAuth 的替代凭据。协议与接入限制见 [安全扩展能力协议](docs/extension-capabilities.md#host-原生身份)。

更具体的格式支持与降级方式见 [SillyTavern 兼容说明](docs/sillytavern-compatibility.md)。

遇到脚本加载、世界书 EJS、行动选项、工作区归属或「RP 互通」问题时，先按 [使用与故障排查](docs/troubleshooting.md) 取得对应失败详情。全局 Debug 默认关闭；开启后，用户主动点击「复制诊断」会在聚合报告中附加当前会话的 Tavern 脚本与世界书错误详情，世界书「复制失败详情」还会附加有长度上限的 EJS 错误名称、消息和调用栈。EJS 模板可以把运行时值写入错误消息；用户分享 Debug 报告前必须检查报告内容。

需要比较大型卡片改动时，可运行不含社区卡片内容的 [合成兼容基准与本地真实卡、预设验收流程](docs/compatibility-benchmark.md)。EJS 的可执行与保留范围见 [EJS 兼容表](docs/ejs-compatibility.md)；后续世界书与插件生态遵循 [安全扩展能力协议](docs/extension-capabilities.md)。独立 DSH 插件可从 [社区插件接入](docs/community-plugin-development.md) 选择 Host 生命周期接口或 Agent RP 工作台 Slot；安装型第三方扩展另按 [SillyTavern 扩展宿主](docs/st-extension-host.md) 的单例生命周期设计。npm `next` 提供经过发布门禁与 provenance 证明的预发布包；源码分支仍只用于贡献和定向验收。

## 反馈与贡献

如果一张卡片的纯文本部分、世界书、预设或轻前端在 DSH 中表现不对，欢迎提交 Issue。请说明卡片格式、预期表现、实际表现与最小复现步骤；不要上传无权公开的角色卡、私有社区内容、Token 或完整 Session Log。

代码、兼容样本、交互设计和文档改进都欢迎。开始前请阅读 [贡献指南](CONTRIBUTING.md)。

本项目采用 [MIT License](LICENSE)。
