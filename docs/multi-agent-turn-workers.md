# 多 Agent 回合 Worker

Agent 模式将一轮拆成职责隔离、顺序固定的模型阶段。角色 Agent 继续持有角色卡、世界书、酒馆预设和工具；后续 Worker 只接收完成自身任务所需的最小输入，不重新运行角色 Agent 的完整提示。

当前顺序是：

1. 角色 Agent 完成剧情正文与必要的工具调用。
2. 可选的 `narrative-review` Worker 只审阅最终正文的表达，不重新推演剧情。它默认关闭，在「Agent RP 全局设置 → 多 Agent 回合」中启用。
3. `state-settlement` Worker 在存在结构化状态计划时读取最终可见正文。候选阶段先计算状态操作，独立核验阶段再从原始状态重新计算完整操作并检查规则联动；只有核验结果可以进入状态结算。

Worker 注册表按 `review`、`settle` 阶段和稳定顺序串行执行。单个 Worker 返回 `applied`、`unchanged`、`skipped` 或 `failed`；异常被隔离，后续 Worker 仍会运行。第一版不让模型动态生成任务图，也不要求尚未进入当前 DSH 正式包的 Subagent API。

受信 Host 插件可以从 `@dsh-external/dsh-agent-rp/extension/v0` 导入 `registerRoleplayTurnWorker`，注册稳定 id、阶段、顺序和 `run()`。这是进程内插件扩展点，不向角色卡或隔离脚本开放 Host 对象；第三方 Worker 仍应把模型可见请求和结果写入 Session，而不能只保存在进程内存中。

正文审阅使用当前会话的模型提供方，但强制关闭推理并使用独立的短 system prompt。请求只包含待审阅回复，不包含酒馆预设、世界书或完整聊天历史。审阅失败或返回不可用内容时保留角色 Agent 原文。审阅成功时，原文与审阅版进入同一个回复版本组，玩家可以用回复版本切换器恢复原文。

每次 Worker 运行都写入内容无关的 `agent-rp/turn-worker-result`。发给模型的完整审阅请求和终止结果分别写入 `agent-rp/narrative-review-request` 与 `agent-rp/narrative-review-result`。状态结算的候选和核验请求都写入 `agent-rp/staged-state-request` 与 `agent-rp/staged-state-result`；核验记录引用成功的候选结果，但核验模型只接收原始状态和剧情证据，不接收候选操作或候选状态，避免错误候选锚定核验。单独的成功候选不会被应用。候选失败会直接终止该 Worker；核验失败会保留原状态并记录失败。旧 Session 中没有阶段字段的单次结算记录仍按原记录重放。这些记录都通过 Host 的 ignorable 插件事件接口进入 Session，能够随会话导出、分支和重放。

正文替换发生在角色 Agent step 关闭之后，因此它属于回合 Worker 的 surface 投影，不计入角色 Agent 的 action receipt。状态结算按当前 plan 记录的 pending message id 读取玩家输入，并从同一 Session 前缀的 canonical surface 读取当前 step 最终可见的角色正文；开场白、插件运行时上下文、其他 step 的回复和已被替换的原文不会进入结算请求。

候选默认使用当前会话模型并关闭推理。核验默认同样使用当前会话模型，但玩家可以在「Agent RP 全局设置 → 多 Agent 回合」中为核验显式选择另一个已配置模型；这个选择只改变独立核验，不改变角色正文或候选结算。选中的提供方或模型不可用时，核验明确失败、保留原状态并写入失败记录，不会静默换用其他模型。核验使用低推理，两个阶段都使用短提示，不注入角色卡、世界书、酒馆预设或完整聊天历史。状态 Worker 的结构化结果上限固定为 4096 token，不继承酒馆预设面向剧情正文的最大输出；低正文上限因此不会截断后台结算。每个有结构化状态计划的回合固定增加两次轻量请求。这个有界流程用于发现自由文本规则中的遗漏或错误操作，不动态扩展任务图，也不承诺在缺少可执行不变量时对任意自然语言规则给出数学证明。
