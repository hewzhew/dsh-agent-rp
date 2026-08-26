import assert from 'node:assert/strict'
import test from 'node:test'
import type { ImportedCharacterFrontend, ImportedRegexScript } from '../src/import/types.ts'
import { compileCharacterDisplay } from '../src/card-display-compiler.ts'
import {
  isNativeMessageInlineHtml,
  NATIVE_MESSAGE_INLINE_ATTRIBUTES,
  NATIVE_MESSAGE_INLINE_TAGS,
  nativeMessageDisplay,
} from '../src/native-message-display.ts'
import {
  createNativeMessageActivationTable,
  nativeMessageChatRevision,
  selectNativeAssistantMessage,
  selectNativeUserMessage,
  type NativeMessageChatSnapshot,
} from '../src/native-message-routes.ts'
import {
  createRoleplayDisplayPlanner,
  type RoleplayDisplayMessage,
  type RoleplayDisplayProjection,
} from '../src/roleplay-display-plan.ts'

const frontend: ImportedCharacterFrontend = {
  regexScripts: [],
  tavernHelperScriptNames: [],
  tavernHelperScripts: [],
  tavernHelperVariables: {},
}

function displayScript(replaceString: string): ImportedRegexScript {
  return {
    scriptName: '着色',
    findRegex: '/藤子/g',
    replaceString,
    trimStrings: [],
    placement: [1, 2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  }
}

const messages: readonly RoleplayDisplayMessage[] = [
  { messageId: 0, seq: 10, role: 'user', text: '藤子', isHidden: false },
  { messageId: 1, seq: 20, role: 'assistant', text: '藤子', isHidden: false },
]

const projection: RoleplayDisplayProjection = {
  characterName: '角色',
  userName: '用户',
  tavern: { messages },
  generations: [],
}

function chat(assistantBlocks: readonly unknown[] = [{ kind: 'text', text: '藤子' }]): NativeMessageChatSnapshot {
  return {
    order: ['user-node', 'assistant-node'],
    nodes: new Map([
      ['user-node', { kind: 'user', data: { seq: 999, content: [{ type: 'text', text: '藤子' }] } }],
      ['assistant-node', {
        kind: 'assistant-step',
        data: { status: 'settled', blocks: assistantBlocks, finalNode: { seq: 999 } },
      }],
    ]),
  }
}

test('admits local text decoration while keeping document and resource HTML on the frontend path', () => {
  assert.equal(isNativeMessageInlineHtml('<span style="color:#d9b36c">藤子</span>'), true)
  assert.equal(isNativeMessageInlineHtml('<font color="#d9b36c">藤子</font>'), true)
  assert.equal(isNativeMessageInlineHtml('<span style="color:var(--accent)!important">藤子</span>'), true)
  assert.equal(isNativeMessageInlineHtml('<span onclick="run()">藤子</span>'), false)
  assert.equal(isNativeMessageInlineHtml('<span style="background:url(https://example.com/x)">藤子</span>'), false)
  assert.equal(isNativeMessageInlineHtml('<span style="color:red&#59;position:fixed">藤子</span>'), false)
  assert.equal(isNativeMessageInlineHtml(
    '<span style="color:red&#59;background:u&#114;l&#40;https://example.com/x&#41;">藤子</span>',
  ), false)
  assert.equal(isNativeMessageInlineHtml('<a href="https://example.com/">藤子</a>'), false)
  assert.equal(isNativeMessageInlineHtml('<span href="https://example.com/">藤子</span>'), false)
  assert.equal(isNativeMessageInlineHtml('<div style="position:fixed">藤子</div>'), false)
  assert.equal(isNativeMessageInlineHtml('<style>body{color:red}</style>藤子'), false)
  assert.equal(isNativeMessageInlineHtml('<img src="https://example.com/x.png">'), false)
  assert.equal(nativeMessageDisplay(compileCharacterDisplay('普通 **Markdown**'))?.segments[0]?.kind, 'markdown')
  assert.equal(nativeMessageDisplay(compileCharacterDisplay('<section>完整布局</section>')), undefined)
  assert.equal(NATIVE_MESSAGE_INLINE_TAGS.includes('a'), false)
  assert.equal(NATIVE_MESSAGE_INLINE_TAGS.includes('img'), false)
  assert.equal(NATIVE_MESSAGE_INLINE_ATTRIBUTES.includes('href'), false)
})

test('keeps mixed Markdown native only when its rendered semantics are preserved', () => {
  const preserved = '**粗体**、`代码`和<span style="color:#d9b36c">藤子</span>'
  assert.deepEqual(nativeMessageDisplay(compileCharacterDisplay(preserved))?.segments, [
    { kind: 'inline-html', source: preserved },
  ])

  const declined = [
    '看[链接](https://example.com)<span style="color:red">藤子</span>',
    '看 https://example.com <span style="color:red">藤子</span>',
    '![图片](https://example.com/image.png)<span style="color:red">藤子</span>',
    '- 第一项\n- <span style="color:red">藤子</span>',
    '```text\n代码\n```\n<span style="color:red">藤子</span>',
  ]
  for (const source of declined) {
    assert.equal(nativeMessageDisplay(compileCharacterDisplay(source)), undefined, source)
  }
})

test('binds display plans to exact Session, Node, block, and text identities', () => {
  const planner = createRoleplayDisplayPlanner({
    projection,
    frontend: { ...frontend, regexScripts: [displayScript('<span style="color:#d9b36c">$&</span>')] },
    immersive: true,
    overrides: new Map(),
  })
  const table = createNativeMessageActivationTable({ sessionId: 'session-a', chat: chat(), planner, messages })
  const user = { nodeKey: 'user-node', text: '藤子' }
  const assistant = { nodeKey: 'assistant-node', blockIndex: 0, text: '藤子', streaming: false }

  assert.equal(selectNativeUserMessage(table, user), null)
  assert.equal(selectNativeUserMessage(table, user, { sessionId: 'session-b' }), null)
  assert.equal(selectNativeUserMessage(table, { ...user, text: '旧正文' }, { sessionId: 'session-a' }), null)
  assert.deepEqual(selectNativeUserMessage(table, user, { sessionId: 'session-a' })?.display.segments, [{
    kind: 'inline-html', source: '<span style="color:#d9b36c">藤子</span>',
  }])
  assert.equal(selectNativeAssistantMessage(table, { ...assistant, streaming: true }, { sessionId: 'session-a' }), null)
  assert.equal(selectNativeAssistantMessage(table, { ...assistant, blockIndex: 1 }, { sessionId: 'session-a' }), null)
  assert.deepEqual(selectNativeAssistantMessage(table, assistant, { sessionId: 'session-a' })?.display.segments, [{
    kind: 'inline-html', source: '<span style="color:#d9b36c">藤子</span>',
  }])
})

test('declines complex and multi-block displays so the iframe DOM adapter remains authoritative', () => {
  const complexPlanner = createRoleplayDisplayPlanner({
    projection,
    frontend: { ...frontend, regexScripts: [displayScript('<style>.name{color:red}</style><div class="name">$&</div>')] },
    immersive: true,
    overrides: new Map(),
  })
  const complex = createNativeMessageActivationTable({
    sessionId: 'session-a', chat: chat(), planner: complexPlanner, messages,
  })
  assert.equal(complex.users.size, 0)
  assert.equal(complex.assistants.size, 0)

  const mixedMarkdownPlanner = createRoleplayDisplayPlanner({
    projection,
    frontend: {
      ...frontend,
      regexScripts: [displayScript('[藤子](https://example.com)<span style="color:red">$&</span>')],
    },
    immersive: true,
    overrides: new Map(),
  })
  const mixedMarkdown = createNativeMessageActivationTable({
    sessionId: 'session-a', chat: chat(), planner: mixedMarkdownPlanner, messages,
  })
  assert.equal(mixedMarkdown.users.size, 0)
  assert.equal(mixedMarkdown.assistants.size, 0)

  const simplePlanner = createRoleplayDisplayPlanner({
    projection,
    frontend: { ...frontend, regexScripts: [displayScript('<span style="color:red">$&</span>')] },
    immersive: true,
    overrides: new Map(),
  })
  const multiBlock = createNativeMessageActivationTable({
    sessionId: 'session-a',
    chat: chat([{ kind: 'text', text: '藤子' }, { kind: 'reasoning', text: '思考' }, { kind: 'text', text: '藤子' }]),
    planner: simplePlanner,
    messages,
  })
  assert.equal(multiBlock.users.size, 1)
  assert.equal(multiBlock.assistants.size, 0)
})

test('keeps the chat revision stable across streaming tokens and advances on routable text', () => {
  const nodes = new Map<string, NativeMessageChatSnapshot['nodes'] extends { get(key: string): infer Node } ? Node : never>([
    ['user-node', { kind: 'user', data: { seq: 10, content: [{ type: 'text', text: '藤子' }] } }],
    ['assistant-node', { kind: 'assistant-step', data: { status: 'running', blocks: [{ kind: 'text', text: '藤' }] } }],
  ])
  const snapshot: NativeMessageChatSnapshot = { order: ['user-node', 'assistant-node'], nodes }
  const initial = nativeMessageChatRevision(snapshot)
  nodes.set('assistant-node', {
    kind: 'assistant-step', data: { status: 'running', blocks: [{ kind: 'text', text: '藤子' }] },
  })
  assert.equal(nativeMessageChatRevision(snapshot), initial)

  nodes.set('assistant-node', {
    kind: 'assistant-step', data: { status: 'settled', blocks: [{ kind: 'text', text: '藤子' }] },
  })
  const settled = nativeMessageChatRevision(snapshot)
  assert.notEqual(settled, initial)
  assert.equal(nativeMessageChatRevision(snapshot), settled)

  nodes.set('user-node', {
    kind: 'user', data: { seq: 10, content: [{ type: 'text', text: '新的藤子' }] },
  })
  assert.notEqual(nativeMessageChatRevision(snapshot), settled)
})
