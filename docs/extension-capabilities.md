# 安全扩展能力协议

Agent RP 的扩展兼容以显式能力为单位，不以社区脚本中的函数名或全局变量为安全边界。角色卡、预设和扩展包可以声明依赖；Host 负责解析声明、展示一次性的能力计划、创建隔离运行时，并验证每一次跨运行时请求。未声明、版本不匹配或未经许可的能力保持关闭。

这个协议用于承载世界书引擎、状态引擎和隔离界面等可组合扩展。它不提供任意 Host 插件执行，不把浏览器页面、文件、进程、凭据或不受限网络暴露给卡片。轻前端继续使用仅含 `allow-scripts` 的 opaque-origin `srcdoc`；Tavern Helper 的执行文档改用 opaque-origin `data:` 导航，并以 `allow-scripts allow-same-origin allow-forms` 运行。后者的 `allow-same-origin` 不会使执行文档获得 DSH 来源、Host DOM 或浏览器存储，只使玩家按来源批准的 HTTPS 子 iframe 保留自己的来源、存储与表单能力。

## 清单与 Host 目录

扩展清单只描述固定标识和版本，不包含可执行源码、提示词或私密 URL：

```ts
interface AgentRpExtensionManifestV0 {
  readonly format: 0
  readonly runtime: 'card-frame-v0' | 'tavern-script-frame-v0' | 'world-engine-v0'
  readonly requirements: readonly {
    readonly capability: AgentRpCapabilityId
    readonly version: 0
    readonly optional: boolean
  }[]
}
```

`AgentRpCapabilityId` 是 Host 发布的闭合联合。目录只登记已经完成请求验证和运行时接线的行为；当前包含轻前端开场切换、Session 变量替换、Session 聊天改写、Session 世界书写入与绑定、脚本提示替换、无模型调用的提示词快照、经来源许可的外部模型目录读取、经调用策略许可的辅助模型生成、隔离弹窗、玩家确认的外部 HTTPS 窗口、Host 原生身份证明、按安装身份保存的脚本存储与扩展设置，以及原生世界书只读快照。每项能力同时声明状态所有者、审批规则、审批持久期、状态持久期、模型可见性，以及每种运行时的序列化请求与结果上限；同进程纯计算调用以 `null` 明确表示没有序列化信封。新增标识还必须定义请求字段、返回字段、次数限制和稳定失败类别。

轻前端与 Tavern Helper 脚本属于不同运行时，因为它们的输入面和限额不同。两者都可以替换 `global`、`preset`、`character`、`chat`、`message` 五个 Session 命名空间；只有已注册的 Tavern 脚本能替换绑定到自身脚本标识的 `script` 命名空间。Host 以脚本树作用域和原始脚本标识的组合管理 iframe、变量、提示注入、按钮、错误与调用队列；脚本内的 `getScriptId()` 仍返回原始标识，因此不同作用域的同名脚本不会覆盖彼此，也不改变 Tavern Helper API。轻前端请求上限为 1 MiB，Tavern 脚本请求上限为 2 MiB，Host 不会为了统一元数据而放宽或收窄其中一条路径。确认、输入、文本和展示弹窗通过 `ui.popup.open` 发出类型化请求；Host 重新校验请求标识、类型、正文、输入值、按钮与总字节，最多排队 20 项，并只把有界的用户选择返回原脚本。`storage.script.persist` 只接受有界 JSON 值；其物理 IndexedDB 主键由角色卡、预设、脚本树作用域、原始脚本标识、逻辑命名空间和键共同组成，脚本不能伪造前四项来读取另一个安装实例。`settings.extension.persist` 保存完整的 `extension_settings` 对象，并由 Host 将角色卡、预设和脚本树作用域绑定为不可伪造的物理身份；同一树中的协作脚本可同步设置，不同卡、预设或树不能互相读取。

Tavern 的世界书操作与聊天操作使用不同的 Host action。即使一项请求本身能被 Tavern 解析器接受，也不能借 `worldbook-mutate` action 改写聊天或变量；提示替换同样由 Host 覆盖为当前注册脚本的标识。聊天改写形成原生 Session surface 事件，世界书覆盖、绑定和提示内容写入 Session 快照，原始角色卡与预设保持不变。提示词快照只读取同一次 Host 组装的 system 与 messages，不联系模型，也不改变聊天。

Host 把每项需求解析为 `available`、`approval-required`、`unsupported`、`version-mismatch` 或 `denied`。必需项未满足时对应扩展不启动；可选项未满足时运行时获得明确的不可用结果。`player-action`、`per-request` 和 `call-policy` 能力可以启动，但分别在调用点检查用户手势、单次许可或持久的角色/预设/脚本/来源许可；只有缺少启动策略许可的需求进入 `approval-required`。能力目录不根据源码中出现的 API 名称自动扩权，也不因为另一个脚本已获许可而继承权限。

`approvalPersistence` 只描述许可决定保存多久：`none` 不保存，`session` 只属于当前会话，`character-policy` 按角色、脚本、能力和规范化来源保存。`statePersistence` 则区分只存在于运行时的 `ephemeral`、可由 Session 重放的 `session` 和由 Host 按安装身份保存的 `host-persistent`。三者不能从许可策略推导：外部模型目录读取可以复用来源许可但不保存目录结果；辅助模型生成可以复用调用许可，并把实际请求与结算写入 Session；隔离脚本存储无需权限弹窗，但不能进入其他脚本的物理命名空间。

轻前端与 Tavern Helper 运行时共享同一项外部窗口能力：它只接受无用户名和密码的绝对 HTTPS URL，每次调用都重新展示目标站点。Host 在 DSH 页面内挂载一张无网络权限且为 opaque origin 的静态 relay iframe；它与角色卡、Tavern 执行文档和获准的远端子 iframe 相互独立。relay 只获得 `allow-popups` 与 `allow-popups-to-escape-sandbox`，使玩家在其中点击真实链接时只创建一个可正常登录的外部窗口；该窗口的 opener 是 relay 而不是 DSH。relay 只把通过来源、JSON 与字节上限校验的首个回执送回 Host。Host 按脚本树身份或已注册轻前端令牌重新解析当前 iframe，不把请求发起时的一次性 `Window` 引用当作回调地址；在有界确认期内重复投递同一请求标识，运行时按该标识只派发一次业务事件并对每次投递返回确认，因此等待期间或首次投递后的安全重载都能由替换后的同一运行时实例接续。Host 分别记录回执通过校验、请求运行时已派发回执和运行时未及时确认三个阶段；关闭中继不会覆盖已经得到的终态诊断。只有运行时确认后，界面才会说明角色卡已经收到结果。阶段诊断不包含 URL、账号或回执正文，角色卡专属的登录消息转换仍由发起请求的兼容脚本完成。

## Host 原生身份

`identity.native.attest` 为愿意接入 DSH 的服务提供无弹窗身份路径。玩家先在 Agent RP 设置中创建本机身份；Host 生成 P-256 密钥，将私钥交给 DSH 凭据服务，并把非秘密资料保存在 DSH 数据目录。角色卡与 Tavern Helper iframe 可以调用 `window.dshIdentity.request()`；它们嵌入的 HTTPS 页面则通过下述 MessagePort 协议请求同一能力。两条路径都不能读取私钥、凭据服务或资料文件。

请求必须包含不带路径、查询、用户名或密码的完整 HTTPS `audience`、由目标服务签发的 16 至 256 字符 URL-safe `nonce`，以及是否需要显示名称的布尔值。Host 从当前角色卡或脚本安装身份生成不可伪造的应用标识；运行时不能在请求中指定它。许可精确绑定应用、受众与显示名称声明，普通刷新和会话切换后仍有效；显示名称未获单独许可时不会进入证明。

Host 返回五分钟有效的 ES256 JWS。载荷包含 `iss`、`sub`、`aud`、`iat`、`exp`、`nonce` 和散列后的应用标识，获准时另含 `name`；JWS 头与结果对象包含验证所需的 P-256 公钥和 `kid`。目标服务必须校验签名、算法、有效期、精确受众、原始 nonce 与适用的应用标识，并自行决定首次公钥登记或信任策略。该证明只表示同一套 DSH 本机密钥，不证明 Discord、论坛或其他第三方账号；需要第三方账号关系时，服务可在自己的账户设置中把已验证的 DSH 公钥作为可选绑定。

嵌入页面向 `parent` 发送 `channel: "dsh-agent-rp:identity"`、`action: "request"`、`format: 0`、有界 `requestId`、精确 `audience`、`nonce` 和 `includeDisplayName`，并随消息转移唯一的 `MessagePort`。隔离运行时只接受直接子 iframe 的请求，将其 `src` 解析为完整 HTTPS 来源，要求该来源与 `audience` 完全相同，并最多同时处理 16 个请求。结果只通过该 MessagePort 返回 `action: "result"`；无论成功或失败都随后关闭端口，且失败只暴露 `busy` 或 `identity-unavailable` 稳定类别。这个中继不扩大 iframe 的 sandbox，不赋予嵌入页面 Host DOM 或任意网络能力。

```js
function requestDshIdentity(audience, nonce, includeDisplayName = false) {
  const requestId = crypto.randomUUID()
  const channel = new MessageChannel()
  const result = new Promise((resolve, reject) => {
    channel.port1.onmessage = event => {
      const message = event.data
      if (message?.channel !== 'dsh-agent-rp:identity' || message.action !== 'result'
        || message.format !== 0 || message.requestId !== requestId) return
      message.ok ? resolve(message.value) : reject(new Error(message.error))
    }
  })
  parent.postMessage({
    channel: 'dsh-agent-rp:identity', action: 'request', format: 0, requestId,
    audience, nonce, includeDisplayName,
  }, '*', [channel.port2])
  return result
}
```

线上面板被现有角色卡通过 URL 嵌入时，面板可独立改用这个中继，不需更改或重发角色卡脚本。嵌入服务的完整交换流程为：服务端签发一次性 nonce；页面通过 MessagePort 获得 DSH 证明；页面将证明送到目标服务的 exchange 端点；服务校验 ES256、`aud`、nonce、`iat`、`exp`、`kid`、`sub` 和应用标识后，签发自己的短期会话。发布、修改与删除必须使用该会话的服务端身份，不得信任请求 JSON 中自报的 Discord ID、用户名或 owner 字段。

DSH 不会伪造第三方 access token，也不会把本机证明当作 Discord、论坛会员、角色组或其他第三方资格。要求 Discord 的服务必须继续使用自己的 Discord OAuth 与服务端授权判断；DSH 原生身份不能作为替代登录、第二凭据或自动回退。只有服务所有者明确面向开放生态接入时，原生身份交换协议才是一项独立可选能力。

## 状态所有权

导入的角色卡、预设和世界书原文保持不可变。玩家编辑、脚本变量、世界书覆盖与绑定、提示注入和脚本树都属于当前 Session，并通过现有命令结果或专用 Session 事件保存完整快照。运行时内的 DOM、定时器、闭包和临时缓存不属于持久状态，刷新后可以从 Session 快照重建。Tavern Helper 的 localforage 兼容层和扩展设置属于独立的 Host 持久状态；两者使用各自的新 IndexedDB 数据库，避免升级旧页面仍持有的数据库连接。每个旧版未分区逻辑命名空间和旧版浏览器全局扩展设置都只能由第一个实际访问的安装身份认领并复制一次，其他身份得到空存储。Host 不会删除旧数据、覆盖已有分区值或在清空后再次复制。

会话种子可以直接携带 DSH 事件信封支持的 `ignorable: true` 标记；运行中的插件私有事件则只在 Host 明确提供安全写入能力时追加，不能根据 DSH 版本号推断。`command/run` 与 `command/done` 只保存由玩家界面发起的命令生命周期，自动回合计划、后台模型收据和状态结算不能伪装成玩家命令。插件侧独立文件或数据库也不能替代这些事件：它无法与 Session 事件原子提交，并且不会自动进入原生分支与会话导出。

扩展不能直接持有可变 Host 对象。每次写请求都包含扩展实例、能力标识、请求编号和完整 JSON 载荷；Host 校验注册来源、能力许可、修订版本、字段、数量和总字节后才写入 Session。并发写入使用显式修订冲突，不做静默的最后写入者获胜。

任何进入模型请求的扩展结果必须能够从 Session 日志重建。动态提示贡献记录最终角色、位置、深度、顺序、生命周期和完整文本；世界书引擎记录最终激活项与注入文本，而不是只记录可变的插件版本或执行成功标志。诊断和审计报告只记录数量与稳定失败类别，不复制这些私密内容。

辅助模型生成在发出请求前记录完整的最终模型请求，并先将 Session 日志持久化；Host 模型请求随后携带当前 Session 标识。外部 OpenAI-compatible 请求只记录规范化的 origin、pathname 和最终 JSON body，API key、自定义认证头、URL 查询与远程错误正文不进入日志。结算事件记录完整成功文本或稳定失败类别，并引用请求事件的序号；回放拒绝不存在的请求、错误序号和重复结算。模型最终文本限 256 Ki 字符，运行时请求、远程响应和提示词预览结果继续受能力目录中的字节上限约束。

## 世界书引擎

`world-engine-v0` 是纯计算运行时。它接收一次检查所需的只读快照：有界的最近消息、Session 变量、来源与条目标识、匹配字段、预算和确定性的轮次信息。它不接收 Session 对象、Host 回调、当前时间、随机数、文件、网络、模块加载器或浏览器对象。

引擎只返回候选激活、稳定原因码和可选的模型提示贡献。Host 重新校验来源与条目标识、输出数量、文本总量、位置、预算和生命周期，然后把最终结果写入本轮可重放的执行记录。超时、内存不足、非法输出或单条失败只隔离对应引擎或条目；原生世界书匹配器仍可独立运行。

第一版扩展点只允许受限 QuickJS 中的同步纯函数或完全在该运行时内结算的 Promise。代码和依赖在运行前固定摘要；运行时没有动态导入和外部 I/O。装饰器、递归激活或新的匹配语义必须成为显式输出字段，不能通过修改共享全局变量暗中影响后续条目。

## 权限与启动流程

能力计划在角色库或开聊表单中完成解析，必需权限在创建会话前集中展示。许可按角色卡或扩展摘要、能力标识、资源类别和规范化来源保存；同一许可在普通刷新和会话切换后继续有效。脚本、样式、图片、字体、媒体、嵌入页和数据连接保持独立资源类别。

Tavern Helper 的固定模块地址可以直接写在静态或动态 `import` 中，也可以先赋给导入前唯一的 `const` HTTPS 字符串绑定。`let`、拼接表达式与其他运行期 specifier 不进入静态计划。

角色库会在开聊前合并两份不执行源码的静态计划。轻前端计划从已渲染开场与显示替换中分类直接声明的脚本、样式、字体、图片、媒体、嵌入页和数据连接；Tavern Helper 计划解析固定模块依赖并读取已信任依赖的文本，返回脚本数量、稳定状态，以及待许可的脚本、静态图片、静态样式表和静态 HTTPS 子 iframe 来源。两者都不创建 iframe、不运行脚本，也不读取模型。同一运行时中并发解析的多个脚本共享同一份远程依赖下载；取消其中一个脚本只结束它自己的等待，所有等待者都取消时才中断底层请求。开始按钮只在静态检查期间关闭；存在待许可资源时，同一个按钮按玩家选择将所列精确许可只交给新建 Session，或按角色卡、预设、脚本安装身份、资源类别和来源持久保存，然后立即开始对话。Session 许可保存在当前浏览器标签并按新 Session ID 隔离，不修改角色库。每份异步检查结果绑定其角色卡、预设和脚本来源许可快照，切换选择或新增持久许可后的过时回执不会进入当前界面。远程脚本、图片、样式表与子 iframe 许可不会由同名脚本、另一类资源或另一张卡继承。外部样式或脚本执行后才动态声明的二级资源无法在不提前联系来源的情况下安全发现，仍按相同类别继续确认；样式表加载后才显现的字体来源作为交互请求独立授权，许可只扩展对应脚本沙箱的 `font-src` 并重建该沙箱。受信卡片可显式启用只作用于沙箱的 HTTPS 兼容测试模式。模型生成与外部 API 调用不进入这项批量许可，仍在真实调用点单独确认。

兼容测试模式可以为当前受信角色卡预先允许 HTTPS 资源类别与隔离帧内的字符串求值，但不能开放 same-origin、Host DOM、文件、进程、凭据或任意 Host 网络。模型调用和其他产生费用或外部副作用的能力仍使用单独策略。

## 内容无关诊断

能力计划对本地验收只暴露以下聚合字段：扩展数量、需求数量、各解析状态数量、各运行阶段数量、必需能力缺失数量、审批等待数量、原生身份配置状态与许可数量、辅助生成请求/成功/失败/等待/损坏数量、失败类别和阶段耗时。固定能力标识可以出现在开发者报告中；身份主体、显示名称、公钥、受众、nonce、签名、扩展名、脚本名、正文、表达式、源码、来源 URL、请求载荷和 Session 内容不得出现。

验收夹具必须覆盖未知能力、版本不匹配、可选能力降级、必需能力阻止启动、许可持久化、来源伪造、超限请求、修订冲突、运行时超时和模型提示重放。真实私密卡只用于运行同一内容无关报告，不成为仓库夹具。

## 实现顺序

1. 用类型化目录逐项登记完成验证的 Host 能力，并从目录生成内容无关计划；未迁移行为不提前宣称可用。
2. 原生世界书检查器通过 `world-engine-v0` 的纯请求适配层供提示组装、管理投影与私密卡审计共同调用；内容无关摘要只保留数量、原因和预算。
3. 让会话容器输出能力计划聚合状态，替代逐个检查全局 API 的验收方式。
4. 仅在真实卡证明需要时加入新的纯计算语义；任意 Host 插件执行、共享可变全局和群聊式多 Agent 不属于这个协议。
