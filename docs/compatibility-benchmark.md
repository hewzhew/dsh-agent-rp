# 大型角色卡兼容基准

这个基准用于暴露大型 SillyTavern 角色卡在 Agent RP 中的共同瓶颈，不用于复刻或认证任何一张社区角色卡。它只生成原创合成数据，不包含社区卡片正文、图片、脚本、提示词或私密帖子内容。

运行：

```sh
pnpm run benchmark:compat
```

默认场景约为 6 MiB Character Card V3 JSON，包含 320 条世界书（其中非常驻条目使用隔离正则）、2000 个外部资源引用、24 条显示正则、Tavern Helper/MVU 初始变量，并连续执行 128 次隔离 EJS。输出分别记录解析、导入、冷启动列表、完整详情、无世界书正文的角色概览、首批世界书、原始资源读取、含受限正则匹配的会话投影、轻前端显示和 EJS 批处理的时间与进程堆变化。

可以调整压力规模：

```sh
pnpm run benchmark:compat -- --json-mib 7.5 --world-info 500 --asset-refs 3000 --regex 40 --ejs 200 --repeats 5
```

`--json-mib` 超过当前解码配额时，基准应明确失败，而不是静默裁剪卡片。配额调整必须与解析次数、持久化体积和浏览器投影开销一起评估；不能只放大上传上限。

`benchmark:compat` 只测量角色卡定义、资源索引和运行时编排。CHARX 内嵌媒体、远程图片网络质量、窄屏 DOM 数量与图片解码峰值使用独立场景，因为把它们混进同一个数字会掩盖真正的瓶颈。

CHARX 媒体容器使用单独的合成场景：

```sh
pnpm run benchmark:charx
```

默认生成包含 2000 张 4 KiB 惰性图片的 V3 CHARX，分别测量只读取 `card.json` 和资源目录、导入、冷启动详情、头像读取与末尾单图读取。目录扫描会校验条目数量、路径与总解压大小，但图片在被请求前保持压缩；因此详情页不会先把整包媒体解进内存。可用 `--images`、`--image-kib` 与 `--repeats` 调整规模。

这个场景仍不代表真实图片解码或 DOM 渲染。远程网络、浏览器图片解码峰值和窄屏滚动需要浏览器侧的后续基准。

## 本地真实卡验收

无法公开分发的真实卡只用于本地验收，不进入仓库、测试产物或日志。构建完成后，在独立 DSH 标签页中只重载一次，并先读取轻前端 iframe 的内容无关状态：`data-agent-rp-frame-registered="true"` 表示 Host 已登记消息来源，`data-agent-rp-runtime-phase="content-present"` 表示页面完成了至少一次可见内容检测，`data-agent-rp-resource-monitor="listener-restored"` 表示卡片替换文档后安全监听器仍在，缺少 `data-agent-rp-resource-blocked` 表示当前没有等待处理的 CSP 资源类型。

### 兼容问题分层

大型社区卡通常同时使用 EJS、提示词模板、世界书、Tavern Helper、MVU、浏览器界面和远端服务。验收把这些能力分成四层：卡片与提示语义、扩展运行时、浏览器嵌入、远端站点/API/OAuth。轻前端已经显示不代表 Tavern 脚本已经启动，脚本全部就绪也不代表远端服务可达。每层分别记录生命周期、超时和重试结果；浏览器脚本故障不得用远端网络失败解释，远端网络失败也不得触发脚本兼容补丁。

浏览器环境适合承载可移植的社区界面，但域名、部署、网络路由和上游服务延迟属于独立的可用性变量。真实卡 smoke 先验证本地 Host 与隔离运行时，再对远端站点、配置接口、数据接口和身份回调分别探测。兼容功能按 EJS、提示词模板、世界书引擎、Tavern Helper、MVU、存储、资源与外部窗口列入能力目录；不能用不断扩大的 `window` 全局模拟层代替可测试的能力接口。

浏览器验收前可先运行 `pnpm run audit:card -- <本地角色卡路径>`。命令支持 PNG、JSON 和 CHARX，只输出格式、数量、稳定失败类别、耗时、静态轻前端资源与唯一来源的分类计数、依赖体积和实际网络请求数；不会输出文件路径、角色名、正文、正则表达式、脚本名称、脚本源码或远程 URL。它会在隔离运行时中检查真实 EJS 与世界书正则，并按浏览器的并发启动方式读取内置受信来源的脚本依赖，但不执行脚本。需要额外来源许可或无法解析的脚本只增加对应计数。

社区推荐的 Chat Completion 预设可以独立运行 `pnpm run audit:preset -- <本地预设.json>`。报告只包含提示模块与挂载数量、开关数量、角色/标记/注入计数、格式覆盖、已配置生成字段名、扩展兼容状态和解析耗时；不会输出文件路径、预设名、模块名、提示词、正则表达式、脚本源码或生成设置值。无效输入只返回稳定失败类别。

### 一键浏览器 smoke

先启动本机 DSH Web，再运行：

```sh
pnpm run smoke:compat -- --card <本地角色卡> --preset <本地预设>
```

命令只接受 loopback DSH 地址，默认连接 `http://127.0.0.1:3091/`，不会重启或接管已经运行的 DSH。它幂等导入角色卡和可选预设，使用 DSH 当前选择的空白会话或角色会话，只加载页面一次，然后从 Host 运行态快照读取开聊预检、Session、世界书、Tavern Helper 和轻前端 iframe 的收敛状态；`--source-session` 可以锁定一个已有来源会话，显式的 `--workspace` 则通过正式 `workspace.create` 与 `session.create` RPC 在指定现有目录中自举隔离空白会话。后者会修改目标 Host，不能作为连接日常 DSH 时的默认行为。`data-agent-rp-*` 标记只用于操作角色库、会话设置、预设、世界书、酒馆脚本和适用的小手机入口，并校验实际 iframe sandbox。命令不填写输入框、不发送模型消息、不连续刷新页面，也不根据角色名、脚本名或界面文案定位控件。

默认使用独立的持久 Chromium 配置目录，不读取日常浏览器的账号、Cookie 或存储。首次启动声明尚未确认、预检需要本机资源许可或运行时需要身份许可时，headless 运行返回对应的人工确认阶段和退出码 2；它不会自动放行来源。隔离 Host 的调用方可以用 `--acknowledge-onboarding` 明确确认产品首次启动声明。调用方已经审阅并同意本次角色卡及预设声明的静态界面资源时，可以显式运行：

```sh
pnpm run smoke:compat -- --card <本地角色卡> --preset <本地预设> --approve-preflight --permission-duration session
```

`--approve-preflight` 只执行一次产品中的“授权并开始”操作；默认的 `--permission-duration session` 只把所列精确资源许可交给新建 Session，并保存在当前浏览器标签中，不修改角色库或持久许可。显式改为 `--permission-duration remember` 才按角色卡、预设、脚本、资源类别与来源保存许可。两种模式都不确认 Discord/OAuth 或其他身份操作，不确认模型调用或任意外部 API，也不会接受未明确授权的开聊后权限。外部样式加载后才显现的字体来源可以由 `--approve-runtime-fonts` 单独授权；运行器逐项点击产品自己的字体权限、等待受影响沙箱重建，并要求最终字体权限、阻断资源和脚本启动全部收敛。`--permission-duration` 只能和 `--approve-preflight` 一起使用。需要人工确认其他权限时可运行：

```sh
pnpm run smoke:compat -- --card <本地角色卡> --preset <本地预设> --headed --timeout-ms 300000
```

可见窗口会停在 DSH 自己的许可界面等待确认，确认状态保存在这条 smoke 专用配置中，后续运行可复用。`--profile` 可以指定另一条专用配置路径，`--browser` 可以指定本机 Chromium 可执行文件，`--url` 可以修改 loopback 端口。

输出格式为 `agent-rp-compat-smoke-v0`。退出码 0 表示本地运行时与稳定交互入口健康；2 表示必须由用户完成首次启动确认、资源许可或 OAuth；3 表示确定性的产品兼容失败；4 表示 DSH 不可达、浏览器不可用或运行器设置错误。稳定阶段会区分服务不可达、`onboarding-required`、插件缺失、导入、`source-session-failed`、预检、会话启动、iframe 登记、空内容、脚本运行、远端回执和交互入口，不用“页面白了”概括不同故障。浏览器控制台错误只保留 `resource-load`、`security-policy` 与 `runtime` 三类计数，并按 `client-load`、`preflight`、`runtime`、`interaction` 与 `teardown` 固定阶段归因，不输出消息、URL 或参数。安全策略错误进一步只保留 sandbox 禁止脚本、各类 CSP 资源指令、跨域和其他固定原因计数；错误来源只保留 Host 文档、`srcdoc`、`data`、`blob`、外部文档或未知类别。`consoleSignal` 区分完全干净、仅观察到安全策略执行以及确有资源、运行时或页面错误；确定性兼容判断仍来自 Host 运行状态、DOM 安全检查和页面异常。

报告只包含阶段、计数、固定问题码和耗时，不包含文件路径、角色或预设名称、卡片正文、脚本名称或源码、提示词、表达式、URL、错误详情、身份数据或模型响应。失败截图只写入系统临时目录，不进入报告、仓库或构建产物。

酒馆脚本容器用 `data-agent-rp-tavern-total`、`data-agent-rp-tavern-ready`、`data-agent-rp-tavern-failed` 和 `data-agent-rp-tavern-permissions` 汇总当前执行计划；`data-agent-rp-tavern-awaiting-authorization`、`data-agent-rp-tavern-generation-queued` 与 `data-agent-rp-tavern-model-list-queued` 分别记录等待许可、排队生成和排队读取模型目录的数量。每个脚本 iframe 的 `data-agent-rp-tavern-script-scope` 标出 `global`、`preset` 或 `character`，`data-agent-rp-tavern-phase` 进一步区分 `preparing`、`permission-required`、`load-error`、`booting`、`ready` 与 `runtime-error`。这些字段只暴露作用域、数量和生命周期，不读取卡片正文、脚本源码或错误详情；酒馆脚本面板另行在玩家本地列出全部前台与后台脚本的阶段，并为失败项显示有长度限制的错误。玩家可以主动复制一份有总长度上限的失败详情，其中明确包含失败脚本名、作用域、阶段与本地错误且不会自动上传。全局 Debug 关闭时，“复制诊断”不会读取这份本地列表；全局 Debug 开启时，用户主动复制的报告会把相同失败字段写入结构化 `debugErrors.tavernScripts` 区块。

角色库的开聊前资源区用 `data-agent-rp-resource-preflight` 区分 `loading`、`permission-required`、`ready` 与 `error`，并用 `data-agent-rp-resource-preflight-scripts`、`data-agent-rp-resource-preflight-card-resources`、`data-agent-rp-resource-preflight-card-permissions`、`data-agent-rp-resource-preflight-script-permissions`、`data-agent-rp-resource-preflight-script-origins`、`data-agent-rp-resource-preflight-image-origins`、`data-agent-rp-resource-preflight-style-origins`、`data-agent-rp-resource-preflight-frame-origins`、`data-agent-rp-resource-preflight-permissions` 和 `data-agent-rp-resource-preflight-failed` 输出内容无关计数。`data-agent-rp-resource-launch` 与开始按钮的 `data-agent-rp-start-readiness` 输出 `checking`、`approval-required` 或 `ready`；检查完成前不会创建会话，`approval-required` 则由同一个开始按钮一次完成精确授权和开聊。`data-agent-rp-start-action` 相应输出 `checking`、`approve-and-start` 或 `start`，`data-agent-rp-resource-permission-duration` 输出 `session` 或 `remember`。`session` 许可保存在当前浏览器标签并仅应用于新建的这段会话；`remember` 许可按角色卡、预设、脚本范围、脚本标识、资源类别与来源持久保存。静态预检覆盖轻前端直接声明的七类资源，以及选中角色卡与预设的 Tavern Helper 模块、图片、样式表和子 iframe 来源；它不执行脚本。预检和活动会话使用同一个资源权限计划，并把 `library:` 附件来源归一为角色库或预设库的稳定所有者 ID；一次确认不会因为进入会话而再次询问。每个异步结果与角色卡、预设和已批准来源的精确快照绑定，过时结果不会替换当前选择。模型生成和外部 API 调用不纳入批量许可。

会话状态根节点用 `data-agent-rp-capability-extensions`、`data-agent-rp-capability-requirements`、`data-agent-rp-capability-available`、`data-agent-rp-capability-approvals`、`data-agent-rp-capability-required-unavailable`、`data-agent-rp-capability-unsupported`、`data-agent-rp-capability-version-mismatch` 和 `data-agent-rp-capability-denied` 汇总类型化能力计划。酒馆脚本容器分别用 `data-agent-rp-tavern-permission-script`、`data-agent-rp-tavern-permission-image`、`data-agent-rp-tavern-permission-style`、`data-agent-rp-tavern-permission-font`、`data-agent-rp-tavern-permission-frame`、`data-agent-rp-tavern-permission-identity`、`data-agent-rp-tavern-permission-external-window`、`data-agent-rp-tavern-permission-generation`、`data-agent-rp-tavern-permission-custom-generation` 与 `data-agent-rp-tavern-permission-model-list` 报告十类待确认请求；模块、图片、样式表与子 iframe 属于启动资源，外部样式加载后才发现的字体、身份、外部窗口、标准生成、自定义生成与模型目录属于交互请求。`data-agent-rp-tavern-startup-permissions` 和 `data-agent-rp-tavern-interaction-permissions` 将阻止单个脚本启动的资源请求与用户操作产生的请求分开，`data-agent-rp-tavern-permission-state` 输出 `settled`、`startup-blocked` 或 `interaction-pending`。类别合计、生命周期合计或状态与总数不同都会产生 `tavern-permission-count-mismatch`，而不会留下无法解释的授权等待。`data-agent-rp-native-identity` 区分 `loading`、`unconfigured`、`ready` 与 `error`，`data-agent-rp-native-identity-approved` 和 `data-agent-rp-native-identity-pending` 只记录持久许可及待确认请求数量；酒馆脚本容器的同名 pending 字段计入同一份浏览器报告。身份主体、显示名称、公钥、受众、nonce 与签名不会进入 DOM 诊断。`data-agent-rp-inline-frontend-sanitizer` 使用固定合成标记检查浏览器净化器是否同时保留惰性自定义容器并删除脚本、事件属性和嵌入页；失败时报告加入 `inline-frontend-sanitizer-degraded`。`data-agent-rp-external-window-phase` 区分外部窗口创建、回执校验与请求运行时接收，`callback-delivery-unconfirmed` 表示 Host 已取得并校验回执，但原请求运行时没有及时确认派发；它不能被报告为登录成功。`data-agent-rp-auxiliary-generation-requests`、`data-agent-rp-auxiliary-generation-succeeded`、`data-agent-rp-auxiliary-generation-failed`、`data-agent-rp-auxiliary-generation-pending` 与 `data-agent-rp-auxiliary-generation-malformed` 汇总可审计的脚本辅助模型调用；`data-agent-rp-world-engine`、`data-agent-rp-world-engine-entries`、`data-agent-rp-world-engine-active` 与 `data-agent-rp-world-engine-budget-excluded` 则证明管理投影和提示组装使用同一个世界书引擎结果。这些字段不包含书名、条目标识、关键词、消息、提示文本、URL 或模型响应。

状态检查通过后，只操作一个不发送消息的本地界面入口，再检查该入口的关键控件和本次重载之后新增的浏览器警告或错误。`content-empty`、`runtime-error` 与 `runtime-rejection` 可以直接缩小空白页面的阶段；`content-present` 只证明界面已挂载，不能代替视觉与交互检查。轻前端 iframe 必须保持仅含 `allow-scripts`；Tavern 执行 iframe 必须使用 `data:` URL、不得使用 `srcdoc`，且 sandbox 必须精确等于 `allow-scripts allow-same-origin allow-forms`。其他令牌组合仍视为权限扩大。验收不应通过连续刷新掩盖确定性失败。

页面提供 `window.__dshAgentRpRuntimeSnapshot()`，返回 `agent-rp-runtime-v0` Host 运行态快照。预检、Session、Tavern Helper 和每个轻前端 iframe 按内部作用域发布完整状态；注册表只对外保留固定阶段、布尔值、计数、单调 revision、更新时间和来源数量，不序列化内部发布者、Session ID 或 iframe token。Tavern 快照中的 `blockedResources`、`blockedResourceOrigins` 和 `blockedResourceClasses` 分别记录 CSP 拦截的唯一资源对数量、不同来源数量与固定资源类别计数，不包含来源、路径、脚本标识或源码。组件卸载会删除自己发布的状态，当前 Session 只合并同一内部作用域的 Tavern 与 iframe 状态，避免切换会话后继承旧事实。相同状态不会增加 revision。

`window.__dshAgentRpCompatibilitySnapshot()` 把同一次 Host 快照与真实 DOM 完整性检查收敛为 `agent-rp-browser-compat-v0` 报告，并把结果同步到根节点的 `data-agent-rp-compatibility-snapshot` 属性。报告中的 `runtime` 记录 Host 快照 revision、更新时间与内容无关的来源数量；运行阶段、权限、世界书和 iframe 回执优先取自 Host 注册表，未安装新协议时才受控回退到旧 DOM 投影。交互入口是否真实存在、界面是否打开以及 iframe sandbox 始终从 DOM 检查，运行时自报不能覆盖这些安全结果。普通卡片 iframe 只接受 `allow-scripts`；Tavern iframe 只接受 opaque-origin `data:` URL 和精确的 `allow-scripts allow-same-origin allow-forms`，仍使用 `srcdoc`、来源错误或令牌不符都会报告 `iframe-sandbox-expanded`。权限等待仍作为正常状态记录。浏览器 smoke 与全局函数始终读取不含角色名、脚本名、标识、正文、表达式、错误详情、URL、请求载荷或模型响应的聚合报告。“复制诊断”使用同一聚合报告作为基础；只有全局 Debug 开启且当前会话存在失败时，复制结果才会增加 `agent-rp-debug-errors-v0` 的 `debugErrors` 区块。

报告的 `interactions` 还提供与文案无关的真实入口状态。角色库、会话设置、预设、世界书、酒馆脚本面板、小手机与脚本权限分别使用 `data-agent-rp-action` 操作入口，用 `data-agent-rp-surface` 和 `data-agent-rp-surface-state` 确认界面已经打开或关闭。浏览器 smoke 不依赖角色名、脚本名或中文按钮文案；它只按稳定标记执行一次打开和关闭，并等待对应的 `interactions` 状态改变。

世界书安全执行器还用 `data-agent-rp-world-engine-regex-runtime-unavailable`、`data-agent-rp-world-engine-regex-invalid`、`data-agent-rp-world-engine-regex-execution-limit`、`data-agent-rp-world-engine-regex-resource-limit`、`data-agent-rp-world-engine-decorator-unsupported`、`data-agent-rp-world-engine-template-unsupported` 与 `data-agent-rp-world-engine-template-error` 输出失败计数。普通关键词未命中、关闭条目、空正文和预算排除不属于执行失败；任一失败计数大于零时，统一报告加入 `world-engine-degraded`，且基础聚合报告不包含书名、条目名、关键词、正文、表达式或错误详情。玩家可以在世界书管理器主动复制本地失败详情；全局 Debug 关闭时，该报告包含书名、条目标识和稳定失败类别；全局 Debug 开启时，该报告还包含 EJS 隔离运行时返回的错误名称、消息和调用栈。“复制诊断”的结构化 `debugErrors.worldInfo` 区块使用同一份错误对象。EJS 模板可以把运行时值写入错误消息；用户分享 Debug 报告前必须检查报告内容。两种复制入口都不会自动上传报告。

`interactiveEntriesPresent` 证明当前会话具备适用的稳定入口。有 Tavern 脚本时必须存在脚本面板入口，有待确认脚本权限时必须存在权限入口；没有小手机脚本或没有待确认权限的角色卡不会因此失败。每次 smoke 不发送消息；只有显式的 `--approve-preflight` 才会一次批准并启动已列出的静态界面资源，只有显式的 `--approve-runtime-fonts` 才会逐项批准样式表加载后发现的字体来源。默认 `session` 模式不修改角色卡，`remember` 模式会写入烟雾测试专用浏览器配置中的精确持久许可。
