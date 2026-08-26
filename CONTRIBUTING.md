# 参与 Agent RP 开发

Agent RP 仍在高速迭代。贡献的目标不是复制内部实现，而是让功能可以独立演进、可靠卸载，并在 Session Log 重放后得到相同结果。提交前请先选择下面最合适的一条路径。

## 1. 普通 DSH 工具插件

生图、检索、计算、外部服务等通用能力，优先做成独立 DSH bundle：

- 使用 DSH 的工具注册机制，不依赖 Agent RP 源码或私有对象。
- 图片等媒体结果使用标准 `dsh.tool-artifacts` 元数据。
- Agent RP 只负责把工具结果呈现在角色对话中；工具仍可被其他 Agent 使用。

## 2. Agent RP 扩展插件

需要参与回合准备、世界召回、状态绑定或角色资源管理时，使用版本化入口：

```ts
import type { Context } from '@deepseek-ai/cordis'
import { registerRoleplayRuntimeExtension } from '@hewzhew/dsh-agent-rp/extension/v0'
export const inject = ['agentRp.runtimeExtensions']
export function apply(ctx: Context): void {
  registerRoleplayRuntimeExtension(ctx, {
    module: { id: 'example.module', source: 'native', phases: ['prepare'] },
    resolve: ({ events }) => events.length === 0 ? undefined : ({
      outcomes: {
        prepare: { outcome: 'idle', contributions: 0 },
      },
    }),
  })
}
```

`resolve` 必须同步执行，并且只能从传入的 Session events 推导结果。注册辅助函数已经通过 `ctx.effect()` 负责卸载；其他注册也必须由调用方自己的 Cordis scope 管理。

插件包只需声明普通 DSH bundle 入口：

```json
{
  "type": "module",
  "main": "./lib/index.js",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

对应的 `cordis.patch.yml` 插入插件本身；需要 Agent RP 服务时，由上面的 `inject` 等待服务就绪：

```yml
- insert:
    - id: example-agent-rp-extension
      name: '@example/dsh-agent-rp-extension'
```

`extension/v0` 在 v0 生命周期内保持兼容。若公共契约必须破坏性调整，Agent RP 会新增版本入口，而不是悄悄改变已有导出。

## 3. 核心兼容修复

只有确实属于 Agent RP 内核或输入适配器的问题，才修改本仓库源码：

- PR 保持小而聚焦，说明用户实际遇到的行为及期望结果。
- 提供可公开的最小样本，或足够明确、可复现的行为描述；不要上传巨大的私有资产。
- 至少覆盖一个跨层真实场景。仅在需要锁定非显然契约时增加聚焦测试。
- 不增加第二套回合循环、状态结算、宏引擎或工具呈现协议。

## 稳定与重放边界

- 已发布的模块、资源、状态、工具和事件 ID 不得随意改名。
- 所有模型可见状态和关键决策必须能够由 Session Log 重建。
- 不要让 `Date.now()`、`Math.random()` 或未记录的外部状态直接改变模型可见内容。
- 来源格式只是输入适配器；不要让 SillyTavern 等来源结构反向定义运行时边界。
- 不要读取未导出的内部文件；需要的新能力请先提出公共接口需求。

## 提交约定

- 从最新 `main` 开始，尽量让一次 PR 只解决一个问题。
- 通常不要提交 `lib/`、临时目录或本地测试产物；维护者合并时统一构建。
- 使用 `pnpm test` 直接从 TypeScript 源码运行完整测试，或使用 `pnpm run test:focused` 和其他 `test:*` 分组运行覆盖改动行为的聚焦检查；测试不预先打包，类型和发布产物分别由 `pnpm run typecheck` 与 `pnpm run build` 验证。
- 本地测试产物积累后运行 `pnpm clean:generated`；先查看目标可运行 `pnpm clean:generated -- --dry-run`。默认命令保留 `.tmp` 参考资料、依赖和构建产物；确认其中全部可以重建时，先运行 `pnpm clean:generated -- --dry-run --scratch` 检查精确根目录目标，再用 `pnpm clean:generated -- --scratch` 一并删除 `.tmp` 与 `.tmp-*`。
- 在 PR 中写清复现方式、改动边界和手动验收结果；无需补双语文档或文档站页面。
- 不要提交 API Key、Token、完整 Session Log 或无权再分发的社区资产。

如果不确定走哪条路径，先用 Issue 描述用户场景和希望稳定下来的接口，不必先复制内部代码。提交代码即表示你有权贡献相关内容，并同意其按本项目的 [MIT License](LICENSE) 发布。
