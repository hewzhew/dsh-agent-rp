import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createContext, runInContext } from 'node:vm'
import {
  cardDisplayCustomElementTags,
  compileCharacterDisplay,
  normalizeLegacyCardHtml,
} from '../src/card-display-compiler.ts'
import {
  blockedCardFrameResources, cardFrameCompatibilityUrl, compileCardFrameDocument, compileCardFrames,
} from '../src/client/card-frame.ts'
import {
  captureCardFrameAppearance,
  type CardFrameAppearance,
} from '../src/client/card-frame-appearance.ts'
import {
  parseCardCapabilityRequest, parseCardChatSendCapabilityRequest, parseCardExternalWindowCapabilityRequest,
  parseCardExternalWindowControlRequest, parseCardExternalWindowDeliveryReport,
  parseCardNativeIdentityCapabilityRequest,
  parseCardResourceBlockedReport, parseCardRuntimeReport,
  parseCardUserMessageAppendCapabilityRequest,
  parseCardVariableReplaceRequest,
} from '../src/client/card-capability.ts'
import { cardRemoteResourceRequirements } from '../src/card-remote-resource.ts'
import { AGENT_RP_CAPABILITIES } from '../src/extension-capability.ts'
import { validExternalWindowMessage } from '../src/client/external-window.ts'

class CardActionOptionsFixtureElement {
  readonly children: CardActionOptionsFixtureElement[] = []
  readonly dataset: Record<string, string> = {}
  hidden = false
  textContent = ''
  type = ''

  constructor(readonly tagName: string, readonly id = '') {}

  append(...children: CardActionOptionsFixtureElement[]): void {
    this.children.push(...children)
  }

  replaceChildren(...children: CardActionOptionsFixtureElement[]): void {
    this.children.splice(0, this.children.length, ...children)
  }
}

class CardActionOptionsFixtureDocument {
  readonly documentElement = new CardActionOptionsFixtureElement('html')
  readonly options = new CardActionOptionsFixtureElement('section', 'action-options')
  readonly missing = new CardActionOptionsFixtureElement('p', 'action-options-missing')
  readonly #elements = new Map([
    [this.options.id, this.options],
    [this.missing.id, this.missing],
  ])

  createElement(tagName: string): CardActionOptionsFixtureElement {
    return new CardActionOptionsFixtureElement(tagName)
  }

  getElementById(id: string): CardActionOptionsFixtureElement | null {
    return this.#elements.get(id) ?? null
  }
}

const actionOptionsFixture = readFileSync(
  new URL('./fixtures/card-action-options.html', import.meta.url),
  'utf8',
)

interface CardChatFixtureMessage {
  extra: Record<string, unknown>
  is_user: boolean
  mes: string
  message: string
  swipes: string[]
  [key: string]: unknown
}

function cardChatRuntimeStatements(documentSource: string): string {
  const statements = [
    /^function __dshSetCardCapabilityState[^\r\n]*$/mu,
    /^function __dshCloneCardMessage[^\r\n]*$/mu,
    /^window\.getChatMessages=[^\r\n]*$/mu,
    /^window\.getLastMessageId=[^\r\n]*$/mu,
    /^window\.getCurrentMessageId=[^\r\n]*$/mu,
  ].map((pattern) => {
    const statement = documentSource.match(pattern)?.[0]
    assert.ok(statement, `compiled card frame is missing ${pattern.source}`)
    return statement
  })
  return statements.join('\n')
}

function cardCreateMessageRuntimeStatements(documentSource: string): string {
  const statements = [
    /^var __dshCurrentCharacter=[^\r\n]*$/mu,
    /^var __dshCardUserName=[^\r\n]*$/mu,
    /^var __dshCardChatSnapshot=[^\r\n]*$/mu,
    /^var __dshCardChat=[^\r\n]*$/mu,
    /^var __dshCardPending=[^\r\n]*$/mu,
    /^function __dshSetCardCapabilityState[^\r\n]*$/mu,
    /^function __dshCloneCardMessage[^\r\n]*$/mu,
    /^function __dshApplyCardMessage[^\r\n]*$/mu,
    /^function __dshCardCreateMessages[^\r\n]*$/mu,
    /^window\.getChatMessages=[^\r\n]*$/mu,
    /^window\.createChatMessages=[^\r\n]*$/mu,
    /^window\.setChatMessage=[^\r\n]*$/mu,
  ].map((pattern) => {
    const statement = documentSource.match(pattern)?.[0]
    assert.ok(statement, `compiled card frame is missing ${pattern.source}`)
    return statement
  })
  const capabilityResultListener = [...documentSource.matchAll(/^addEventListener\('message'[^\r\n]*$/gmu)]
    .map(match => match[0])
    .find(statement => statement.includes('__dshCardPending'))
  assert.ok(capabilityResultListener, 'compiled card frame is missing its capability-result listener')
  const triggerSlash = documentSource.match(/window\.triggerSlash=function\(value\)\{[^;]+\};/u)?.[0]
  assert.ok(triggerSlash, 'compiled card frame is missing triggerSlash')
  return [...statements, capabilityResultListener, triggerSlash].join('\n')
}

function runCardActionOptionsFixture(message: CardChatFixtureMessage): {
  readonly document: CardActionOptionsFixtureDocument
  readonly getChatMessages: () => CardChatFixtureMessage[]
} {
  const documentSource = compileCardFrameDocument(actionOptionsFixture, {
    origin: 'http://127.0.0.1:3091',
  })
  const fixtureScript = documentSource.match(
    /<script data-action-options-fixture>([\s\S]*?)<\/script>/u,
  )?.[1]
  assert.ok(fixtureScript)
  const document = new CardActionOptionsFixtureDocument()
  const sandbox: Record<string, unknown> = {
    __dshCardChat: [message],
    __dshCardCurrentMessageId: 0,
    document,
  }
  sandbox.window = sandbox
  const context = createContext(sandbox)
  runInContext(cardChatRuntimeStatements(documentSource), context)
  const getChatMessages = sandbox.getChatMessages
  assert.equal(typeof getChatMessages, 'function')
  runInContext(fixtureScript, context)
  return {
    document,
    getChatMessages: getChatMessages as () => CardChatFixtureMessage[],
  }
}

test('stamps only browser-activated actions and relays trigger grants for Host validation', () => {
  const url = cardFrameCompatibilityUrl('<!doctype html><html><body>panel</body></html>', 'frame-token:0')
  const shell = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8')
  assert.match(shell, /requestId:pendingSend,playerAction:true,value/u)
  const relay = shell.match(/<script>([\s\S]*?)<\/script>/u)?.[1]
  assert.ok(relay)
  const innerResults: unknown[] = []
  const inner = { postMessage: (message: unknown): void => { innerResults.push(message) } }
  const parent = {}
  let receiveMessage: ((event: {
    readonly source: unknown
    readonly data: Record<string, unknown>
    stopImmediatePropagation: () => void
  }) => void) | undefined
  const sandbox: Record<string, unknown> = {
    addEventListener(type: string, listener: typeof receiveMessage): void {
      if (type === 'message') receiveMessage = listener
    },
    Date,
    document: { getElementById: () => ({ contentWindow: inner }) },
    navigator: { userActivation: { isActive: false } },
    parent,
    Set,
  }
  const context = createContext(sandbox)
  runInContext(relay, context)
  assert.notEqual(receiveMessage, undefined)
  const dispatch = (data: Record<string, unknown>, source: unknown = inner): boolean => {
    let stopped = false
    receiveMessage?.({ source, data, stopImmediatePropagation: () => { stopped = true } })
    return stopped
  }

  const automatic: Record<string, unknown> = {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'chat.user-message.append',
    requestId: 'card-user-message-append-1', playerAction: true,
  }
  assert.equal(dispatch(automatic), true)
  assert.equal(automatic.playerAction, undefined)
  assert.equal(innerResults.length, 1)

  runInContext('navigator.userActivation.isActive=true', context)
  const clicked = { ...automatic }
  assert.equal(dispatch(clicked), false)
  assert.equal(clicked.playerAction, true)

  dispatch({
    source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'chat.user-message.append', ok: true,
  }, parent)
  runInContext('navigator.userActivation.isActive=false', context)
  const firstTrigger: Record<string, unknown> = {
    source: 'dsh-agent-rp-card', action: 'trigger-slash', value: '/trigger',
  }
  assert.equal(dispatch(firstTrigger), false)
  assert.equal(firstTrigger.playerAction, undefined)
  const secondTrigger: Record<string, unknown> = {
    source: 'dsh-agent-rp-card', action: 'trigger-slash', value: '/trigger',
  }
  assert.equal(dispatch(secondTrigger), true)
  assert.equal(secondTrigger.playerAction, undefined)
})

test('uses transcript message IDs when an isolated card updates and appends messages', async () => {
  const source = compileCardFrameDocument('<!doctype html><html><body>panel</body></html>', {
    origin: 'http://127.0.0.1:3091', capabilityToken: 'frame-token:0', userName: '旅人',
    chat: {
      currentMessageId: 2,
      messages: [
        { messageId: 0, role: 'assistant', text: '开场' },
        { messageId: 2, role: 'assistant', text: '跳过已删除消息后的正文' },
      ],
    },
  })
  const posted: unknown[] = []
  let receiveHostMessage: ((event: { readonly source: unknown; readonly data: unknown }) => void) | undefined
  const parent = {
    postMessage(message: unknown): void {
      posted.push(JSON.parse(JSON.stringify(message)) as unknown)
    },
  }
  const sandbox: Record<string, unknown> = {
    __dshCardCapabilityToken: 'frame-token:0',
    __dshCardGreetingChoices: null,
    addEventListener(type: string, listener: (event: { readonly source: unknown; readonly data: unknown }) => void): void {
      if (type === 'message') {
        receiveHostMessage = listener
        sandbox.__testReceiveHostMessage = listener
      }
    },
    clearTimeout,
    document: { documentElement: { dataset: {} } },
    __dshCardEmit(): void {},
    __dshStatData: {},
    navigator: { userActivation: { isActive: true } },
    parent,
    setTimeout,
  }
  sandbox.window = sandbox
  const context = createContext(sandbox)
  runInContext(cardCreateMessageRuntimeStatements(source), context)

  const createChatMessages = sandbox.createChatMessages
  const getChatMessages = sandbox.getChatMessages
  const setChatMessage = sandbox.setChatMessage
  const triggerSlash = sandbox.triggerSlash
  assert.equal(typeof createChatMessages, 'function')
  assert.equal(typeof getChatMessages, 'function')
  assert.equal(typeof setChatMessage, 'function')
  assert.equal(typeof triggerSlash, 'function')
  const create = createChatMessages as (
    messages: readonly { readonly role: 'user'; readonly message: string }[],
    option: { readonly refresh: 'affected' },
  ) => Promise<void>
  await (setChatMessage as (value: string, messageId: number) => Promise<void>)('按真实 ID 更新', 2)
  const updated = (getChatMessages as () => readonly Record<string, unknown>[])()
  assert.deepEqual(Array.from(updated, message => ({
    message_id: message.message_id,
    message: message.message,
  })), [
    { message_id: 0, message: '开场' },
    { message_id: 2, message: '按真实 ID 更新' },
  ])
  runInContext('navigator.userActivation.isActive=false', context)
  await assert.rejects(create(
    [{ role: 'user', message: '后台伪造消息' }], { refresh: 'affected' },
  ), /需要点击后才能创建用户消息/u)
  assert.equal(posted.length, 0)
  runInContext('navigator.userActivation.isActive=true', context)
  const pending = create([{ role: 'user', message: '继续调查线索' }], { refresh: 'affected' })

  assert.equal(posted.length, 1)
  const request = posted[0] as Record<string, unknown>
  assert.deepEqual(request, {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'chat.user-message.append',
    token: 'frame-token:0', requestId: 'card-user-message-append-1', message: '继续调查线索',
  })

  const hostRequest = { ...request, playerAction: true }
  assert.deepEqual(parseCardUserMessageAppendCapabilityRequest(hostRequest), hostRequest)
  assert.equal(parseCardUserMessageAppendCapabilityRequest(request), undefined)
  assert.equal(parseCardUserMessageAppendCapabilityRequest({ ...hostRequest, message: '' }), undefined)
  assert.equal(parseCardUserMessageAppendCapabilityRequest({ ...hostRequest, role: 'assistant' }), undefined)
  assert.equal(parseCardUserMessageAppendCapabilityRequest({ ...hostRequest, insertAt: 0 }), undefined)
  assert.equal(parseCardUserMessageAppendCapabilityRequest({ ...hostRequest, operation: 'delete-chat-messages' }), undefined)
  assert.equal(parseCardUserMessageAppendCapabilityRequest({ ...hostRequest, sessionId: 'another-session' }), undefined)
  assert.equal(parseCardUserMessageAppendCapabilityRequest({
    ...hostRequest, message: '猫'.repeat(30_000),
  }), undefined)

  assert.notEqual(receiveHostMessage, undefined)
  sandbox.__testHostData = {
    source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'chat.user-message.append',
    requestId: request.requestId, ok: true,
  }
  runInContext('__testReceiveHostMessage({ source: parent, data: __testHostData })', context)
  const pendingSize = runInContext('__dshCardPending.size', context) as number
  if (pendingSize !== 0) {
    clearTimeout(runInContext('__dshCardPending.values().next().value.timer', context) as ReturnType<typeof setTimeout>)
  }
  assert.equal(pendingSize, 0, 'Host success response must settle the card mutation request')
  await pending
  ;(triggerSlash as (value: string) => void)('/trigger')

  const chat = (getChatMessages as () => readonly Record<string, unknown>[])()
  assert.equal(chat.length, 3)
  assert.deepEqual({
    message_id: chat[2]?.message_id,
    role: chat[2]?.role,
    message: chat[2]?.message,
    is_user: chat[2]?.is_user,
  }, {
    message_id: 3, role: 'user', message: '继续调查线索', is_user: true,
  })
  assert.equal(chat[2]?.name, '旅人')
  assert.equal(posted.filter(message => (
    message as { readonly action?: unknown }
  ).action === 'trigger-slash').length, 1)
  assert.deepEqual(posted[1], {
    source: 'dsh-agent-rp-card', action: 'trigger-slash', token: 'frame-token:0', value: '/trigger',
  })
})
function cardChatSnapshotRuntimeStatements(documentSource: string): string {
  const required = [
    /^var __dshCardGreetingChoices=[^\r\n]*$/mu,
    /^var __dshCardChatSnapshot=[^\r\n]*$/mu,
    /^var __dshCurrentCharacter=[^\r\n]*$/mu,
    /^var __dshCardUserName=[^\r\n]*$/mu,
    /^var __dshCardChat=[^\r\n]*$/mu,
    /^var __dshCardCurrentMessageId=[^\r\n]*$/mu,
    /^function __dshSetCardCapabilityState[^\r\n]*$/mu,
    /^function __dshCloneCardMessage[^\r\n]*$/mu,
    /^window\.getChatMessages=[^\r\n]*$/mu,
    /^window\.getLastMessageId=[^\r\n]*$/mu,
    /^window\.getCurrentMessageId=[^\r\n]*$/mu,
  ].map((pattern) => {
    const statement = documentSource.match(pattern)?.[0]
    assert.ok(statement, `compiled card frame is missing ${pattern.source}`)
    return statement
  })
  return required.join('\n')
}

function runCardActionOptionsSnapshotFixture(): {
  readonly currentMessageId: () => number
  readonly document: CardActionOptionsFixtureDocument
  readonly getChatMessages: () => CardChatFixtureMessage[]
  readonly lastMessageId: () => number
} {
  const opening = [
    '开场剧情。',
    '<JSONPatch>',
    '[',
    '  {"op":"replace","path":"/行动选项/0","value":"查看开场环境"},',
    '  {"op":"replace","path":"/行动选项/1","value":"询问开场人物"},',
    '  {"op":"replace","path":"/行动选项/2","value":"检查开场线索"},',
    '  {"op":"replace","path":"/行动选项/3","value":"元指令:推进开场时间。"}',
    ']',
    '</JSONPatch>',
  ].join('\n')
  const current = [
    '第二轮剧情。',
    '<JSONPatch>',
    '[',
    '  {"op":"replace","path":"/行动选项/0","value":"查看第二轮环境"},',
    '  {"op":"replace","path":"/行动选项/1","value":"询问第二轮人物"},',
    '  {"op":"replace","path":"/行动选项/2","value":"检查第二轮线索"},',
    '  {"op":"replace","path":"/行动选项/3","value":"元指令:推进第二轮时间。"}',
    ']',
    '</JSONPatch>',
  ].join('\n')
  const documentSource = compileCardFrameDocument(actionOptionsFixture, {
    origin: 'http://127.0.0.1:3091',
    greetingChoices: { selected: opening, alternatives: [opening] },
    chat: {
      currentMessageId: 2,
      messages: [
        { messageId: 0, role: 'assistant', text: opening },
        { messageId: 1, role: 'user', text: '继续调查。' },
        { messageId: 2, role: 'assistant', text: current },
      ],
    },
  })
  const fixtureScript = documentSource.match(
    /<script data-action-options-fixture>([\s\S]*?)<\/script>/u,
  )?.[1]
  assert.ok(fixtureScript)
  const document = new CardActionOptionsFixtureDocument()
  const sandbox: Record<string, unknown> = { document }
  sandbox.window = sandbox
  const context = createContext(sandbox)
  runInContext(cardChatSnapshotRuntimeStatements(documentSource), context)
  runInContext(fixtureScript, context)
  return {
    currentMessageId: sandbox.getCurrentMessageId as () => number,
    document,
    getChatMessages: sandbox.getChatMessages as () => CardChatFixtureMessage[],
    lastMessageId: sandbox.getLastMessageId as () => number,
  }
}

test('removes model-defined wrappers and reports only safe tag metadata', () => {
  const source = '<scene>private sample prose</scene>'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{ kind: 'markdown', text: 'private sample prose' }])
  assert.deepEqual(compiled.diagnostics, [{
    code: 'unknown-wrapper-removed',
    count: 2,
    tags: ['scene'],
  }])
  assert.doesNotMatch(JSON.stringify(compiled.diagnostics), /private sample prose/u)
})

test('keeps prose after a leading block frontend on the native Markdown surface', () => {
  const source = '<div class="scene"><div>meta</div></div>\n\n**正文**'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [
    { kind: 'inline-html', source: '<div class="scene"><div>meta</div></div>' },
    { kind: 'markdown', text: '\n\n**正文**' },
  ])
  assert.deepEqual(compiled.diagnostics, [{ code: 'inline-html', count: 1 }])
})

test('preserves legacy center markup until the compatibility stage normalizes it', () => {
  const source = '<center class="portrait">name<br><img src="portrait.png"></center>'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{ kind: 'inline-html', source }])
  assert.deepEqual(normalizeLegacyCardHtml(source), {
    source: '<div data-agent-rp-center class="portrait">name<br><img src="portrait.png"></div>',
    diagnostics: [{ code: 'legacy-center-normalized', count: 1 }],
  })
})

test('normalizes only high-confidence legacy symbol bars into responsive decorations', () => {
  const source = [
    '<style>.title::before{content:\'▄▄▄▄▄▄▄▄\';color:pink}.short::after{content:\'▀▀▀\'}</style>',
    '<div class="footer">▀▀▀▀▀▀▀▀</div>',
    '<div class="mixed">■■□□</div>',
    '<pre>────────</pre>',
    '<script>const css="content:\'▄▄▄▄\';";const sample="<div>▀▀▀▀</div>"</script>',
  ].join('')

  const normalized = normalizeLegacyCardHtml(source)

  assert.match(normalized.source, /\.title::before\{content:"";display:block;flex:1 1 2em;/u)
  assert.match(normalized.source, /<div class="footer" data-agent-rp-legacy-symbol-bar aria-hidden="true"><\/div>/u)
  assert.match(normalized.source, /content:'▀▀▀'/u)
  assert.match(normalized.source, /<div class="mixed">■■□□<\/div>/u)
  assert.match(normalized.source, /<pre>────────<\/pre>/u)
  assert.match(normalized.source, /const css="content:'▄▄▄▄';";const sample="<div>▀▀▀▀<\/div>"/u)
  assert.deepEqual(normalized.diagnostics, [{ code: 'legacy-symbol-bar-normalized', count: 2 }])

  const frame = compileCardFrameDocument(source, { origin: 'http://127.0.0.1:3091' })
  assert.match(frame, /\[data-agent-rp-legacy-symbol-bar\]\{display:block!important;width:100%!important;/u)
  assert.match(frame, /data-agent-rp-legacy-symbol-bar aria-hidden="true"/u)
})

test('keeps a leading style block in inline frontend source for sanitization', () => {
  const source = '<style>.card{display:grid}</style>\n<section class="card">content</section>'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{ kind: 'inline-html', source }])
  assert.deepEqual(compiled.diagnostics, [{ code: 'inline-html', count: 1 }])
})

test('captures the visible Host theme behind a transparent message node', () => {
  const parent = { parentElement: null }
  const child = { parentElement: parent }
  const childStyle = {
    backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(249, 250, 251)',
    fontFamily: 'Inter', fontSize: '14px', fontStyle: 'normal', fontWeight: '400',
    letterSpacing: 'normal', lineHeight: '21px',
  }
  const parentStyle = { ...childStyle, backgroundColor: 'rgb(23, 23, 25)' }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle')
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: (element: unknown) => element === child ? childStyle : parentStyle,
  })
  try {
    assert.deepEqual(captureCardFrameAppearance(child as HTMLElement), {
      backgroundColor: 'rgb(23, 23, 25)', color: 'rgb(249, 250, 251)',
      fontFamily: 'Inter', fontSize: '14px', fontStyle: 'normal', fontWeight: '400',
      letterSpacing: 'normal', lineHeight: '21px',
    })
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'getComputedStyle')
    else Object.defineProperty(globalThis, 'getComputedStyle', previous)
  }
})

test('projects a Host theme baseline into an opted-in isolated document', () => {
  const appearance: CardFrameAppearance = {
    backgroundColor: 'rgb(23, 23, 25)', color: 'rgb(249, 250, 251)',
    fontFamily: 'Inter', fontSize: '14px', fontStyle: 'normal', fontWeight: '400',
    letterSpacing: 'normal', lineHeight: '21px',
  }
  const source = compileCardFrameDocument('<p>正文 <span style="color:#d9b36c">藤子</span></p>', {
    appearance, origin: 'http://127.0.0.1:3091',
  })

  assert.match(source, /"backgroundColor":"rgb\(23, 23, 25\)"/u)
  assert.match(source, /"color":"rgb\(249, 250, 251\)"/u)
  assert.match(source, /setProperty\('background-color',value\.backgroundColor,'important'\)/u)
  assert.match(source, /setProperty\('color',value\.color,'important'\)/u)
  assert.match(source, /setProperty\('margin','0','important'\)/u)
})

test('preserves styled custom wrappers inside an isolated inline frontend', () => {
  const source = '<style>scene-body{display:block;color:white}</style>\n<scene-body>readable prose</scene-body>'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{ kind: 'inline-html', source }])
  assert.deepEqual(compiled.diagnostics, [{ code: 'inline-html', count: 1 }])
  assert.deepEqual(cardDisplayCustomElementTags(source), ['scene-body'])
  assert.deepEqual(cardDisplayCustomElementTags('<script>unsafe()</script><iframe></iframe>'), [])
})

test('distinguishes fenced frontend documents from inline HTML in source order', () => {
  const source = [
    'before',
    '```html',
    '<!doctype html><html><body>frame</body></html>',
    '```',
    'after <details><summary>state</summary>ready</details>',
  ].join('\n')
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [
    { kind: 'markdown', text: 'before\n' },
    { kind: 'html', source: '<!doctype html><html><body>frame</body></html>\n' },
    { kind: 'inline-html', source: 'after <details><summary>state</summary>ready</details>' },
  ])
  assert.deepEqual(compiled.diagnostics, [
    { code: 'frontend-document', count: 1 },
    { code: 'inline-html', count: 1 },
  ])
})

test('keeps application greetings isolated while preserving only the bounded parent document', () => {
  const source = '<!doctype html><html><body><script>function getWin(){return window.parent || window}const context=top.SillyTavern.getContext();getWin().Mvu.getMvuData();parent.getChatMessages();parent.getCurrentMessageId();parent.document.body;</script><img src="https://cdn.example.com/cover.webp"></body></html>'
  const frames = compileCardFrames(compileCharacterDisplay(`\`\`\`html\n${source}\n\`\`\``), {
    origin: 'http://127.0.0.1:3091',
  })
  const frame = frames.segments[0]
  assert.equal(frame?.kind, 'frame')
  if (frame?.kind !== 'frame') return
  assert.equal(frame.interactive, true)
  assert.deepEqual(frame.remoteOrigins, ['https://cdn.example.com'])
  assert.match(frame.srcDoc, /window\.SillyTavern\.getContext\(\)/u)
  assert.match(frame.srcDoc, /function getWin\(\)\{return window\}/u)
  assert.doesNotMatch(frame.srcDoc, /window\.parent\s*\|\|\s*window/u)
  assert.match(frame.srcDoc, /window\.getChatMessages\(\)/u)
  assert.match(frame.srcDoc, /window\.getCurrentMessageId\(\)/u)
  assert.match(frame.srcDoc, /parent\.document\.body/u)
  assert.doesNotMatch(frame.srcDoc, /top\.document/u)
  assert.doesNotMatch(frame.srcDoc, /unsafe-eval/u)
})

test('wraps legacy parent input controls in a data-origin compatibility shell', () => {
  const inner = compileCardFrameDocument(`<!doctype html><html><body><button id="forge">发送</button><script>
    document.getElementById('forge').addEventListener('click', () => {
      const input = window.parent.document.querySelector('#send_textarea')
      input.value = '开始剧情'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      window.parent.document.querySelector('#send_but').click()
    })
  </script></body></html>`, {
    origin: 'http://127.0.0.1:3091', capabilityToken: 'registered-frame',
  })
  const url = cardFrameCompatibilityUrl(inner, 'registered-frame')
  const shell = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8')

  assert.match(url, /^data:text\/html;charset=utf-8;base64,/u)
  assert.match(shell, /id="chat"/u)
  assert.match(shell, /id="send_textarea"/u)
  assert.match(shell, /id="send_but"/u)
  assert.match(shell, /card\.srcdoc=source/u)
  assert.match(shell, /parent\.document\.querySelector\('#send_textarea'\)/u)
  assert.match(shell, /capability:'chat\.send'/u)
  assert.match(shell, /event\.source===card\.contentWindow/u)
  assert.match(shell, /event\.source!==parent/u)
  assert.doesNotMatch(shell, /allow-top-navigation|allow-popups|allow-forms/u)
})

test('exposes implemented prompt-template support and bounded successful script markers', () => {
  const source = compileCardFrameDocument('<!doctype html><html><body>panel</body></html>', {
    origin: 'http://127.0.0.1:3091',
    compatibilityMarkers: [
      '__辅助计算脚本_loaded__',
      '__辅助计算脚本_loaded__',
      '__invalid marker_loaded__',
      'not-a-marker',
    ],
  })

  assert.match(source, /extensionSettings:\{EjsTemplate:\{enabled:true\}\}/u)
  assert.match(source, /var __dshCompatibilityMarkers=\["__辅助计算脚本_loaded__"\]/u)
  assert.doesNotMatch(source, /invalid marker/u)
})

test('projects identity macros into status data without changing the stored value', () => {
  const statData = {
    activity: '刚洗完澡，看见{{user}}',
    nested: ['{{char}}递给<user>一封信'],
  }
  const source = compileCardFrameDocument('<!doctype html><html><body>panel</body></html>', {
    origin: 'http://127.0.0.1:3091',
    statData,
    identity: { characterName: '白露', userName: '旅人' },
  })

  assert.match(source, /var __dshStatData=\{"activity":"刚洗完澡，看见旅人","nested":\["白露递给旅人一封信"\]\}/u)
  assert.equal(statData.activity, '刚洗完澡，看见{{user}}')
})

test('projects only the current card scripts into the isolated SillyTavern character facade', () => {
  const source = compileCardFrameDocument(`<!doctype html><html><head><meta name="card-head-marker"></head><body><script>
    const getGlobal = key => window[key] || window.parent?.[key] || window.top?.[key]
  </script></body></html>`, {
    origin: 'http://127.0.0.1:3091',
    currentCharacter: {
      name: '投影角色',
      tavernHelperScripts: [{
        id: 'schema', name: '状态结构',
        content: "const StateSchema = z.object({}); const marker = '$__META_EXTENSIBLE__$'",
        info: '', enabled: true,
        buttonEnabled: false, buttons: [], data: {},
      }],
    },
  })

  assert.match(source, /var __dshCurrentCharacter=\{"name":"投影角色","tavernHelperScripts":\[/u)
  assert.match(source, /window\.SillyTavern=\{[^;]*characters:__dshCardCharacters/u)
  assert.match(source, /Object\.defineProperty\(window,'characters'.*value:__dshCardCharacters/u)
  assert.match(source, /Object\.defineProperty\(window,'this_chid'.*value:0/u)
  assert.match(source, /const getGlobal = key => window\[key\] \|\| window\[key\] \|\| window\[key\]/u)
  assert.doesNotMatch(source, /window\.parent\?\.\[key\]|window\.top\?\.\[key\]/u)
  assert.doesNotMatch(source, /description|scenario|alternate_greetings/u)
  assert.equal(source.match(/name="card-head-marker"/gu)?.length, 1)
})

test('exposes only card-owned greeting choices through the isolated chat facade', () => {
  const source = compileCardFrameDocument('<!doctype html><html><body>panel</body></html>', {
    origin: 'http://127.0.0.1:3091',
    greetingChoices: {
      selected: '封面开场',
      alternatives: ['封面开场', '剧情开场'],
    },
    capabilityToken: 'registered-frame',
  })

  assert.match(source, /var __dshCardGreetingChoices=\{"selected":"封面开场","alternatives":\["封面开场","剧情开场"\]\}/u)
  assert.match(source, /action:'capability-request'/u)
  assert.match(source, /capability:'greeting\.select'/u)
  assert.match(source, /capability:'chat\.send'/u)
  assert.match(source, /send\.id='send_but'/u)
  assert.match(source, /window\.sendMessage=__dshCardSendMessage/u)
  assert.match(source, /action!=='capability-result'/u)
  assert.match(source, /var __dshCardCapabilityToken="registered-frame"/u)
  assert.match(source, /window\.getCurrentMessageId=function\(\)\{return __dshCardCurrentMessageId\}/u)
  assert.match(source, /window\.getVariables=/u)
  assert.match(source, /window\.insertOrAssignVariables=/u)
  assert.match(source, /action:'variables-replace'/u)
  assert.match(source, /window\.open=__dshCardOpenExternalWindow/u)
  assert.match(source, /capability:'ui\.external-window\.open'/u)
  assert.match(source, /window\.dshIdentity=Object\.freeze/u)
  assert.match(source, /window\.DshIdentity=window\.dshIdentity/u)
  assert.match(source, /capability:'identity\.native\.attest'/u)
  assert.match(source, /card-native-identity-/u)
  assert.match(source, /dsh-agent-rp:identity/u)
  assert.match(source, /__dshEmbeddedIdentityFrameOrigin/u)
  assert.match(source, /action==='external-window-message'/u)
  assert.match(source, /action:'external-window-delivered'/u)
  assert.match(source, /__dshCardDeliveredExternalWindowRequests/u)
  assert.match(source, /agentRpCapabilityState/u)
  assert.match(source, /开场切换超时/u)
  assert.match(source, /Object\.defineProperty\(window,'localStorage'/u)
  assert.match(source, /value\.length>2097152/u)
  assert.doesNotMatch(source, /writeFile|parent\.localStorage|top\.localStorage|document\.cookie/u)
})

test('returns isolated card chat messages synchronously', () => {
  const original: CardChatFixtureMessage = {
    extra: { source: 'greeting' },
    is_user: false,
    mes: '合成开场',
    message: '合成开场',
    swipes: ['合成开场', '另一个开场'],
  }
  const runtime = runCardActionOptionsFixture(original)
  const first = runtime.getChatMessages()
  const second = runtime.getChatMessages()

  assert.equal(Array.isArray(first), true)
  assert.equal(typeof (first as { then?: unknown }).then, 'undefined')
  assert.notEqual(first, second)
  assert.notEqual(first[0], second[0])
  assert.notEqual(first[0]?.extra, second[0]?.extra)
  assert.notEqual(first[0]?.swipes, second[0]?.swipes)

  first.push({ ...original, extra: {}, swipes: [] })
  first[0]!.message = '调用者改写正文'
  first[0]!.mes = '调用者改写正文'
  first[0]!.extra.source = 'caller'
  first[0]!.swipes[0] = '调用者改写开场'

  const unchanged = runtime.getChatMessages()
  assert.equal(unchanged.length, 1)
  assert.equal(unchanged[0]?.message, original.message)
  assert.equal(unchanged[0]?.mes, original.mes)
  assert.deepEqual({ ...unchanged[0]?.extra }, original.extra)
  assert.deepEqual([...(unchanged[0]?.swipes ?? [])], original.swipes)
})

test('renders action options from the current assistant message in a visible chat snapshot', () => {
  const runtime = runCardActionOptionsSnapshotFixture()

  assert.equal(runtime.currentMessageId(), 2)
  assert.equal(runtime.lastMessageId(), 2)
  const messages = runtime.getChatMessages()
  assert.deepEqual(Array.from(messages, message => ({
    message_id: message.message_id,
    role: message.role,
  })), [
    { message_id: 0, role: 'assistant' },
    { message_id: 1, role: 'user' },
    { message_id: 2, role: 'assistant' },
  ])
  assert.match(messages[0]!.message, /开场剧情/u)
  assert.equal(messages[1]!.message, '继续调查。')
  assert.match(messages[2]!.message, /第二轮剧情/u)
  assert.deepEqual(runtime.document.options.children.map(child => child.textContent), [
    '查看第二轮环境',
    '询问第二轮人物',
    '检查第二轮线索',
    '元指令:推进第二轮时间。',
  ])
})

test('renders four synthetic JSONPatch action options from the synchronous card chat facade', () => {
  const message = [
    '合成剧情正文。',
    '<JSONPatch>',
    '[',
    '  {"op":"replace","path":"/行动选项/0","value":"调查窗边声响"},',
    '  {"op":"replace","path":"/行动选项/1","value":"查看桌上信件"},',
    '  {"op":"replace","path":"/行动选项/2","value":"询问同行伙伴"},',
    '  {"op":"replace","path":"/行动选项/3","value":"安静等待片刻"}',
    ']',
    '</JSONPatch>',
  ].join('\n')
  const runtime = runCardActionOptionsFixture({
    extra: {}, is_user: false, mes: message, message, swipes: [message],
  })

  assert.equal(runtime.document.documentElement.dataset.actionOptionsMessages, 'array')
  assert.equal(runtime.document.documentElement.dataset.actionOptionsState, 'ready')
  assert.equal(runtime.document.missing.hidden, true)
  assert.deepEqual(runtime.document.options.children.map(child => child.textContent), [
    '调查窗边声响',
    '查看桌上信件',
    '询问同行伙伴',
    '安静等待片刻',
  ])
  assert.deepEqual(runtime.document.options.children.map(child => child.type), [
    'button', 'button', 'button', 'button',
  ])
})

test('keeps the synthetic action-options missing state without a valid JSONPatch', () => {
  const runtime = runCardActionOptionsFixture({
    extra: {}, is_user: false, mes: '没有状态补丁的合成剧情。',
    message: '没有状态补丁的合成剧情。', swipes: [],
  })

  assert.equal(runtime.document.documentElement.dataset.actionOptionsMessages, 'array')
  assert.equal(runtime.document.documentElement.dataset.actionOptionsState, 'missing')
  assert.equal(runtime.document.missing.hidden, false)
  assert.deepEqual(runtime.document.options.children, [])
})

test('accepts only authenticated audience-bound native identity requests from light frontends', () => {
  const request = {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'identity.native.attest',
    token: 'frame-token:0', requestId: 'card-native-identity-1',
    payload: {
      audience: 'https://workshop.example.test', nonce: 'abcdefghijklmnop', includeDisplayName: true,
    },
  } as const
  assert.deepEqual(parseCardNativeIdentityCapabilityRequest(request), {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'identity.native.attest',
    token: 'frame-token:0', requestId: 'card-native-identity-1',
    audience: 'https://workshop.example.test', nonce: 'abcdefghijklmnop', includeDisplayName: true,
  })
  for (const invalid of [
    { ...request, requestId: 'card-native-identity-0' },
    { ...request, payload: { ...request.payload, audience: 'http://workshop.example.test' } },
    { ...request, payload: { ...request.payload, audience: 'https://workshop.example.test/path' } },
    { ...request, payload: { ...request.payload, nonce: 'short' } },
    { ...request, payload: { ...request.payload, privateCardText: 'not accepted' } },
    { ...request, privateCardText: 'not accepted' },
  ]) assert.equal(parseCardNativeIdentityCapabilityRequest(invalid), undefined)
})

test('accepts only authenticated HTTPS external-window requests from light frontends', () => {
  const request = {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'ui.external-window.open',
    token: 'frame-token:0', requestId: 'card-external-window-1',
    payload: { url: 'https://discord.com/oauth2/authorize?client_id=1', target: '_blank', features: 'popup' },
  } as const
  assert.deepEqual(parseCardExternalWindowCapabilityRequest(request), {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'ui.external-window.open',
    token: 'frame-token:0', requestId: 'card-external-window-1',
    url: 'https://discord.com/oauth2/authorize?client_id=1', target: '_blank', features: 'popup',
  })
  assert.equal(parseCardExternalWindowCapabilityRequest({
    ...request, payload: { ...request.payload, url: 'http://discord.com/oauth2/authorize' },
  }), undefined)
  assert.equal(parseCardExternalWindowCapabilityRequest({
    ...request, payload: { ...request.payload, url: 'https://user:secret@discord.com/oauth2/authorize' },
  }), undefined)
  assert.equal(parseCardExternalWindowCapabilityRequest({ ...request, requestId: 'card-external-window-0' }), undefined)
  assert.equal(parseCardExternalWindowCapabilityRequest({ ...request, cardText: 'private' }), undefined)

  assert.deepEqual(parseCardExternalWindowControlRequest({
    source: 'dsh-agent-rp-card', action: 'external-window-focus', token: 'frame-token:0',
    requestId: 'card-external-window-1',
  }), {
    source: 'dsh-agent-rp-card', action: 'external-window-focus', token: 'frame-token:0',
    requestId: 'card-external-window-1',
  })
  assert.equal(parseCardExternalWindowControlRequest({
    source: 'dsh-agent-rp-card', action: 'external-window-navigate', token: 'frame-token:0',
    requestId: 'card-external-window-1',
  }), undefined)
  assert.deepEqual(parseCardExternalWindowDeliveryReport({
    source: 'dsh-agent-rp-card', action: 'external-window-delivered', token: 'frame-token:0',
    requestId: 'card-external-window-1',
  }), {
    source: 'dsh-agent-rp-card', action: 'external-window-delivered', token: 'frame-token:0',
    requestId: 'card-external-window-1',
  })
  assert.equal(parseCardExternalWindowDeliveryReport({
    source: 'dsh-agent-rp-card', action: 'external-window-delivered', token: 'frame-token:0',
    requestId: 'card-external-window-1', result: 'private',
  }), undefined)
  assert.equal(validExternalWindowMessage(
    'card-frame-v0', 'https://workshop.example.test', { action: 'discordLoginSuccess', hash: 'bounded' },
  ), true)
  assert.equal(validExternalWindowMessage(
    'card-frame-v0', 'https://workshop.example.test', { action: 'discordLoginSuccess', hash: '猫'.repeat(70_000) },
  ), false)
})

test('accepts only bounded registered variable replacements from light frontends', () => {
  for (const scope of ['global', 'preset', 'character', 'chat', 'message'] as const) {
    assert.deepEqual(parseCardVariableReplaceRequest({
      source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
      requestId: 'card-variables-1', scope, variables: { presets: { active: true } },
    }), {
      source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
      requestId: 'card-variables-1', scope, variables: { presets: { active: true } },
    })
  }
  assert.equal(parseCardVariableReplaceRequest({
    source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
    requestId: 'card-variables-1', scope: 'script', variables: {},
  }), undefined)
  assert.equal(parseCardVariableReplaceRequest({
    source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
    requestId: 'card-variables-1', scope: 'character', variables: {}, operation: 'delete-session',
  }), undefined)
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.equal(parseCardVariableReplaceRequest({
    source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
    requestId: 'card-variables-1', scope: 'character', variables: cyclic,
  }), undefined)

  const limit = AGENT_RP_CAPABILITIES['session.variables.replace']
    .runtimePolicies['card-frame-v0'].requestBytes
  const emptyRequest = {
    source: 'dsh-agent-rp-card', action: 'variables-replace', token: 'frame-token:0',
    requestId: 'card-variables-1', scope: 'chat', variables: { payload: '' },
  } as const
  const atLimit = {
    ...emptyRequest,
    variables: { payload: 'a'.repeat(limit - Buffer.byteLength(JSON.stringify(emptyRequest))) },
  }
  assert.equal(Buffer.byteLength(JSON.stringify(atLimit)), limit)
  assert.notEqual(parseCardVariableReplaceRequest(atLimit), undefined)
  assert.equal(parseCardVariableReplaceRequest({
    ...atLimit, variables: { payload: `${atLimit.variables.payload}a` },
  }), undefined)
})

test('accepts only bounded registered greeting capability requests', () => {
  assert.deepEqual(parseCardCapabilityRequest({
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'greeting.select',
    token: 'frame-token:0', requestId: 'card-capability-1', playerAction: true, greetingIndex: 1,
  }), {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'greeting.select',
    token: 'frame-token:0', requestId: 'card-capability-1', playerAction: true, greetingIndex: 1,
  })
  assert.equal(parseCardCapabilityRequest({
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'chat.write',
    token: 'frame-token:0', requestId: 'card-capability-1', greetingIndex: 1,
  }), undefined)
  assert.equal(parseCardCapabilityRequest({
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'session.variables.replace',
    token: 'frame-token:0', requestId: 'card-capability-1', greetingIndex: 1,
  }), undefined)
  assert.equal(parseCardCapabilityRequest({
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'greeting.select',
    token: 'frame-token:0', requestId: 'card-capability-1', greetingIndex: 1, value: '任意正文',
  }), undefined)
  assert.equal(parseCardCapabilityRequest({
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'greeting.select',
    token: 'frame token', requestId: 'card-capability-0', greetingIndex: -1,
  }), undefined)
})

test('accepts only bounded registered player chat sends', () => {
  const request = {
    source: 'dsh-agent-rp-card', action: 'capability-request', capability: 'chat.send',
    token: 'frame-token:0', requestId: 'card-chat-send-1', playerAction: true, value: '签订契约并开始',
  } as const
  assert.deepEqual(parseCardChatSendCapabilityRequest(request), request)
  assert.equal(parseCardChatSendCapabilityRequest({ ...request, value: '' }), undefined)
  assert.equal(parseCardChatSendCapabilityRequest({ ...request, requestId: 'card-chat-send-0' }), undefined)
  assert.equal(parseCardChatSendCapabilityRequest({ ...request, value: '猫'.repeat(30_000) }), undefined)
  assert.equal(parseCardChatSendCapabilityRequest({ ...request, playerAction: false }), undefined)
  const { playerAction: _playerAction, ...unstamped } = request
  assert.equal(parseCardChatSendCapabilityRequest(unstamped), undefined)
})

test('accepts only bounded HTTPS resource reports from registered frame tokens', () => {
  assert.deepEqual(parseCardResourceBlockedReport({
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://cdn.example.com/path?q=1', type: 'script',
  }), {
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://cdn.example.com', type: 'script',
  })
  assert.equal(parseCardResourceBlockedReport({
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'http://cdn.example.com', type: 'script',
  }), undefined)
  assert.equal(parseCardResourceBlockedReport({
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://cdn.example.com', type: 'document',
  }), undefined)
  assert.deepEqual(parseCardResourceBlockedReport({
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://workshop.example.com/embed', type: 'frame',
  }), {
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://workshop.example.com', type: 'frame',
  })
  assert.equal(parseCardResourceBlockedReport({
    source: 'dsh-agent-rp-card', action: 'resource-blocked', token: 'frame-token:0',
    origin: 'https://cdn.example.com', type: 'script', cardText: 'private',
  }), undefined)
})

test('accepts only content-free registered light-frontend lifecycle reports', () => {
  assert.deepEqual(parseCardRuntimeReport({
    source: 'dsh-agent-rp-card', action: 'runtime-monitor', token: 'frame-token:0', value: 'content-present',
  }), {
    source: 'dsh-agent-rp-card', action: 'runtime-monitor', token: 'frame-token:0', value: 'content-present',
  })
  assert.equal(parseCardRuntimeReport({
    source: 'dsh-agent-rp-card', action: 'runtime-monitor', token: 'frame-token:0', value: 'mounted',
  }), undefined)
  assert.equal(parseCardRuntimeReport({
    source: 'dsh-agent-rp-card', action: 'runtime-monitor', token: 'frame-token:0', value: 'runtime-error',
    message: 'private card source',
  }), undefined)
})

test('derives a distinct registered token for each frontend frame', () => {
  const frames = compileCardFrames(compileCharacterDisplay([
    '```html', '<!doctype html><html><body>one</body></html>', '```',
    'middle',
    '```html', '<!doctype html><html><body>two</body></html>', '```',
  ].join('\n')), { origin: 'http://127.0.0.1:3091', capabilityToken: 'mount-token' })

  assert.equal(frames.segments[0]?.kind, 'frame')
  assert.equal(frames.segments[1]?.kind, 'markdown')
  assert.equal(frames.segments[2]?.kind, 'frame')
  assert.match(frames.segments[0]?.kind === 'frame' ? frames.segments[0].srcDoc : '', /"mount-token:0"/u)
  assert.match(frames.segments[2]?.kind === 'frame' ? frames.segments[2].srcDoc : '', /"mount-token:2"/u)
})

test('allows only explicitly approved card resource origins in the frame CSP', () => {
  const source = '<!doctype html><html><body><script>fetch("https://app.example.com/view")</script><iframe src="https://workshop.example.com/embed"></iframe></body></html>'
  assert.deepEqual(cardRemoteResourceRequirements(source), [
    { origin: 'https://app.example.com', type: 'connect' },
    { origin: 'https://workshop.example.com', type: 'frame' },
  ])
  const blocked = compileCardFrameDocument(source, { origin: 'http://127.0.0.1:3091' })
  const approved = compileCardFrameDocument(source, {
    origin: 'http://127.0.0.1:3091',
    character: {
      id: 'character-test', approvedRemoteResourceOrigins: [],
      approvedRemoteResources: [
        { origin: 'https://app.example.com', type: 'connect' },
        { origin: 'https://workshop.example.com', type: 'frame' },
      ],
      displayExtensions: [], imageAssets: [],
    } as never,
  })
  assert.match(blocked, /connect-src 'none'/u)
  assert.match(approved, /connect-src https:\/\/app\.example\.com/u)
  assert.match(approved, /frame-src https:\/\/workshop\.example\.com/u)
  assert.doesNotMatch(approved, /script-src 'unsafe-inline' https:\/\/app\.example\.com/u)
  assert.match(approved, /action:'resource-blocked'/u)
  assert.match(approved, /securitypolicyviolation/u)
  assert.match(approved, /Document\.prototype\.open/u)
  assert.match(approved, /__dshInstallCardResourceListener/u)
  assert.match(approved, /action:'runtime-monitor'/u)
  assert.match(approved, /content-present/u)
  assert.match(approved, /document-restored/u)
})

test('classifies static light-frontend CSS, responsive images, media, and module resources', () => {
  const source = String.raw`
<link rel="icon" href="https://icons.example.com/app.png">
<link rel="preload" as="font" href="https://preload-font.example.com/ui.woff2">
<style>
@import url("https://styles.example.com/theme.css");
@font-face { font-family: UI; src: url("https://fonts.example.com/ui.woff2") format("woff2"); }
.cover { background-image: url("https://background.example.com/cover.webp"); }
</style>
<div style="background:url('https://inline.example.com/panel.png')"></div>
<img srcset="https://responsive.example.com/small.webp 1x, https://responsive.example.com/large.webp 2x">
<video poster="https://poster.example.com/poster.webp"><source src="https://media.example.com/intro.mp4"></video>
<script type="module">
import helper from "https://module.example.com/helper.js";
new EventSource("https://events.example.com/stream");
</script>`
  assert.deepEqual(cardRemoteResourceRequirements(source), [
    { origin: 'https://background.example.com', type: 'image' },
    { origin: 'https://events.example.com', type: 'connect' },
    { origin: 'https://fonts.example.com', type: 'font' },
    { origin: 'https://icons.example.com', type: 'image' },
    { origin: 'https://inline.example.com', type: 'image' },
    { origin: 'https://media.example.com', type: 'media' },
    { origin: 'https://module.example.com', type: 'script' },
    { origin: 'https://poster.example.com', type: 'image' },
    { origin: 'https://preload-font.example.com', type: 'font' },
    { origin: 'https://responsive.example.com', type: 'image' },
    { origin: 'https://styles.example.com', type: 'style' },
  ])
})

test('keeps a mixed-version Host response from blanking the card display', () => {
  const resources = [
    { origin: 'https://app.example.com', type: 'script' as const },
    { origin: 'https://cdn.example.com', type: 'image' as const },
  ]

  assert.deepEqual(blockedCardFrameResources(resources, {}), resources)
  assert.deepEqual(blockedCardFrameResources(resources, {
    approvedRemoteResourceOrigins: ['https://cdn.example.com'],
  }), [{ origin: 'https://app.example.com', type: 'script' }])
  assert.deepEqual(blockedCardFrameResources(resources, {
    approvedRemoteResources: [{ origin: 'https://cdn.example.com', type: 'image' }],
  }), [{ origin: 'https://app.example.com', type: 'script' }])
})

test('allows a player to persist broad HTTPS loading only inside one card sandbox', () => {
  const source = compileCardFrameDocument('<!doctype html><html><body>panel</body></html>', {
    origin: 'http://127.0.0.1:3091',
    character: {
      id: 'character-test', approvedRemoteResourceOrigins: [], approvedRemoteResources: [],
      remoteResourcePolicy: 'isolated-https', displayExtensions: [], imageAssets: [],
    } as never,
  })

  assert.match(source, /img-src data: blob: http:\/\/127\.0\.0\.1:3091 https:/u)
  assert.match(source, /script-src 'unsafe-inline' 'unsafe-eval' https:/u)
  assert.match(source, /style-src 'unsafe-inline' https:/u)
  assert.match(source, /connect-src https:/u)
  assert.match(source, /font-src https:/u)
  assert.match(source, /frame-src https:/u)
  assert.deepEqual(blockedCardFrameResources([
    { origin: 'https://runtime.example.com', type: 'script' },
  ], { remoteResourcePolicy: 'isolated-https' }), [])
})

test('recognizes a complete frontend document mislabeled as fenced text', () => {
  const source = [
    '```text',
    '<!doctype html><html><head><style>body{margin:0}</style></head><body>panel</body></html>',
    '```',
  ].join('\n')
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{
    kind: 'html',
    source: '<!doctype html><html><head><style>body{margin:0}</style></head><body>panel</body></html>\n',
  }])
  assert.deepEqual(compiled.diagnostics, [{ code: 'frontend-document', count: 1 }])
})

test('keeps an ordinary HTML snippet in a fenced text sample inert', () => {
  const source = '```text\n<div>example markup</div>\n```'
  const compiled = compileCharacterDisplay(source)

  assert.deepEqual(compiled.segments, [{ kind: 'markdown', text: source }])
  assert.deepEqual(compiled.diagnostics, [])
})
