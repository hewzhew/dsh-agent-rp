# 消息显示架构

Agent RP 将消息显示分为显示计划、DSH 适配器和兼容运行时三层。显示计划只读取 Session 投影、当前显示规则、回复版本和脚本覆盖，按消息返回 `host`、`hidden` 或 `render`；它不读取 DOM，也不创建 iframe。DSH 适配器把 Chat Node 对应到显示计划，并恢复官方正文、隐藏未选回复或挂载渲染结果。兼容运行时继续承载复杂 inline HTML、完整前端文档、状态栏、Tavern Helper 交互和已获准资源。

DSH 的 `conversation.chat.userText` 与 `conversation.chat.assistantText` chain 分别提供用户正文和 Assistant 文本 block 的原生接入。selector 收到 Session identity、稳定 Node key、原始文本，以及 Assistant 的 block index 与 streaming 状态；所有 selector 都拒绝时，Host 继续渲染官方字面正文或 Markdown。图片、推理、工具、复制、分支、文件引用和消息行布局始终由 Host 持有。

每次投影更新会从 Host Chat snapshot 与 Tavern transcript 构造一个不可变的 Session 激活表。表以 `sessionId + nodeKey` 定位用户正文，以 `sessionId + nodeKey + blockIndex` 定位 Assistant 正文，并记录生成它的原始文本；selector 只读取 owner、scope 与闭包中的这份不可变表，文本或 Session 不一致时立即 decline。导入聊天中不能按 durable seq 对齐的消息只在完整可见角色顺序一致时按顺序绑定，避免把正则结果交给错误消息。

纯 Markdown 与不加载资源、不声明文档样式、不接管布局的局部文字装饰走原生 chain。`<span style="color:…">`、旧式 `<font color="…">` 和同类局部排版会直接继承 Host 消息主题；`<style>`、自定义元素、图片、表单、事件、脚本、远程资源和完整文档仍进入既有 iframe。原生 eligibility 是后端选择，不会删除或改写不适用内容。旧 Host 没有正文 chain 时，声明感知注册保持等待，原 DOM 适配器继续执行相同显示计划；新 Host 上 DOM 适配器仍负责隐藏回复版本、旧会话提示、设定消息折叠和复杂 iframe，并在发现原生 marker 时撤下旧替换。

迁移验收覆盖同一输入在 DOM 与原生适配器下得到相同显示计划、关闭规则后恢复 Host 正文、回复版本切换、用户与 Assistant 正则深度、脚本 `refreshOneMessage` 覆盖、Session 与文本防串线、流式 Assistant decline、推理和多文本 block 保留旧路径，以及复杂前端继续进入既有 iframe。Agent RP 不复制 DSH 的完整消息组件。
