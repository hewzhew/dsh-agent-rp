# 独立社区插件接入

Agent RP 为受信 DSH 插件分别发布 Host 与浏览器扩展面。扩展插件保留自己的存储、HTTP 接口和界面状态；Agent RP 只提供组合位置与回合生命周期，不把角色库对象、会话内部回调、Host DOM 或隔离脚本权限交给插件。

## Host 与浏览器不是共享 Context

一个声明 `dsh.client` 的包包含 Host 与浏览器两张独立的插件面。Host 的 `apply(ctx)` 在 DSH 进程中运行，`./client` 的 `apply(ctx: ClientContext)` 由页面中的客户端模块系统加载；两者各有自己的 Cordis Context 和服务表。Host 调用 `ctx.provide('example', value)` 不会让浏览器中的 `ctx.get('example')` 取得同一个对象，即使服务键、profile 和包都相同。

只影响界面的注册表、Slot 贡献和运行时垫片应由插件的 `./client` 面注册，并在 `dsh.client.inject` 中声明所需浏览器服务。需要把 Host 数据送到浏览器时，应使用 DSH 客户端服务、Typert RPC、受控 HTTP 接口或可投影的 Session 事件；不能用同名服务键、共享模块变量或“单进程 web profile”代替传输协议。

跨面接口需要分别验证 Host 与浏览器装配：Host 单元测试只能证明服务存在于 Host Context，浏览器测试还必须证明独立 ClientContext 能加载消费插件并完成真实注册。缺失浏览器服务时应在插件激活阶段明确失败，不能把 `ctx.get()` 的 `undefined` 当作“本轮没有贡献”静默跳过。

已安装的 SillyTavern 第三方扩展与角色卡或预设携带的 Tavern Helper 脚本具有不同生命周期。前者的单例宿主、设置身份和验收条件见 [SillyTavern 扩展宿主](st-extension-host.md)；不能把同一扩展 bundle 拼入每个逐脚本 iframe。

## 浏览器工作台扩展

`@hewzhew/dsh-agent-rp/client-extension/v0` 声明 `agent-rp.workbench.section` 列表 Slot。它位于侧栏的 Agent RP 工作台，现代 `sidebar.destinations` 与旧版 `sidebar.footer.action` 入口共用同一个声明。外部插件必须通过 `ctx.slots.inject()` 等待 Agent RP 声明 Slot，不能依赖客户端 bundle 的下载或执行顺序。

```ts
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  AGENT_RP_WORKBENCH_SECTION_SLOT,
  type AgentRpWorkbenchSectionProps,
} from '@hewzhew/dsh-agent-rp/client-extension/v0'

export const inject = ['slots']

function WorldbookSection(props: AgentRpWorkbenchSectionProps) {
  // 打开插件自己的完整界面后可以关闭 Agent RP 工作台。
  void props.closeWorkbench
  return null
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject(AGENT_RP_WORKBENCH_SECTION_SLOT, () => ctx.slots.register({
    name: AGENT_RP_WORKBENCH_SECTION_SLOT,
    id: 'community-worldbook',
    order: 10,
    label: '世界书',
  }, WorldbookSection))
}
```

条目组件只收到 `closeWorkbench()` 与 DSH Slot 的 root 标准属性。需要当前会话、远程调用或设置存储时，插件应声明并使用对应 DSH 客户端服务；Agent RP 不复制这些服务，也不为扩展暴露私有 React 状态。

浏览器协议文件很小，可以由扩展的构建器打入自己的 client bundle。`dsh.client.inject` 只是客户端模块图的依赖说明，不负责激活顺序；Slot 声明等待由上面的 `ctx.slots.inject()` 完成。

## 可执行世界原生视图

Host 通过 `registerPlayWorldModule()` 注册规则模块后，同一插件的浏览器面可以用模块 id 作为 key 注册 `agent-rp.play-world.view`。Agent RP 保留世界标题、人物来源、原著准备、会话推进与重新开局的共用外壳；插件只替换模块专属的状态与操作区。没有对应 key 时自动使用通用行动列表和世界事件视图。

```ts
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  AGENT_RP_PLAY_WORLD_VIEW_SLOT,
  type AgentRpPlayWorldViewProps,
} from '@hewzhew/dsh-agent-rp/client-extension/v0'

export const inject = ['slots']

function WorldView(props: AgentRpPlayWorldViewProps) {
  const action = props.turn?.actions[0]
  return action === undefined ? null : <button
    disabled={props.busy || props.dirty}
    onClick={() => { props.dispatchAction(action.id) }}
  >{action.label}</button>
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject(AGENT_RP_PLAY_WORLD_VIEW_SLOT, () => ctx.slots.register({
    name: AGENT_RP_PLAY_WORLD_VIEW_SLOT,
    key: 'community.worldbook',
  }, WorldView))
}
```

视图只收到该世界的浏览器安全快照、参与人物的 id 与名称、Host 投影的当前合法行动及动作提交函数。它不读取故事图、人物档案、私有认知或 Agent RP 内部 React 状态；动作 id 仍由 Host 对当前 cycle 重新验证，客户端视图不能携带或执行模块私有 payload。

## 安装型 ST 扩展实验接口

功能分支中的 `agentRpStExtensions` 客户端服务接收独立插件已经打包完成的 ESM 与可选 CSS。注册发生在插件的浏览器 `apply()` 中；把服务键加入 `inject` 后，Cordis 会等待 Agent RP 提供浏览器注册表，调用方的 effect 则负责在插件卸载时撤销扩展。

```ts
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  AGENT_RP_ST_EXTENSION_SERVICE,
} from '@hewzhew/dsh-agent-rp/client-extension/v0'

export const inject = [AGENT_RP_ST_EXTENSION_SERVICE]

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.agentRpStExtensions.register({
    id: 'community.worldbook',
    displayName: '社区世界书',
    loadingOrder: 10,
    generateInterceptor: 'communityWorldbookInterceptor',
    source: bundledExtensionSource,
    style: bundledExtensionStyle,
  }))
}
```

`source` 必须是自包含的浏览器 ESM，不能保留文件系统相对导入。注册表会限制数量和字节数，将同步注册合并为一次有序重建，并在一个 ClientContext 中只创建一个共享 document；角色卡或预设拥有多少 Tavern Helper 脚本都不会复制安装型扩展。

`generateInterceptor` 是可选的 ST manifest 全局函数名；声明后，Agent RP 会在 `GENERATION_STARTED` 之后等待它，再把 `setExtensionPrompt()` 结果写入当前 Session。只有上游源码的生成事件监听与该 interceptor 明确重复时，才同时设置 `generationStartedEvent: 'interceptor-only'`。

这仍是宿主装配接口，不是“任意 ST 插件已经兼容”的承诺。当前 Session 绑定、独立设置持久化、页面快照、追加消息事件和生成前提示写入已有源码回归；固定版本的 Woven Imprint 也已完成真实 sidecar、Session 状态和最终 provider messages 的贯通验收。完整 ST 页面 API 与其他公开扩展仍需逐项验证，社区插件不能假定 SillyTavern 全局对象已经齐全；验收范围见 [SillyTavern 扩展宿主](st-extension-host.md)。

## Host 扩展

`@hewzhew/dsh-agent-rp/extension/v0` 提供资源、运行时模块、回合 Worker、角色修订与 Tavern 预检注册。Host 插件应把使用的 Agent RP 服务键加入 Cordis `inject`，再在 `apply()` 中调用对应注册函数；注册函数使用调用方的 effect 生命周期，插件卸载时会撤销贡献。

回合 Worker 仍需把模型可见请求和结果写入 Session。运行时解析器只能从不可变 Session 事件生成绑定；浏览器工作台 Slot 不能替代 Host 事件、权限或重放记录。

## 当前分发边界

Agent RP prerelease 已发布这两个版本化导出。当前源码迁移固定 DSH `0.1.2-alpha.5`；该版本恢复了 `ignorable` 事件的存储、读取和传输，但仍没有向仓库外插件公开安全写入方法。源码协作需克隆同一 tag、应用仓库内的最小 Host 补丁、建立本地源码链接，并运行 `pnpm run check:dsh-alpha-source` 验证 `appendIgnorable()` 的写入和重放能力。普通安装链只有在对应 patched Host 完成独立安装验收后才能更新。

仓库内的 `host-patches/dsh-alpha-ignorable-session-events.json` 固定官方基线、下游补丁摘要和预期源码树；同目录 patch 是可重放的完整提交。`node scripts/manage-dsh-alpha-host-patch.mjs --apply --dsh-root <DSH 源码目录>` 只接受干净且精确位于该官方 tag 的工作树，应用后与 `pnpm run check:dsh-alpha-source` 使用同一份机器校验。更新 DSH alpha 基线时必须重新生成 patch、摘要和预期源码树，不能只改 workspace 链接。

每次构建都会用一份仓库外观的消费夹具从发布后的 `client-extension/v0` 注册条目；`pnpm run check:published-imports` 同时验证运行时导出、依赖声明和这份独立 TypeScript 消费路径。
