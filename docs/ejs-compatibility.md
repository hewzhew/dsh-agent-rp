# EJS 兼容范围

Agent RP 只执行能够从当前 Session 日志确定性重建的模板语义。模板运行在独立 QuickJS 环境中，不会获得浏览器页面、文件、网络、模块、凭据或宿主回调。

| 能力 | 当前状态 | 说明 |
|---|---|---|
| `<% %>`、`<%= %>`、`<%- %>`、注释与空白裁剪 | 支持 | 包含条件、循环、`print` 和完全在隔离运行时内完成的 Promise |
| `char`、`user`、`charName`、`userName`、`runType` | 支持 | `runType` 在模型提示词阶段固定为 `generate` |
| `lastMessage`、`lastUserMessage`、`lastCharMessage` 与对应楼层编号 | 支持 | 从当前可见的 user/assistant Session 消息重建；没有匹配消息时内容为空、编号为 `-1` |
| `getChatMessage`、`getChatMessages` | 支持 | 支持负数楼层、角色筛选、最近数量和闭区间读取，只返回可见消息正文 |
| `{{char}}`、`<char>`、`{{user}}`、`<user>` | 支持 | 角色名与玩家名在世界书 EJS 编译前替换，与 ST Prompt Template 的世界书处理顺序一致 |
| `variables`、`stat_data`、`getvar` 及作用域别名 | 只读支持 | 合并 global、preset、character、chat、message 和当前 MVU 状态；模板不能直接改写 Session |
| `_` 与 `YAML.stringify` | 支持 JSON 数据子集 | `_` 提供 `get`、`has`、`cloneDeep`、`mapValues`、`isEmpty`、`omit`、`pick`、`transform`；YAML 输出保持确定性并可由 YAML 1.2 读取，不提供页面对象或插件实例 |
| `setvar`、`incvar`、`decvar` | 未执行 | 需要持久事件、准备/生成/渲染阶段和失败回滚语义，不能伪装成一次性的局部修改 |
| `getwi`、`getWorldInfo` | 只读支持 | 按当前 Session 的世界书来源和条目标识读取纯文本条目；支持当前书及显式书名，找不到返回空字符串，读取次数和累计字符受限 |
| `getchar`、`getpreset`、`getqr` | 未执行 | 需要同样的资源身份与递归预算；原始模板仍完整保留 |
| `activewi`、`injectPrompt`、`activateRegex`、`@@` 装饰器 | 未执行 | 会改变提示词结构或激活顺序，需要独立的 Session 事件和可检查的执行计划 |
| 页面对象、JQuery、toastr、SillyTavern 全局对象 | 不提供 | 模型提示词模板不得访问 UI、网络或宿主页面 |
| `Date`、随机数和 Host 异步 API | 不提供 | 保证同一 Session 日志可以重放出相同提示词 |

模板超过源码、输出、内存、栈、解释器工作量、资源读取或单轮执行次数限制时，只跳过对应模块或世界书条目，并返回不含模板正文的稳定失败类别。`getWorldInfo` 引用含 EJS 的条目时不会泄露未执行标签；递归渲染加入循环检测前会明确归类为不支持。

兼容事实参考公开的 [ST Prompt Template 文档](https://github.com/zonde306/ST-Prompt-Template/blob/9bf9bcdfa8d0d38ab1f4f7342067bc16f347d85d/docs/reference.md)。实现依据公开接口行为独立完成，不包含其 AGPL 源代码。
