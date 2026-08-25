import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import type { ImportedRegexScript } from '../src/import/types.ts'
import {
  resolveTavernScriptExecution,
  parseTavernResourceBlockedReport,
  shouldResetTavernScriptRuntime,
  TavernScriptOriginApprovalError,
  tavernScriptFrameNavigation,
  tavernScriptFrameSource,
  tavernScriptFrameUrl,
  tavernScriptRuntimePhase,
  validatedTavernCompatibilityMarkers,
  type TavernScriptSnapshot,
} from '../src/client/tavern-runtime.ts'
import { parseTavernSlashCommand } from '../src/client/tavern-slash.ts'
import {
  parseTavernExternalWindowCapabilityRequest,
  parseTavernExtensionSettingsCapabilityRequest,
  parseTavernNativeIdentityCapabilityRequest,
  parseTavernPopupCapabilityRequest,
  parseTavernStorageCapabilityRequest,
  validTavernStorageCapabilityResult,
} from '../src/client/tavern-capability.ts'
import { validExternalWindowMessage } from '../src/client/external-window.ts'
import { inspectTavernPreflight } from '../src/tavern-preflight.ts'
import {
  approvedTavernScriptOrigins,
  parseTavernScriptOriginApprovalKey,
  pendingTavernScriptResourcePermissions,
  tavernResourcePreflightApprovals,
  tavernPreflightApprovals,
  tavernPreflightLaunchPhase,
  tavernPermissionPlan,
  tavernPermissionOwnerId,
  tavernScriptFrameApprovalKey,
  tavernScriptFontApprovalKey,
  tavernScriptImageApprovalKey,
  tavernScriptInteractionApprovalKey,
  tavernScriptOriginApprovalKey,
  tavernScriptStyleApprovalKey,
  summarizeTavernPermissionPlan,
} from '../src/client/tavern-permission.ts'
import {
  AI_OUTPUT_PLACEMENT,
  hasCharacterDisplayFrontend,
  normalizeSillyTavernMarkdown,
  renderCharacterDisplay,
  renderCharacterPromptView,
  splitCharacterDisplay,
  summarizeCharacterRegexScript,
  traceCharacterPromptView,
  withCurrentCharacterDisplayScripts,
  USER_INPUT_PLACEMENT,
} from '../src/frontend-regex.ts'
import { createRoleplayDisplayPlanner } from '../src/roleplay-display-plan.ts'

const base: ImportedRegexScript = {
  scriptName: 'script',
  findRegex: '/old/gu',
  replaceString: 'new',
  trimStrings: [],
  placement: [AI_OUTPUT_PLACEMENT],
  disabled: false,
  markdownOnly: true,
  promptOnly: false,
  runOnEdit: false,
  substituteRegex: 0,
  minDepth: null,
  maxDepth: null,
}

const character = {
  name: '白露',
  frontend: { regexScripts: [base], tavernHelperScriptNames: [], tavernHelperScripts: [], tavernHelperVariables: {} },
}

test('keeps unrelated Tavern scripts ready when only image approvals change', () => {
  const scope = { sessionId: 'session-a', planSignature: 'scripts-a' }
  assert.equal(shouldResetTavernScriptRuntime(undefined, scope), true)
  assert.equal(shouldResetTavernScriptRuntime(scope, { ...scope }), false)
  assert.equal(shouldResetTavernScriptRuntime(scope, { ...scope, sessionId: 'session-b' }), true)
  assert.equal(shouldResetTavernScriptRuntime(scope, { ...scope, planSignature: 'scripts-b' }), true)
})

test('reports content-free Tavern script lifecycle phases for browser acceptance', () => {
  assert.equal(tavernScriptRuntimePhase({
    hasDocument: false, permissionRequired: false, loadError: false, ready: false, runtimeError: false,
  }), 'preparing')
  assert.equal(tavernScriptRuntimePhase({
    hasDocument: false, permissionRequired: true, loadError: true, ready: false, runtimeError: false,
  }), 'permission-required')
  assert.equal(tavernScriptRuntimePhase({
    hasDocument: false, permissionRequired: false, loadError: true, ready: false, runtimeError: false,
  }), 'load-error')
  assert.equal(tavernScriptRuntimePhase({
    hasDocument: true, permissionRequired: false, loadError: false, ready: false, runtimeError: false,
  }), 'booting')
  assert.equal(tavernScriptRuntimePhase({
    hasDocument: true, permissionRequired: false, loadError: false, ready: true, runtimeError: false,
  }), 'ready')
  assert.equal(tavernScriptRuntimePhase({
    hasDocument: true, permissionRequired: false, loadError: false, ready: true, runtimeError: true,
  }), 'runtime-error')
})

test('accepts only bounded, exact-origin Tavern CSP resource reports', () => {
  const valid = {
    source: 'dsh-agent-rp-tavern-script', action: 'resource-blocked', scriptId: 'phone',
    origin: 'https://styles.example.test', type: 'style',
  }
  assert.deepEqual(parseTavernResourceBlockedReport(valid), valid)
  for (const value of [
    { ...valid, origin: 'http://styles.example.test' },
    { ...valid, origin: 'https://user:secret@styles.example.test' },
    { ...valid, origin: 'https://styles.example.test/theme.css' },
    { ...valid, type: 'worker' },
    { ...valid, privateSource: 'must not be accepted' },
    { ...valid, scriptId: '' },
    { ...valid, scriptId: 'x'.repeat(513) },
  ]) assert.equal(parseTavernResourceBlockedReport(value), undefined)
})

test('summarizes character regex compatibility without exposing its source', () => {
  assert.deepEqual(summarizeCharacterRegexScript(base), {
    scriptName: 'script',
    enabled: true,
    state: 'active',
    placement: [AI_OUTPUT_PLACEMENT],
    unsupportedPlacement: [],
    display: true,
    prompt: false,
    runOnEdit: false,
    minDepth: null,
    maxDepth: null,
  })
  assert.equal(summarizeCharacterRegexScript({ ...base, placement: [AI_OUTPUT_PLACEMENT, 5] }).state, 'partial')
  assert.equal(summarizeCharacterRegexScript({ ...base, placement: [5] }).state, 'unsupported')
  assert.equal(summarizeCharacterRegexScript({ ...base, findRegex: '/[/' }).state, 'invalid')
  assert.equal(summarizeCharacterRegexScript({ ...base, disabled: true }).state, 'disabled')
})

test('renders plain Markdown replacements for user-message display rules', () => {
  const userRule = { ...base, placement: [USER_INPUT_PLACEMENT], replaceString: '**new**' }
  const rendered = renderCharacterDisplay('old', {
    ...character,
    frontend: { ...character.frontend, regexScripts: [userRule] },
  }, USER_INPUT_PLACEMENT)
  assert.equal(rendered, '**new**')
  assert.deepEqual(splitCharacterDisplay(rendered), [{ kind: 'markdown', text: '**new**' }])
})

test('supports SillyTavern full-match replacement aliases', () => {
  const card = { ...character, frontend: { ...character.frontend, regexScripts: [] } }
  for (const alias of ['$&', '$0', '{{match}}']) {
    const script = {
      ...base,
      findRegex: '/藤子/gu',
      replaceString: `<span style="color:#d9b36c">${alias}</span>`,
    }
    assert.equal(
      renderCharacterDisplay('你好，藤子。', card, AI_OUTPUT_PLACEMENT, 0, '宝宝', [script]),
      '你好，<span style="color:#d9b36c">藤子</span>。',
    )
  }
})

test('uses current library display rules without changing Session prompt behavior', () => {
  const sessionDisplay = { ...base, scriptName: '旧显示', findRegex: 'old', replaceString: 'stale' }
  const ordinary = { ...base, scriptName: '双向规则', markdownOnly: false, findRegex: 'seed', replaceString: 'old' }
  const currentDisplay = {
    ...base,
    scriptName: '隐藏<details>',
    findRegex: '<details[^>]*>[\\s\\S]*?<\\/details>',
    replaceString: '111',
    placement: [USER_INPUT_PLACEMENT, AI_OUTPUT_PLACEMENT],
    runOnEdit: true,
  }
  const frontend = withCurrentCharacterDisplayScripts({
    ...character.frontend,
    regexScripts: [ordinary, sessionDisplay],
  }, [currentDisplay])
  const currentCharacter = { ...character, frontend }

  assert.equal(renderCharacterDisplay('seed', currentCharacter, AI_OUTPUT_PLACEMENT), 'old')
  assert.equal(renderCharacterDisplay(
    '<details><summary>后台日志</summary>秘密状态</details>',
    currentCharacter,
    AI_OUTPUT_PLACEMENT,
  ), '111')
  assert.equal(renderCharacterPromptView('seed', currentCharacter, AI_OUTPUT_PLACEMENT), 'old')
  assert.equal(renderCharacterPromptView('old', currentCharacter, AI_OUTPUT_PLACEMENT), 'old')
})

test('uses current library display rules for an already-generated reply', () => {
  const currentDisplay = { ...base, replaceString: 'current' }
  const planner = createRoleplayDisplayPlanner({
    projection: {
      characterName: character.name,
      tavern: { messages: [{ messageId: 0, seq: 10, role: 'assistant', text: 'old', isHidden: false }] },
      generations: [{
        anchorSeq: 10, selectedVersionSeq: 10, assistantSeqs: [10], versions: [{ seq: 10, text: 'old' }],
      }],
    },
    frontend: withCurrentCharacterDisplayScripts(character.frontend, [currentDisplay]),
    immersive: true,
    overrides: new Map(),
  })
  const plan = planner.assistant({ finalSeq: 10, blockText: 'old' })
  assert.equal(plan.kind, 'render')
  if (plan.kind !== 'render') return
  assert.deepEqual(plan.compilation.segments, [{ kind: 'markdown', text: 'current' }])
})

test('parses Tavern send and trigger pipelines without leaking commands into chat', () => {
  assert.deepEqual(parseTavernSlashCommand('/send 选择A || /trigger'), { kind: 'send', text: '选择A' })
  assert.deepEqual(parseTavernSlashCommand('/send 选择B |/trigger'), { kind: 'send', text: '选择B' })
  assert.deepEqual(parseTavernSlashCommand('/send 选择C||/trigger  '), { kind: 'send', text: '选择C' })
  assert.deepEqual(parseTavernSlashCommand('/send 普通消息'), { kind: 'send', text: '普通消息' })
})

test('distinguishes Tavern draft updates, triggered drafts, and a bare trigger', () => {
  assert.deepEqual(parseTavernSlashCommand('/setinput 暂存内容'), {
    kind: 'set-input', text: '暂存内容', trigger: false,
  })
  assert.deepEqual(parseTavernSlashCommand('/setinput 立即发送 | /trigger'), {
    kind: 'set-input', text: '立即发送', trigger: true,
  })
  assert.deepEqual(parseTavernSlashCommand('/trigger'), { kind: 'trigger' })
  assert.equal(parseTavernSlashCommand('/echo 未支持'), undefined)
})

class RuntimeElement {
  readonly attributes = new Map<string, string>()
  readonly children: RuntimeElement[] = []
  private readonly classes = new Set<string>()
  readonly classList = {
    add: (...names: string[]) => { for (const name of names) this.classes.add(name) },
    remove: (...names: string[]) => { for (const name of names) this.classes.delete(name) },
    toggle: (name: string, force?: boolean) => {
      const enabled = force ?? !this.classes.has(name)
      if (enabled) this.classes.add(name)
      else this.classes.delete(name)
      return enabled
    },
    contains: (name: string) => this.classes.has(name),
  }
  readonly dataset: Record<string, string> = {}
  readonly style = { setProperty() {} }
  readonly tagName: string
  contentWindow: object | undefined
  hidden = false
  id = ''
  innerHTML = ''
  parentElement: RuntimeElement | undefined
  textContent = ''
  private readonly listeners = new Map<string, Set<(event: {
    currentTarget?: RuntimeElement
    readonly target?: RuntimeElement
    readonly type: string
  }) => void>>()

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase()
  }

  appendChild(child: RuntimeElement): RuntimeElement {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  append(...children: RuntimeElement[]): void {
    for (const child of children) child.parentElement = this
    this.children.push(...children)
  }
  prepend(...children: RuntimeElement[]): void {
    for (const child of children) child.parentElement = this
    this.children.unshift(...children)
  }
  insertBefore(child: RuntimeElement): RuntimeElement { return this.appendChild(child) }
  addEventListener(type: string, listener: (event: {
    currentTarget?: RuntimeElement
    readonly target?: RuntimeElement
    readonly type: string
  }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type: string, listener: (event: {
    currentTarget?: RuntimeElement
    readonly target?: RuntimeElement
    readonly type: string
  }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }
  dispatchEvent(event: { currentTarget?: RuntimeElement; target?: RuntimeElement; readonly type: string }): boolean {
    event.currentTarget = this
    event.target ??= this
    for (const listener of this.listeners.get(event.type) ?? []) listener(event)
    return true
  }
  click(): void {
    this.dispatchEvent({ target: this, type: 'click' })
  }
  getBoundingClientRect(): { readonly height: number; readonly left: number; readonly top: number; readonly width: number } {
    return { height: 40, left: 20, top: 30, width: 40 }
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
    if (name === 'hidden') this.hidden = false
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
    if (name === 'id') this.id = value
    if (name === 'hidden') this.hidden = true
  }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  querySelectorAll(): RuntimeElement[] { return [] }
  closest(): undefined { return undefined }
  contains(target: RuntimeElement): boolean {
    return this === target || this.children.some(child => child.contains(target))
  }
  remove(): void {
    const index = this.parentElement?.children.indexOf(this) ?? -1
    if (index >= 0) this.parentElement!.children.splice(index, 1)
    this.parentElement = undefined
  }
  replaceChildren(): void {
    for (const child of this.children) child.parentElement = undefined
    this.children.length = 0
  }
  cloneNode(): RuntimeElement { return new RuntimeElement(this.tagName) }
  get outerHTML(): string { return `<${this.tagName.toLowerCase()}>${this.innerHTML}</${this.tagName.toLowerCase()}>` }
}

function runtimeAcceptanceContext(preview: readonly unknown[]) {
  const listeners = new Map<string, ((event: unknown) => void)[]>()
  const posted: Record<string, unknown>[] = []
  const stored = new Map<string, unknown>()
  const parent = {
    postMessage(message: Record<string, unknown>) {
      posted.push(message)
      if (message.action === 'preset-replace') {
        queueMicrotask(() => {
          for (const listener of listeners.get('message') ?? []) listener({
            source: parent,
            data: {
              source: 'dsh-agent-rp-host', action: 'preset-result', requestId: message.requestId, ok: true,
            },
          })
        })
        return
      }
      if (message.action === 'worldbook-mutate' || message.action === 'chat-mutate'
        || message.action === 'variables-replace') {
        queueMicrotask(() => {
          for (const listener of listeners.get('message') ?? []) listener({
            source: parent,
            data: {
              source: 'dsh-agent-rp-host', action: 'variables-result', requestId: message.requestId, ok: true,
            },
          })
        })
        return
      }
      if (message.action === 'capability-request' && message.capability === 'settings.extension.persist'
        && typeof message.requestId === 'string') {
        queueMicrotask(() => {
          for (const listener of listeners.get('message') ?? []) listener({
            source: parent,
            data: {
              source: 'dsh-agent-rp-host', action: 'capability-result',
              capability: 'settings.extension.persist', requestId: message.requestId, ok: true,
            },
          })
        })
        return
      }
      if (message.action === 'capability-request' && message.capability === 'storage.script.persist'
        && typeof message.requestId === 'string' && typeof message.payload === 'object'
        && message.payload !== null && !Array.isArray(message.payload)) {
        const payload = message.payload as Record<string, unknown>
        const prefix = `${String(payload.namespace)}\u0000`
        const itemKey = `${prefix}${String(payload.key ?? '')}`
        let value: unknown
        if (payload.operation === 'get') value = stored.get(itemKey) ?? null
        else if (payload.operation === 'set') { stored.set(itemKey, payload.value); value = payload.value }
        else if (payload.operation === 'remove') stored.delete(itemKey)
        else {
          const keys = [...stored.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length))
          if (payload.operation === 'clear') {
            for (const key of keys) stored.delete(`${prefix}${key}`)
          } else if (payload.operation === 'keys') value = keys
          else if (payload.operation === 'length') value = keys.length
          else if (payload.operation === 'key') value = keys[Number(payload.index)] ?? null
        }
        queueMicrotask(() => {
          for (const listener of listeners.get('message') ?? []) listener({
            source: parent,
            data: {
              source: 'dsh-agent-rp-host', action: 'capability-result', capability: 'storage.script.persist',
              requestId: message.requestId, ok: true, value,
            },
          })
        })
        return
      }
      if (message.action !== 'generation-preview') return
      queueMicrotask(() => {
        for (const listener of listeners.get('message') ?? []) listener({
          source: parent,
          data: {
            source: 'dsh-agent-rp-host',
            action: 'generation-preview-result',
            requestId: message.requestId,
            ok: true,
            value: preview,
          },
        })
      })
    },
  }
  const body = new RuntimeElement('body')
  const context: Record<string, unknown> = {
    AbortController,
    AbortSignal,
    Element: RuntimeElement,
    MessageEvent: class {
      readonly source = null
      readonly type: string
      readonly data: unknown
      readonly origin: string
      constructor(type: string, init: { readonly data?: unknown; readonly origin?: string } = {}) {
        this.type = type
        this.data = init.data
        this.origin = init.origin ?? ''
      }
    },
    Node: RuntimeElement,
    MutationObserver: class { observe() {} },
    Response,
    URL,
    crypto: { randomUUID: () => '12345678-1234-4234-8234-123456789abc' },
    console,
    document: {
      body,
      readyState: 'complete',
      createElement(tagName: string) {
        const element = new RuntimeElement(tagName) as RuntimeElement & { content?: { childNodes: RuntimeElement[] } }
        if (tagName === 'template') {
          element.content = { childNodes: [] }
          Object.defineProperty(element, 'innerHTML', {
            configurable: true,
            get: () => '',
            set: (value: string) => {
              const match = value.match(/^<([a-z][a-z0-9-]*)/iu)
              element.content!.childNodes = match === null ? [] : [new RuntimeElement(match[1])]
            },
          })
        }
        return element
      },
      getElementById(id: string) {
        const visit = (element: RuntimeElement): RuntimeElement | undefined => {
          if ((element as RuntimeElement & { readonly id?: string }).id === id) return element
          for (const child of element.children) {
            const found = visit(child)
            if (found !== undefined) return found
          }
        }
        return visit(body)
      },
      querySelectorAll(selector: string) {
        if (selector.startsWith('#')) {
          const found = (this as { getElementById(id: string): RuntimeElement | undefined }).getElementById(selector.slice(1))
          return found === undefined ? [] : [found]
        }
        if (selector === 'iframe') {
          const result: RuntimeElement[] = []
          const visit = (element: RuntimeElement): void => {
            if (element.tagName === 'IFRAME') result.push(element)
            for (const child of element.children) visit(child)
          }
          visit(body)
          return result
        }
        return []
      },
      addEventListener() {},
    },
    fetch() { throw new Error('unexpected native fetch') },
    getComputedStyle() { return { display: 'block', visibility: 'visible', getPropertyValue() { return '' } } },
    innerHeight: 768,
    innerWidth: 1024,
    parent,
    posted,
    dispatchHost(data: Record<string, unknown>) {
      for (const listener of listeners.get('message') ?? []) listener({
        source: parent,
        data: { source: 'dsh-agent-rp-host', ...data },
      })
    },
    dispatchWindow(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    },
    dispatchEvent(event: { readonly type: string }) {
      for (const listener of listeners.get(event.type) ?? []) listener(event)
      return true
    },
    queueMicrotask,
    setTimeout,
    clearTimeout,
    addEventListener(type: string, listener: (event: unknown) => void) {
      const current = listeners.get(type) ?? []
      current.push(listener)
      listeners.set(type, current)
    },
  }
  context.window = context
  return context
}

test('builds a parseable Tavern runtime with dynamic script button APIs', async () => {
  const html = tavernScriptFrameSource({
    id: 'travel', name: '地点选择', content: '', info: '测试', enabled: true,
    buttonEnabled: true, buttons: [{ name: '开始', visible: true }], data: {},
  }, 'window.__personaSnapshot={name:getCurrentPersonaName(),id:getCurrentPersonaId()}; window.__renderedMarkdown=builtin.renderMarkdown("**粗体**\\n\\n```yaml\\nkey: value\\n```"); window.__runtimeLibraries={domPurify:"DOMPurify" in SillyTavern.libs,fuse:"Fuse" in SillyTavern.libs,uuid:SillyTavern.getContext().uuidv4()}; replaceScriptButtons([{name:"学校",visible:true}])', {
    scriptScope: 'character',
    scriptId: 'travel', scriptName: '地点选择', scriptInfo: '测试',
    buttons: [{ name: '开始', visible: true }], characterName: '白露', characterId: 'bailu.png',
    chatId: 'session-test', approvedScriptOrigins: [], persona: {
      id: 'persona-12345678-1234-4123-8123-123456789abc', name: '小满', description: '怕冷，喜欢旧书。',
    },
    preset: {
      name: 'V18', revision: 3,
      value: { settings: {}, prompts: [], prompts_unused: [], extensions: {} },
    },
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [],
    messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [base],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  assert.doesNotThrow(() => { Function(source!) })
  assert.match(source!, /window\.replaceScriptButtons=/u)
  assert.match(source!, /window\.updateScriptButtonsWith=/u)
  assert.match(source!, /window\.formatAsDisplayedMessage=/u)
  assert.match(source!, /window\.retrieveDisplayedMessage=/u)
  assert.match(source!, /window\.refreshOneMessage=/u)
  assert.match(source!, /window\.getCurrentCharId=/u)
  assert.match(source!, /window\.getCurrentChatId=/u)
  assert.match(source!, /window\.getCurrentPersonaName=/u)
  assert.match(source!, /window\.getCurrentPersonaId=/u)
  assert.match(source!, /window\.builtin=/u)
  assert.match(source!, /window\.SillyTavern\.libs\.DOMPurify=window\.DOMPurify/u)
  assert.match(source!, /window\.SillyTavern\.libs\.Fuse=window\.Fuse/u)
  assert.match(html, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/dompurify@3\.3\.0\/dist\/purify\.min\.js"/u)
  assert.match(html, /integrity="sha384-\+qi1h9Ene5uYXijovnRnDpm2TZiNyVFgYjKIqjw6id8zLdWYt\+tCPG9\/1u6yLaNj"/u)
  assert.match(html, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/fuse\.js@7\.1\.0\/dist\/fuse\.min\.js"/u)
  assert.match(html, /integrity="sha384-P\/y\/5cwqUn6MDvJ9lCHJSaAi2EoH3JSeEdyaORsQMPgbpvA\+NvvUqik7XH2YGBjb"/u)
  assert.match(html, /img-src data: blob:/u)
  assert.doesNotMatch(html, /data:image\/svg\+xml/u)
  assert.match(source!, /window\.getPreset=/u)
  assert.match(source!, /window\.updatePresetWith=/u)
  assert.match(source!, /window\.setPreset=/u)
  assert.match(source!, /window\.getTavernRegexes=/u)
  assert.match(source!, /window\.replaceTavernRegexes=/u)
  assert.match(source!, /window\.updateTavernRegexesWith=/u)
  assert.match(source!, /window\.formatAsTavernRegexedString=/u)
  assert.match(source!, /window\.registerMacroLike=/u)
  assert.match(source!, /window\.unregisterMacroLike=/u)
  assert.match(source!, /window\.substitudeMacros=/u)
  assert.match(source!, /window\.substituteParams=/u)
  assert.match(source!, /window\.injectPrompts=/u)
  assert.match(source!, /window\.uninjectPrompts=/u)
  assert.match(source!, /window\.getScriptTrees=/u)
  assert.match(source!, /window\.getAllEnabledScriptButtons=/u)
  assert.match(source!, /window\.generateRaw=/u)
  assert.match(source!, /\/api\/backends\/chat-completions\/generate/u)
  assert.match(source!, /window\.stopGenerationById=/u)
  assert.match(source!, /window\.stopAllGeneration=/u)
  assert.match(source!, /window\.getTavernHelperVersion=/u)
  assert.match(source!, /window\.getTavernVersion=/u)
  assert.match(source!, /window\.SillyTavern\.stopGeneration=/u)
  assert.match(source!, /window\.SillyTavern\.messageFormatting=/u)
  assert.match(source!, /generation-cancel/u)
  assert.match(source!, /CHAT_COMPLETION_PROMPT_READY:'chat_completion_prompt_ready'/u)
  assert.match(source!, /GENERATE_AFTER_DATA:'generate_after_data'/u)
  assert.match(source!, /GENERATE_AFTER_COMBINE_PROMPTS:'generate_after_combine_prompts'/u)
  assert.match(source!, /generation-preview/u)
  assert.match(source!, /generation-preview-result/u)
  assert.ok(source!.indexOf('var prompts=await __dshPromptPreview')
    < source!.indexOf("var response=await window.fetch('/api/backends/chat-completions/generate'"))
  assert.match(source!, /window\.getModelList=/u)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  runInNewContext([
    'window.__versions={helper:getTavernHelperVersion(),tavern:getTavernVersion()};',
    'window.__formatted=SillyTavern.messageFormatting("old **正文**","白露",false,false,0);',
    'window.__stopped=SillyTavern.stopGeneration();',
    '$(async function(){window.__asyncHelperVersion=await getTavernHelperVersion()});',
  ].join(''), context)
  await new Promise<void>(resolve => { setImmediate(resolve) })
  assert.deepEqual(JSON.parse(JSON.stringify(context.__personaSnapshot)), {
    name: '小满', id: 'persona-12345678-1234-4123-8123-123456789abc',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(context.__runtimeLibraries)), {
    domPurify: true, fuse: true, uuid: '12345678-1234-4234-8234-123456789abc',
  })
  assert.equal(context.__renderedMarkdown,
    '<p><strong>粗体</strong></p><pre><code class="language-yaml">key: value</code></pre>')
  assert.deepEqual(JSON.parse(JSON.stringify(context.__versions)), { helper: '4.0.0', tavern: '1.13.5' })
  assert.equal(context.__asyncHelperVersion, '4.0.0')
  assert.equal(context.__formatted, '<p>new <strong>正文</strong></p>')
  assert.equal(context.__stopped, true)
  assert.equal((context.posted as Record<string, unknown>[]).some(message => message.action === 'generation-cancel-all'), true)
  const dispatchWindow = context.dispatchWindow as (type: string, event: unknown) => void
  dispatchWindow('securitypolicyviolation', {
    effectiveDirective: 'style-src-elem', blockedURI: 'https://styles.example.test/theme.css',
  })
  dispatchWindow('securitypolicyviolation', {
    violatedDirective: 'style-src', blockedURI: 'https://styles.example.test/duplicate.css',
  })
  dispatchWindow('securitypolicyviolation', {
    effectiveDirective: 'worker-src', blockedURI: 'https://worker.example.test/worker.js',
  })
  dispatchWindow('securitypolicyviolation', {
    effectiveDirective: 'style-src', blockedURI: 'https://user:secret@styles.example.test/private.css',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(
    (context.posted as Record<string, unknown>[]).filter(message => message.action === 'resource-blocked'),
  )), [{
    source: 'dsh-agent-rp-tavern-script', action: 'resource-blocked', scriptId: 'travel',
    type: 'style', origin: 'https://styles.example.test',
  }])
})

test('runs a trusted injected frame shim before card scripts with runtime globals and outside vendors', async () => {
  const html = tavernScriptFrameSource({
    id: 'injected-shim', name: '受管垫片', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, 'window.__playerOrder = [window.__shimOrder ?? -1, __dshPost];', {
    scriptScope: 'character',
    scriptId: 'injected-shim', scriptName: '受管垫片', scriptInfo: '', buttons: [],
    characterName: '白露', characterId: 'bailu.png', chatId: 'session-test',
    approvedScriptOrigins: [],
    persona: {
      id: 'persona-12345678-1234-4123-8123-123456789abc', name: '小满', description: '怕冷，喜欢旧书。',
    },
    preset: {
      name: 'V18', revision: 3,
      value: { settings: {}, prompts: [], prompts_unused: [], extensions: {} },
    },
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  }, {
    injectedScript: {
      source: 'window.__shimOrder = 1; window.__stGlobals = { script: "sourced" };'
        + ' if (typeof __dshPost !== "function") throw new Error("runtime surface missing");',
    },
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  assert.ok(source!.indexOf('window.__shimOrder = 1') < source!.indexOf('window.__playerOrder'))
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  await new Promise<void>(resolve => { setImmediate(resolve) })
  const order = context.__playerOrder as readonly unknown[]
  assert.equal(order[0], 1)
  assert.equal(typeof order[1], 'function')
  assert.deepEqual(JSON.parse(JSON.stringify((context as Record<string, unknown>).__stGlobals)), {
    script: 'sourced',
  })
  const navigation = tavernScriptFrameNavigation(html)
  assert.ok(navigation.vendors.length >= 2)
  assert.equal(navigation.vendors.some(vendor => vendor.includes('window.__shimOrder')), false)
  assert.match(html, /<aside id="extensions_settings" class="extensions_settings" data-dsh-st-extension-host hidden><\/aside>/u)
  assert.ok(html.indexOf('<aside id="extensions_settings"') < html.indexOf('<script>'))
})

test('ignores an empty or extension-only body surface while counting real children of the stable extension host', async () => {
  const html = tavernScriptFrameSource({
    id: 'extension-host', name: '扩展容器', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, 'window.__surfaceProbe = __dshHasSurface();', {
    scriptScope: 'character',
    scriptId: 'extension-host', scriptName: '扩展容器', scriptInfo: '', buttons: [],
    characterName: '白露', characterId: 'bailu.png', chatId: 'session-test',
    approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  }, {})
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  const host = new RuntimeElement('aside')
  host.setAttribute('id', 'extensions_settings')
  host.setAttribute('hidden', '')
  ;(context.document as { body: RuntimeElement }).body.appendChild(host)
  runInNewContext(source!, context)
  await new Promise<void>(resolve => { setImmediate(resolve) })
  assert.equal((context as Record<string, unknown>).__surfaceProbe, false)
})

test('treats a populated extension host as a visible surface for the tavern panel', async () => {
  const html = tavernScriptFrameSource({
    id: 'extension-host', name: '扩展容器', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, 'window.__dshSettingsProbe = (function(){var host=document.getElementById("extensions_settings");if(!host)return "missing";var probe=document.createElement("span");probe.textContent="扩展设置";host.appendChild(probe);host.removeAttribute("hidden");return [__dshHasSurface(), Array.from(host.children).length, getComputedStyle(host).display];})();', {
    scriptScope: 'character',
    scriptId: 'extension-host', scriptName: '扩展容器', scriptInfo: '', buttons: [],
    characterName: '白露', characterId: 'bailu.png', chatId: 'session-test',
    approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  }, {})
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  const host = new RuntimeElement('aside')
  host.setAttribute('id', 'extensions_settings')
  host.setAttribute('hidden', '')
  ;(context.document as { body: RuntimeElement }).body.appendChild(host)
  runInNewContext(source!, context)
  await new Promise<void>(resolve => { setImmediate(resolve) })
  assert.deepEqual(JSON.parse(JSON.stringify(
    (context as Record<string, unknown>).__dshSettingsProbe,
  )), [true, 1, 'block'])
})

test('preserves authorized ESM imports and plans their required public globals', async () => {
  const originalFetch = globalThis.fetch
  const fetched: string[] = []
  globalThis.fetch = (input: string | URL | Request) => {
    fetched.push(String(input))
    return Promise.resolve(new Response([
      'var schema = z;',
      'export function register() { return schema.object({ value: schema.string() }).parse(YAML.parse("value: ok")); }',
      'export const panel = Vue.createApp;',
      'try { (window.parent || window).__辅助计算脚本_loaded__ = true; } catch { window.__辅助计算脚本_loaded__ = true; }',
    ].join('\n')))
  }
  try {
    const plan = await resolveTavernScriptExecution([
      "import { register } from 'https://cdn.jsdelivr.net/gh/example/project@1.0.0/module.js';",
      'window.__registered = register();',
    ].join('\n'), AbortSignal.timeout(5_000))
    assert.equal(plan.mode, 'module')
    assert.deepEqual(plan.preloads, ['vue', 'yaml', 'zod'])
    assert.equal(plan.needsDomPurify, false)
    assert.equal(plan.needsFuse, false)
    assert.deepEqual(plan.compatibilityMarkers, ['__辅助计算脚本_loaded__'])
    assert.match(plan.source, /import \{ register \} from '__dsh_tavern_remote_module_0__'/u)
    assert.equal(plan.source.includes('https://cdn.jsdelivr.net'), false)
    assert.equal(plan.moduleDependencies?.length, 1)
    assert.match(plan.moduleDependencies?.[0]?.source ?? '', /export function register/u)
    assert.deepEqual(plan.moduleDependencies?.[0]?.dependencies, [])
    assert.deepEqual(fetched, ['https://cdn.jsdelivr.net/gh/example/project@1.0.0/module.js'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('preloads YAML when a bundled script aliases the global parser', async () => {
  const plan = await resolveTavernScriptExecution('const parser = YAML; window.result = parser.parse("value: ok");',
    AbortSignal.timeout(5_000))
  assert.deepEqual(plan.preloads, ['yaml'])
})

test('localizes maintained jsDelivr modules without fetching or duplicating their browser graphs', async () => {
  const originalFetch = globalThis.fetch
  const fetched: string[] = []
  globalThis.fetch = (input: string | URL | Request) => {
    fetched.push(String(input))
    return Promise.reject(new Error('localized modules must not use the network'))
  }
  try {
    const plan = await resolveTavernScriptExecution([
      "import { compare } from 'https://testingcf.jsdelivr.net/npm/compare-versions/+esm';",
      "import 'https://testingcf.jsdelivr.net/npm/json5/+esm';",
      "import 'https://testingcf.jsdelivr.net/npm/jsonrepair/+esm';",
      "import 'https://testingcf.jsdelivr.net/npm/zod/v4/core/+esm';",
      "import { createPinia } from 'https://testingcf.jsdelivr.net/npm/pinia@3.0.4/+esm';",
      "import { klona } from 'https://testingcf.jsdelivr.net/npm/klona/+esm';",
      'window.result = [compare("1", "1", "="), createPinia, klona, YAML];',
    ].join('\n'), AbortSignal.timeout(5_000))
    assert.deepEqual(fetched, [])
    assert.equal(plan.mode, 'module')
    assert.deepEqual(plan.preloads, [
      'compare-versions', 'json5', 'jsonrepair', 'zod', 'vue', 'pinia', 'klona', 'yaml',
    ])
    assert.equal(plan.moduleDependencies?.length, 6)
    assert.ok((plan.moduleDependencies ?? [])
      .reduce((total, module) => total + module.source.length, 0) < 100_000)
    const localizedSources = (plan.moduleDependencies ?? []).map(module => module.source).join('\n')
    assert.match(localizedSources, /export const compare=__dshModule\.compare\?\?__dshDefault\.compare/u)
    assert.match(localizedSources, /export const createPinia=__dshModule\.createPinia\?\?__dshDefault\.createPinia/u)
    assert.match(localizedSources, /export const klona=__dshModule\.klona\?\?__dshDefault\.klona/u)
    assert.match(localizedSources,
      /const __dshModule=__dshModuleRoot\?\.core\?\?__dshModuleRoot\?\.default\?\.core/u)
    assert.match(localizedSources, /export const toDotPath=__dshModule\.toDotPath\?\?__dshDefault\.toDotPath/u)
    assert.equal(JSON.stringify(plan).includes('https://testingcf.jsdelivr.net'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('resolves required ESM dependencies while preserving optional dynamic failures', async () => {
  const originalFetch = globalThis.fetch
  const fetched: string[] = []
  globalThis.fetch = (input: string | URL | Request) => {
    const url = String(input)
    fetched.push(url)
    if (url.endsWith('/root.js')) {
      return Promise.resolve(new Response([
        "import { value } from './leaf.js';",
        'export const result = value;',
        "export async function optional() { try { return await import('./optional.js'); } catch { return undefined; } }",
      ].join('\n')))
    }
    if (url.endsWith('/leaf.js')) return Promise.resolve(new Response("export const value = 'local';"))
    return Promise.resolve(new Response('', { status: 404 }))
  }
  try {
    const plan = await resolveTavernScriptExecution(
      "import { result } from 'https://cdn.jsdelivr.net/gh/example/module-graph@1/root.js'; window.result=result;",
      AbortSignal.timeout(5_000),
    )
    assert.deepEqual(fetched, [
      'https://cdn.jsdelivr.net/gh/example/module-graph@1/root.js',
      'https://cdn.jsdelivr.net/gh/example/module-graph@1/leaf.js',
      'https://cdn.jsdelivr.net/gh/example/module-graph@1/optional.js',
    ])
    assert.equal(plan.moduleDependencies?.length, 3)
    assert.match(plan.source, /__dsh_tavern_remote_module_0__/u)
    assert.match(plan.moduleDependencies?.[0]?.source ?? '', /__dsh_tavern_remote_module_1__/u)
    assert.deepEqual(plan.moduleDependencies?.[0]?.dependencies, ['remote-module-1', 'remote-module-2'])
    assert.deepEqual(plan.moduleDependencies?.[1]?.dependencies, [])
    assert.match(plan.moduleDependencies?.[2]?.source ?? '', /可选远程模块不可用/u)
    assert.deepEqual(plan.moduleDependencies?.[2]?.dependencies, [])
    assert.equal(JSON.stringify(plan).includes('https://cdn.jsdelivr.net/gh/example/module-graph'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('chooses local module placeholders that cannot rewrite script data', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => Promise.resolve(new Response(
    "export const text = '__dsh_tavern_remote_module_0__';",
  ))
  try {
    const plan = await resolveTavernScriptExecution([
      "const original = '__dsh_tavern_remote_module_0__';",
      "import { text } from 'https://cdn.jsdelivr.net/gh/example/placeholders@1/module.js';",
      'window.result = original + text;',
    ].join('\n'), AbortSignal.timeout(5_000))
    assert.match(plan.source, /const original = '__dsh_tavern_remote_module_0__'/u)
    assert.match(plan.source, /from '__dsh_tavern_remote_module_0_1__'/u)
    assert.equal(plan.moduleDependencies?.[0]?.placeholder, '__dsh_tavern_remote_module_0_1__')
    assert.match(plan.moduleDependencies?.[0]?.source ?? '', /text = '__dsh_tavern_remote_module_0__'/u)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('runs classic side-effect dependencies behind an isolated window facade', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => Promise.resolve(new Response([
    'var core=window.parent||window;',
    'window.__classicCore=core;',
    'window.__classicDependency=true;',
    "var devtools={logo:'https://pinia.vuejs.org/logo.svg'};",
    "var wallpaper=document.createElement('img');",
    "wallpaper.src='https://images.example.test/wallpaper.webp';",
  ].join('\n')))
  try {
    const plan = await resolveTavernScriptExecution([
      "import 'https://cdn.jsdelivr.net/gh/example/classic-facade@1.0.0/bundle.js';",
      'window.__classicEntry=true;',
    ].join('\n'), AbortSignal.timeout(5_000))
    assert.equal(plan.mode, 'classic')
    assert.equal(plan.source, 'window.__classicEntry=true;')
    assert.equal(plan.inlineDependencies?.length, 1)
    assert.deepEqual(plan.remoteImageOrigins, ['https://images.example.test'])
    assert.equal(plan.remoteImageOrigins?.includes('https://pinia.vuejs.org'), false)
    const html = tavernScriptFrameSource({
      id: 'classic-runtime', name: '经典依赖', content: '', info: '', enabled: true,
      buttonEnabled: false, buttons: [], data: {},
    }, plan, {
      scriptScope: 'character',
      scriptId: 'classic-runtime', scriptName: '经典依赖', scriptInfo: '', buttons: [],
      characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
      scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
      worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
      activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
      displayRegexScripts: [],
    })
    const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
    assert.notEqual(source, undefined)
    const context = runtimeAcceptanceContext([])
    runInNewContext(source!, context)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const core = context.__classicCore as { readonly parent?: unknown }
    assert.equal(core.parent, core)
    assert.equal((context.document as { readonly defaultView?: unknown }).defaultView, core)
    assert.equal(context.__classicDependency, true)
    assert.equal(context.__classicEntry, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('keeps an approved nested web frame on its own HTTPS origin inside an opaque script container', async () => {
  const execution = await resolveTavernScriptExecution([
    "const TARGET_URL='https://workshop.example.test/?embed=1';",
    "const iframe=document.createElement('iframe');",
    "$(iframe).attr('src',TARGET_URL);",
  ].join('\n'), AbortSignal.timeout(5_000))
  assert.deepEqual(execution.remoteFrameOrigins, ['https://workshop.example.test'])
  const html = tavernScriptFrameSource({
    id: 'web-frame', name: '远端面板', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, execution, {
    scriptScope: 'character',
    scriptId: 'web-frame', scriptName: '远端面板', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    approvedFrameOrigins: ['https://workshop.example.test'],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  assert.match(html, /base-uri 'none'; object-src 'none'; form-action 'none'/u)
  assert.match(html, /frame-src https:\/\/workshop\.example\.test/u)
  const url = tavernScriptFrameUrl(html)
  assert.match(url, /^data:text\/html;charset=utf-8;base64,/u)
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), value => value.charCodeAt(0)))
  assert.equal(decoded, html)
  assert.notEqual(
    tavernScriptFrameApprovalKey('card-a', undefined, 'character', 'web-frame', 'https://workshop.example.test'),
    tavernScriptFrameApprovalKey('card-b', undefined, 'character', 'web-frame', 'https://workshop.example.test'),
  )
  const externalDocument = tavernScriptFrameSource({
    id: 'web-frame', name: '远端面板', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, execution, {
    scriptScope: 'character',
    scriptId: 'web-frame', scriptName: '远端面板', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', characterCard: { privatePayload: '__PRIVATE_CARD_PAYLOAD__' },
    chatId: 'session-test', approvedScriptOrigins: [], approvedFrameOrigins: ['https://workshop.example.test'],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  }, { externalBootstrap: true })
  const navigation = tavernScriptFrameNavigation(externalDocument)
  assert.doesNotMatch(navigation.url, /__PRIVATE_CARD_PAYLOAD__/u)
  assert.doesNotMatch(navigation.program, /__PRIVATE_CARD_PAYLOAD__/u)
  assert.ok(navigation.vendors.every(vendor => !vendor.includes('__PRIVATE_CARD_PAYLOAD__')))
  assert.match(navigation.program, /globalThis\.__dshBootSnapshot/u)
  const navigationShell = new TextDecoder().decode(Uint8Array.from(
    atob(navigation.url.slice(navigation.url.indexOf(',') + 1)), value => value.charCodeAt(0),
  ))
  assert.match(navigationShell, /dsh-agent-rp-tavern-loader/u)
  assert.match(navigationShell, /bootstrap-started/u)
  assert.match(navigationShell, /bootstrap-finished/u)
  assert.match(navigationShell, /Array\.isArray\(message\.vendors\)/u)
  assert.doesNotMatch(navigationShell, /__PRIVATE_CARD_PAYLOAD__/u)
  assert.doesNotMatch(navigationShell, /data-dsh-runtime-vendor/u)
  assert.match(navigation.vendors.join('\n'), /jquery 3\.7\.1/iu)
  assert.match(navigation.vendors.join('\n'), /lodash 4\.17\.21/iu)
  assert.doesNotMatch(navigation.program, /jquery 3\.7\.1/iu)
  assert.match(navigation.program, /startup-phase/u)
  assert.match(navigation.program, /value:'runtime'/u)
  assert.match(navigation.program, /value:'script'/u)
  assert.ok(navigationShell.length < 20_000)
  assert.ok(navigation.program.length > navigationShell.length)
})

test('shares one in-flight dependency across concurrent Tavern script plans', async () => {
  const originalFetch = globalThis.fetch
  const dependency = 'https://cdn.jsdelivr.net/gh/dsh-agent-rp/concurrent-resolver@1.0.0/shared.js'
  let fetches = 0
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  globalThis.fetch = async () => {
    fetches += 1
    await gate
    return new Response('window.__sharedDependency=true;')
  }
  try {
    const source = `import '${dependency}';window.__entry=true;`
    const first = resolveTavernScriptExecution(source, AbortSignal.timeout(5_000))
    const second = resolveTavernScriptExecution(source, AbortSignal.timeout(5_000))
    assert.equal(fetches, 1)
    assert.ok(release)
    release()
    const plans = await Promise.all([first, second])
    assert.equal(fetches, 1)
    assert.deepEqual(plans.map(plan => plan.inlineDependencies?.length), [1, 1])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('cancels one shared dependency waiter without aborting the remaining script plan', async () => {
  const originalFetch = globalThis.fetch
  const dependency = 'https://cdn.jsdelivr.net/gh/dsh-agent-rp/concurrent-resolver@1.0.0/cancellable.js'
  let fetches = 0
  let fetchSignal: AbortSignal | undefined
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  globalThis.fetch = async (_input, init) => {
    fetches += 1
    fetchSignal = init?.signal ?? undefined
    await gate
    return new Response('window.__cancellableDependency=true;')
  }
  const firstController = new AbortController()
  const secondController = new AbortController()
  try {
    const source = `import '${dependency}';window.__entry=true;`
    const first = resolveTavernScriptExecution(source, firstController.signal)
    const second = resolveTavernScriptExecution(source, secondController.signal)
    const firstRejected = assert.rejects(first, error => error === firstController.signal.reason)
    firstController.abort(new Error('first caller cancelled'))
    await firstRejected
    assert.equal(fetches, 1)
    assert.equal(fetchSignal?.aborted, false)
    assert.ok(release)
    release()
    assert.equal((await second).inlineDependencies?.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('aborts the shared dependency request after every script plan cancels', async () => {
  const originalFetch = globalThis.fetch
  const dependency = 'https://cdn.jsdelivr.net/gh/dsh-agent-rp/concurrent-resolver@1.0.0/all-cancelled.js'
  let fetchSignal: AbortSignal | undefined
  globalThis.fetch = async (_input, init) => {
    fetchSignal = init?.signal ?? undefined
    await new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(init.signal?.reason) }, { once: true })
    })
    throw new Error('unreachable')
  }
  const firstController = new AbortController()
  const secondController = new AbortController()
  try {
    const source = `import '${dependency}';window.__entry=true;`
    const first = resolveTavernScriptExecution(source, firstController.signal)
    const second = resolveTavernScriptExecution(source, secondController.signal)
    const firstRejected = assert.rejects(first, error => error === firstController.signal.reason)
    const secondRejected = assert.rejects(second, error => error === secondController.signal.reason)
    firstController.abort(new Error('first caller cancelled'))
    await firstRejected
    assert.equal(fetchSignal?.aborted, false)
    secondController.abort(new Error('second caller cancelled'))
    await secondRejected
    assert.equal(fetchSignal?.aborted, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('retries a shared dependency after its previous request fails', async () => {
  const originalFetch = globalThis.fetch
  const dependency = 'https://cdn.jsdelivr.net/gh/dsh-agent-rp/concurrent-resolver@1.0.0/retry.js'
  let fetches = 0
  globalThis.fetch = async () => {
    fetches += 1
    if (fetches === 1) throw new Error('temporary dependency failure')
    return new Response('window.__retriedDependency=true;')
  }
  try {
    const source = `import '${dependency}';window.__entry=true;`
    const failed = await Promise.allSettled([
      resolveTavernScriptExecution(source, AbortSignal.timeout(5_000)),
      resolveTavernScriptExecution(source, AbortSignal.timeout(5_000)),
    ])
    assert.deepEqual(failed.map(result => result.status), ['rejected', 'rejected'])
    assert.equal(fetches, 1)
    assert.equal((await resolveTavernScriptExecution(
      source, AbortSignal.timeout(5_000),
    )).inlineDependencies?.length, 1)
    assert.equal(fetches, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('accepts the deployed MVU-offline bundle size within the bounded remote plan', async () => {
  const originalFetch = globalThis.fetch
  const dependency = 'https://testingcf.jsdelivr.net/gh/NLKASHEI/MVU-offline@v1.0.1/mvu_bundle_full.js'
  const bytes = 2_598_263
  const prefix = 'window.__largeMvu=true;/*'
  const suffix = '*/'
  const body = `${prefix}${'x'.repeat(bytes - prefix.length - suffix.length)}${suffix}`
  globalThis.fetch = async input => {
    assert.equal(String(input), dependency)
    return new Response(body, { headers: { 'content-length': String(bytes) } })
  }
  try {
    const plan = await resolveTavernScriptExecution(
      `import '${dependency}';`, AbortSignal.timeout(10_000),
    )
    assert.equal(new TextEncoder().encode(plan.inlineDependencies?.[0]).byteLength, bytes)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('adapts the public MagVarUpdate side-effect bundle to the Host Mvu capability', async () => {
  const plan = await resolveTavernScriptExecution([
    "import 'https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@beta/artifact/bundle.js';",
    'window.__mvu = Mvu;',
  ].join('\n'), AbortSignal.timeout(5_000))
  assert.equal(plan.mode, 'classic')
  assert.equal(plan.source, 'window.__mvu = Mvu;')
})

test('rejects module references that cannot be authorized before execution', async () => {
  await assert.rejects(
    resolveTavernScriptExecution("import value from './local.js';", AbortSignal.timeout(5_000)),
    /完整 HTTPS 地址/u,
  )
  await assert.rejects(
    resolveTavernScriptExecution('const path = location.hash; import(path);', AbortSignal.timeout(5_000)),
    /固定 HTTPS 地址/u,
  )
  await assert.rejects(
    resolveTavernScriptExecution("import 'https://modules.example.test/entry.js';", AbortSignal.timeout(5_000)),
    error => error instanceof TavernScriptOriginApprovalError && error.origin === 'https://modules.example.test',
  )
})

test('preflights selected character and preset resources without executing scripts', async () => {
  const script = (id: string, content: string, enabled = true) => ({
    id, name: id, content, info: '', enabled, buttonEnabled: false, buttons: [], data: {},
  })
  const sources = [{
    scope: 'character' as const,
    ownerId: 'card-a',
    scripts: [
      script('remote-ui', "import 'https://preflight.example.test/runtime.js';"),
      script('local-ui', [
        "window.wallpaper='https://images.example.test/cover.webp';",
        "const theme=document.createElement('link');theme.rel='stylesheet';theme.href='https://styles.example.test/theme.css';",
        "const PANEL='https://panel.example.test/?embed=1';",
        "document.createElement('iframe').src=PANEL;",
      ].join('\n')),
      script('disabled-ui', 'throw new Error("must stay inert")', false),
    ],
  }, {
    scope: 'preset' as const,
    ownerId: 'preset-a',
    scripts: [script('invalid-ui', 'const path = location.hash; import(path);')],
  }]
  const first = await inspectTavernPreflight(sources, [], AbortSignal.timeout(5_000))
  assert.deepEqual(first, {
    format: 0,
    scripts: 3,
    ready: 1,
    permissionRequired: 1,
    failed: 1,
    entries: [{
      scope: 'character', scriptId: 'remote-ui', scriptName: 'remote-ui',
      status: 'permission-required', requestedScriptOrigin: 'https://preflight.example.test',
      remoteImageOrigins: [], remoteStyleOrigins: [], remoteFontOrigins: [], remoteFrameOrigins: [],
    }, {
      scope: 'character', scriptId: 'local-ui', scriptName: 'local-ui',
      status: 'ready', remoteImageOrigins: ['https://images.example.test'],
      remoteStyleOrigins: ['https://styles.example.test'],
      remoteFontOrigins: [],
      remoteFrameOrigins: ['https://panel.example.test'],
    }, {
      scope: 'preset', scriptId: 'invalid-ui', scriptName: 'invalid-ui',
      status: 'resolution-error', failure: 'script-resolution-failed', detail: '脚本无法完成静态解析',
      remoteImageOrigins: [], remoteStyleOrigins: [], remoteFontOrigins: [], remoteFrameOrigins: [],
    }],
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = () => Promise.resolve(new Response(
    "var cover=document.createElement('img');cover.src='https://assets.example.test/cover.png';",
  ))
  try {
    const approved = await inspectTavernPreflight(sources, [{
      scope: 'character', scriptId: 'remote-ui', origins: ['https://preflight.example.test'],
    }], AbortSignal.timeout(5_000))
    assert.equal(approved.ready, 2)
    assert.equal(approved.permissionRequired, 0)
    assert.deepEqual(approved.entries[0]?.remoteImageOrigins, ['https://assets.example.test'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('scopes Tavern resource grants to one card, preset, script scope, and script id', () => {
  const exact = tavernScriptOriginApprovalKey(
    'card-a', 'preset-a', 'character', 'shared-script', 'https://modules.example.test',
  )
  const approvals = new Set([
    exact,
    tavernScriptOriginApprovalKey('card-b', 'preset-a', 'character', 'shared-script', 'https://other-card.test'),
    tavernScriptOriginApprovalKey('card-a', 'preset-b', 'character', 'shared-script', 'https://other-preset.test'),
    tavernScriptOriginApprovalKey('card-a', 'preset-a', 'preset', 'shared-script', 'https://preset-script.test'),
    tavernScriptOriginApprovalKey('card-a', 'preset-a', 'global', 'global-script', 'https://global-script.test'),
    'https://legacy-global-origin.test',
  ])
  assert.deepEqual(approvedTavernScriptOrigins(
    approvals, 'card-a', 'preset-a', 'character', 'shared-script',
  ), ['https://modules.example.test'])
  assert.deepEqual(tavernPreflightApprovals(approvals, 'card-a', 'preset-a'), [{
    scope: 'character', scriptId: 'shared-script', origins: ['https://modules.example.test'],
  }, {
    scope: 'preset', scriptId: 'shared-script', origins: ['https://preset-script.test'],
  }])
  const styleApprovals = new Set([
    tavernScriptStyleApprovalKey(
      'card-a', 'preset-a', 'character', 'shared-script', 'https://styles.example.test',
    ),
    tavernScriptStyleApprovalKey(
      'card-a', 'preset-a', 'preset', 'shared-script', 'https://preset-styles.example.test',
    ),
    tavernScriptStyleApprovalKey(
      'card-b', 'preset-a', 'character', 'shared-script', 'https://other-card-styles.test',
    ),
  ])
  assert.deepEqual(tavernResourcePreflightApprovals(
    approvals, styleApprovals, 'card-a', 'preset-a',
  ), [{
    scope: 'character', scriptId: 'shared-script', origins: ['https://modules.example.test'],
    styleOrigins: ['https://styles.example.test'],
  }, {
    scope: 'preset', scriptId: 'shared-script', origins: ['https://preset-script.test'],
    styleOrigins: ['https://preset-styles.example.test'],
  }])
  assert.equal(parseTavernScriptOriginApprovalKey('https://legacy-global-origin.test'), undefined)
  assert.notEqual(
    tavernScriptImageApprovalKey('card-a', 'preset-a', 'character', 'shared-script', 'https://images.example.test'),
    tavernScriptImageApprovalKey('card-b', 'preset-a', 'character', 'shared-script', 'https://images.example.test'),
  )
})

test('uses one library permission owner before and after Session launch', () => {
  assert.equal(tavernPermissionOwnerId('card-a', 'library:card-a'), 'card-a')
  assert.equal(tavernPermissionOwnerId(undefined, 'library:card-a'), 'card-a')
  assert.equal(tavernPermissionOwnerId(undefined, 'attachment-a'), 'attachment-a')
  assert.equal(tavernPermissionOwnerId(undefined, undefined), undefined)
})

test('shares one pending resource plan between preflight and active scripts', () => {
  const scriptApproval = tavernScriptOriginApprovalKey(
    'card-a', 'preset-a', 'character', 'resource-script', 'https://scripts.example.test',
  )
  const imageApproval = tavernScriptImageApprovalKey(
    'card-a', 'preset-a', 'character', 'resource-script', 'https://images.example.test',
  )
  const input = {
    characterId: 'card-a', presetId: 'preset-a',
    entries: [{
      scope: 'character' as const,
      scriptId: 'resource-script',
      scriptOrigins: ['https://scripts.example.test'],
      imageOrigins: ['https://images.example.test'],
      styleOrigins: ['https://styles.example.test'],
      fontOrigins: ['https://fonts.example.test'],
      frameOrigins: ['https://frames.example.test'],
    }],
    approvedScripts: new Set([scriptApproval]),
    approvedImages: new Set([imageApproval]),
    approvedStyles: new Set<string>(),
    approvedFonts: new Set<string>(),
    approvedFrames: new Set<string>(),
  }

  assert.deepEqual(pendingTavernScriptResourcePermissions(input), [{
    kind: 'font', scope: 'character', scriptId: 'resource-script',
    origin: 'https://fonts.example.test',
    approvalKey: tavernScriptFontApprovalKey(
      'card-a', 'preset-a', 'character', 'resource-script', 'https://fonts.example.test',
    ),
  }, {
    kind: 'frame', scope: 'character', scriptId: 'resource-script',
    origin: 'https://frames.example.test',
    approvalKey: tavernScriptFrameApprovalKey(
      'card-a', 'preset-a', 'character', 'resource-script', 'https://frames.example.test',
    ),
  }, {
    kind: 'style', scope: 'character', scriptId: 'resource-script',
    origin: 'https://styles.example.test',
    approvalKey: tavernScriptStyleApprovalKey(
      'card-a', 'preset-a', 'character', 'resource-script', 'https://styles.example.test',
    ),
  }])
})

test('derives one deduplicated startup and interaction permission lifecycle', () => {
  const plan = tavernPermissionPlan([
    { kind: 'generation', key: 'generation-a', payload: 'first' },
    { kind: 'frame', key: 'frame-a', payload: 'frame' },
    { kind: 'generation', key: 'generation-a', payload: 'duplicate' },
    { kind: 'identity', key: 'identity-a', payload: 'identity' },
  ] as const)

  assert.deepEqual(plan, [
    { kind: 'frame', key: 'frame-a', payload: 'frame', lifecycle: 'startup' },
    { kind: 'generation', key: 'generation-a', payload: 'first', lifecycle: 'interaction' },
    { kind: 'identity', key: 'identity-a', payload: 'identity', lifecycle: 'interaction' },
  ])
  assert.deepEqual(summarizeTavernPermissionPlan(plan), {
    total: 3,
    startup: 1,
    interaction: 2,
    counts: {
      script: 0, image: 0, style: 0, font: 0, frame: 1, identity: 1, 'external-window': 0,
      generation: 1, 'custom-generation': 0, 'model-list': 0,
    },
    state: 'startup-blocked',
  })
  assert.equal(
    tavernScriptInteractionApprovalKey(
      'card-a', 'preset-a', 'model-list', 'character\u0000script-a', 'https://models.example.test',
    ),
    JSON.stringify([
      'card-a', 'preset-a', 'model-list', 'character\u0000script-a', 'https://models.example.test',
    ]),
  )
})

test('keeps Session launch behind resource discovery and exact approvals', () => {
  assert.equal(tavernPreflightLaunchPhase({
    expected: false, loading: false, settled: false, pendingPermissions: 0,
  }), 'ready')
  assert.equal(tavernPreflightLaunchPhase({
    expected: true, loading: true, settled: false, pendingPermissions: 0,
  }), 'checking')
  assert.equal(tavernPreflightLaunchPhase({
    expected: true, loading: false, settled: false, pendingPermissions: 0,
  }), 'checking')
  assert.equal(tavernPreflightLaunchPhase({
    expected: true, loading: false, settled: true, pendingPermissions: 2,
  }), 'approval-required')
  assert.equal(tavernPreflightLaunchPhase({
    expected: true, loading: false, settled: true, pendingPermissions: 0,
  }), 'ready')
})

test('runs module plans through a Blob and reports ready only after evaluation', () => {
  const html = tavernScriptFrameSource({
    id: 'module-runtime', name: '模块兼容', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, {
    source: 'export const ready = true;', mode: 'module', preloads: ['vue', 'yaml', 'zod'],
    moduleDependencies: [{
      id: 'remote-module-0', placeholder: '__dsh_tavern_remote_module_0__', dependencies: [],
      source: 'window.parent.__dependencyReady = true;',
    }],
    needsDomPurify: false, needsFuse: false, compatibilityMarkers: ['__远程依赖_loaded__'],
  }, {
    scriptScope: 'character',
    scriptId: 'module-runtime', scriptName: '模块兼容', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  assert.match(html, /script-src 'unsafe-inline' 'unsafe-eval' blob:/u)
  assert.match(html, /connect-src 'none'/u)
  assert.match(html, /img-src data: blob:/u)
  assert.match(source!, /URL\.createObjectURL\(new Blob/u)
  assert.match(source!, /document\.__dshScriptWindow/u)
  assert.match(source!, /const window=__dshModuleWindow,parent=__dshModuleWindow,top=__dshModuleWindow/u)
  assert.match(source!, /var value=__dshModuleFacade\+plan\.source/u)
  assert.match(html, /data-dsh-runtime-vendor="jquery"/u)
  assert.match(html, /data-dsh-runtime-vendor="lodash"/u)
  assert.match(html, /data-dsh-runtime-vendor="yaml"/u)
  assert.match(html, /data-dsh-runtime-vendor="vue"/u)
  assert.match(html, /data-dsh-runtime-vendor="zod"/u)
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/(?:jquery|lodash|vue|yaml|zod)@/u)
  assert.match(source!, /var __dshDeclaredCompatibilityMarkers=\["__远程依赖_loaded__"\]/u)
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/yaml@2\.9\.0/u)
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/(?:vue|zod)@/u)
  assert.ok(source!.indexOf('await import(__dshModuleUrl)') < source!.lastIndexOf("__dshPost('ready',"))
})

test('runs classic plans in an async function context', async () => {
  const html = tavernScriptFrameSource({
    id: 'classic-await-runtime', name: '异步经典脚本', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, {
    source: 'await Promise.resolve();window.__classicAwaitReady=true;', mode: 'classic', preloads: [],
    inlineDependencies: [], needsDomPurify: false, needsFuse: false, compatibilityMarkers: [],
  }, {
    scriptScope: 'character',
    scriptId: 'classic-await-runtime', scriptName: '异步经典脚本', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  assert.match(source!, /await __dshRunClassic/u)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  await new Promise(resolve => { setTimeout(resolve, 0) })
  assert.equal(context.__classicAwaitReady, true)
  assert.equal((context.posted as Record<string, unknown>[])
    .some(message => message.action === 'ready'), true)
})

test('replays an approved stylesheet fetch locally while keeping iframe connections disabled', async () => {
  const stylesheetUrl = 'https://styles.example.test/theme.css'
  const stylesheetSource = '@font-face{font-family:test;src:url(https://fonts.example.test/test.woff2)}'
  const html = tavernScriptFrameSource({
    id: 'stylesheet-runtime', name: '在线字体', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, {
    source: `window.__stylesheetText=await fetch(${JSON.stringify(stylesheetUrl)}).then(response=>response.text());`,
    mode: 'classic', preloads: [], inlineDependencies: [], needsDomPurify: false, needsFuse: false,
    compatibilityMarkers: [], remoteStyleOrigins: ['https://styles.example.test'],
    remoteStylesheetUrls: [stylesheetUrl], remoteFontOrigins: ['https://fonts.example.test'],
    stylesheetDependencies: [{ url: stylesheetUrl, source: stylesheetSource, status: 200 }],
  }, {
    scriptScope: 'character', scriptId: 'stylesheet-runtime', scriptName: '在线字体', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    approvedStyleOrigins: ['https://styles.example.test'], approvedFontOrigins: ['https://fonts.example.test'],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  assert.match(html, /connect-src 'none'/u)
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([]) as ReturnType<typeof runtimeAcceptanceContext> & {
    Response: typeof Response
    __stylesheetText?: string
  }
  context.Response = Response
  runInNewContext(source!, context)
  await new Promise(resolve => { setTimeout(resolve, 0) })
  assert.equal(context.__stylesheetText, stylesheetSource)
})

test('replays an approved stylesheet HTTP failure without failing its script plan', async () => {
  const stylesheetUrl = 'https://styles.example.test/missing.css'
  const html = tavernScriptFrameSource({
    id: 'stylesheet-fallback', name: '字体回退', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, {
    source: `window.__stylesheetStatus=await fetch(${JSON.stringify(stylesheetUrl)}).then(response=>response.status);`,
    mode: 'classic', preloads: [], inlineDependencies: [], needsDomPurify: false, needsFuse: false,
    compatibilityMarkers: [], remoteStyleOrigins: ['https://styles.example.test'],
    remoteStylesheetUrls: [stylesheetUrl], remoteFontOrigins: [],
    stylesheetDependencies: [{ url: stylesheetUrl, source: 'not found', status: 404 }],
  }, {
    scriptScope: 'character', scriptId: 'stylesheet-fallback', scriptName: '字体回退', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    approvedStyleOrigins: ['https://styles.example.test'], approvedFontOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([]) as ReturnType<typeof runtimeAcceptanceContext> & {
    Response: typeof Response
    __stylesheetStatus?: number
  }
  context.Response = Response
  runInNewContext(source!, context)
  await new Promise(resolve => { setTimeout(resolve, 0) })
  assert.equal(context.__stylesheetStatus, 404)
})

test('reports only bounded true compatibility markers after startup and on request', async () => {
  const html = tavernScriptFrameSource({
    id: 'marker-runtime', name: '依赖标记', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, 'window.__辅助计算脚本_loaded__=true;window.__小手机脚本_loaded__=false;window.__invalid=true;', {
    scriptScope: 'character',
    scriptId: 'marker-runtime', scriptName: '依赖标记', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  await new Promise(resolve => { setTimeout(resolve, 0) })
  const ready = (context.posted as Record<string, unknown>[]).find(message => message.action === 'ready')

  assert.deepEqual(JSON.parse(JSON.stringify(ready?.markers)), ['__辅助计算脚本_loaded__'])
  context.__迟到依赖_loaded__ = true
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({ action: 'compatibility-markers-request' })
  const refreshed = (context.posted as Record<string, unknown>[]).findLast(
    message => message.action === 'compatibility-markers',
  )
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed?.markers)), [
    '__辅助计算脚本_loaded__', '__迟到依赖_loaded__',
  ])
  assert.deepEqual(validatedTavernCompatibilityMarkers([
    '__辅助计算脚本_loaded__', '__辅助计算脚本_loaded__', '__invalid marker_loaded__', true,
  ]), ['__辅助计算脚本_loaded__'])
})

test('hosts SillyTavern extension menu entries inside the isolated script panel', async () => {
  const script = [
    "window.__extensionMenuFound=$('#extensionsMenu',document).length;",
    "var item=$('<button>',{id:'database-menu-item',text:'打开数据库',click:function(){var panel=document.createElement('section');panel.id='database-panel';document.body.appendChild(panel)}});",
    "$('#extensionsMenu',document).append(item);",
  ].join('')
  const html = tavernScriptFrameSource({
    id: 'extension-menu-runtime', name: '扩展菜单', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'extension-menu-runtime', scriptName: '扩展菜单', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  assert.match(html, /#extensionsMenu:empty\{display:none\}/u)
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  await new Promise<void>(resolve => { setImmediate(resolve) })

  const document = context.document as {
    getElementById(id: string): RuntimeElement | undefined
  }
  const menu = document.getElementById('extensionsMenu')
  assert.equal(context.__extensionMenuFound, 1)
  assert.equal(menu?.dataset.dshCompatibilitySurface, 'extensions-menu')
  assert.equal(menu?.children.length, 1)
  document.getElementById('database-menu-item')?.click()
  assert.notEqual(document.getElementById('database-panel'), undefined)
})

test('provides the isolated trigger required by the public mobile-phone module', () => {
  const html = tavernScriptFrameSource({
    id: 'mobile-runtime', name: '小手机', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, {
    source: "window.__mobileOpened=0;$('#mobile-trigger-btn').remove();$('<button>',{id:'mobile-trigger-btn',title:'手机入口',text:'手机',click:function(){window.__mobileOpened+=1}}).appendTo(document.body);window.__mobileTriggerFound=$('#mobile-trigger-btn').length;window.__小手机脚本_loaded__=true;", mode: 'classic', preloads: [], inlineDependencies: [],
    needsDomPurify: false, needsFuse: false, compatibilityMarkers: ['__小手机脚本_loaded__'],
  }, {
    scriptScope: 'character',
    scriptId: 'mobile-runtime', scriptName: '小手机', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
    approvedImageOrigins: ['https://images.example.test'],
    approvedFontOrigins: ['https://fonts.example.test'],
  })
  assert.match(html, /img-src data: blob: https:\/\/images\.example\.test/u)
  assert.match(html, /font-src https:\/\/fonts\.example\.test/u)
  assert.match(html, /\.fa-cloud::before/u)
  assert.match(html, /data:image\/svg\+xml/u)
  assert.match(html, /#mobile-phone-overlay#mobile-phone-overlay\{color-scheme:light\}/u)
  assert.match(html, /\.phone-size-reset-btn\{align-items:center!important;color:#2d3748!important/u)
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const trigger = (context.document as { getElementById(id: string): RuntimeElement | undefined })
    .getElementById('mobile-trigger-btn') as RuntimeElement & { readonly textContent?: string }
  assert.equal(trigger.textContent, '手机')
  assert.equal(trigger.getAttribute('title'), '手机入口')
  assert.equal(context.__mobileTriggerFound, 1)
  assert.equal(context.__mobileOpened, 0)
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'compatibility-surface-open', surface: 'mobile-trigger',
  })
  assert.equal(context.__mobileOpened, 1)
})

test('opens a draggable mobile trigger through its pointer gesture', () => {
  const html = tavernScriptFrameSource({
    id: 'pointer-mobile-runtime', name: '手势小手机', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, {
    source: [
      'window.__pointerMobileOpened=0;',
      "var trigger=document.getElementById('mobile-trigger-btn');",
      "trigger.addEventListener('pointerdown',function(event){",
      'event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);',
      'var startX=event.clientX,startY=event.clientY;',
      "window.addEventListener('pointerup',function(up){trigger.releasePointerCapture(up.pointerId);if(Math.abs(up.clientX-startX)<2&&Math.abs(up.clientY-startY)<2)window.__pointerMobileOpened+=1})",
      '});',
      'window.__小手机脚本_loaded__=true;',
    ].join(''),
    mode: 'classic', preloads: [], inlineDependencies: [], needsDomPurify: false, needsFuse: false,
    compatibilityMarkers: ['__小手机脚本_loaded__'],
  }, {
    scriptScope: 'character',
    scriptId: 'pointer-mobile-runtime', scriptName: '手势小手机', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  class RuntimePointerEvent {
    currentTarget: RuntimeElement | undefined
    defaultPrevented = false
    target: RuntimeElement | undefined
    readonly type: string
    readonly bubbles: boolean
    readonly cancelable: boolean
    readonly clientX: number
    readonly clientY: number
    readonly pointerId: number

    constructor(type: string, init: Record<string, unknown>) {
      this.type = type
      this.target = undefined
      this.bubbles = init.bubbles === true
      this.cancelable = init.cancelable === true
      this.clientX = Number(init.clientX)
      this.clientY = Number(init.clientY)
      this.pointerId = Number(init.pointerId)
    }

    preventDefault(): void { if (this.cancelable) this.defaultPrevented = true }
    stopPropagation(): void {}
  }
  context.PointerEvent = RuntimePointerEvent
  context.dispatchEvent = (event: RuntimePointerEvent): boolean => {
    ;(context.dispatchWindow as (type: string, value: unknown) => void)(event.type, event)
    return !event.defaultPrevented
  }
  runInNewContext(source!, context)

  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'compatibility-surface-open', surface: 'mobile-trigger',
  })
  assert.equal(context.__pointerMobileOpened, 1)
})

test('keeps an already-open public mobile surface open when the Host panel returns', () => {
  const html = tavernScriptFrameSource({
    id: 'reopen-mobile-runtime', name: '重开小手机', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, {
    source: [
      'window.__mobileOpenCalls=0;',
      "var overlay=document.createElement('div');overlay.id='mobile-phone-overlay';document.body.appendChild(overlay);",
      "window.openMobilePhone=function(){window.__mobileOpenCalls+=1;overlay.classList.add('active')};",
      'window.__小手机脚本_loaded__=true;',
    ].join(''),
    mode: 'classic', preloads: [], inlineDependencies: [], needsDomPurify: false, needsFuse: false,
    compatibilityMarkers: ['__小手机脚本_loaded__'], remoteImageOrigins: [],
  }, {
    scriptScope: 'character',
    scriptId: 'reopen-mobile-runtime', scriptName: '重开小手机', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)

  const open = (): void => {
    ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
      action: 'compatibility-surface-open', surface: 'mobile-trigger',
    })
  }
  open()
  open()
  assert.equal(context.__mobileOpenCalls, 1)
})

test('reports bounded script error positions without exposing source locations', () => {
  const html = tavernScriptFrameSource({
    id: 'error-runtime', name: '错误定位', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, '', {
    scriptScope: 'character',
    scriptId: 'error-runtime', scriptName: '错误定位', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)

  ;(context.dispatchWindow as (type: string, event: unknown) => void)('error', {
    error: { name: 'TypeError', message: '缺少目标', stack: 'TypeError: 缺少目标\n    at run (https://private.example/card.js:27:14)' },
    lineno: 27,
    colno: 14,
  })
  const reported = (context.posted as Record<string, unknown>[]).findLast(message => message.action === 'runtime-error')
  assert.equal(reported?.value, 'TypeError: 缺少目标（行 27，列 14）')
  assert.equal(JSON.stringify(reported).includes('private.example'), false)
})

test('exposes jQuery-compatible numeric collection access to isolated scripts', () => {
  const script = [
    "var first=document.createElement('button'),second=document.createElement('button'),child=document.createElement('span');",
    'first.appendChild(child);',
    'var buttons=$([first,second]);',
    'var listener=function(){}; buttons.bind("click.compat",listener).off("click.compat",listener).toggle(false).toggle(true).data("ready",true);',
    "buttons[0].style.setProperty('display','block');",
    "buttons[0].addEventListener('click',function(){});",
    'window.__miniCollection={length:buttons.length,first:buttons[0]===first,last:buttons.get(-1)===second,eq:buttons.eq(1)[0]===second,array:buttons.toArray().length,data:buttons.data("ready"),parentWindow:$(window.parent).length,parentWidth:$(window.parent).width(),parentHeight:$(window.parent).height(),add:buttons.add(child).length,has:$(first).has(child).length,map:buttons.map(function(){return this}).length,slice:buttons.slice(1).length};',
  ].join('\n')
  const html = tavernScriptFrameSource({
    id: 'mini-runtime', name: '集合兼容', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'mini-runtime', scriptName: '集合兼容', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)

  assert.deepEqual(JSON.parse(JSON.stringify(context.__miniCollection)), {
    length: 2, first: true, last: true, eq: true, array: 2, data: true, parentWindow: 1,
    parentWidth: 1024, parentHeight: 768, add: 3, has: 1, map: 2, slice: 1,
  })
})

test('provides the common Tavern Helper lodash surface without opening network access', () => {
  const script = String.raw`
var values = [1, 2, 3, 4];
var removed = _.remove(values, function(value) { return value % 2 === 0; });
window.__lodashSurface = {
  escaped: _.escape('<&>"'),
  object: _.isObject({}),
  date: _.isDate(new Date(0)),
  string: _.isString(new String('x')),
  path: _.toPath('a[0].b'),
  unique: _.uniq([1, 1, 2]),
  concatenated: _.concat([1], [2, 3], 4),
  remaining: values,
  removed: removed,
  intersection: _.intersectionBy([{ id: 1 }, { id: 2 }], [{ id: 2 }], function(item) { return item.id; }).map(function(item) { return item.id; }),
  empty: _.isEmpty({}),
  mapped: _.mapValues({ a: 2 }, function(value) { return value * 3; }),
  sorted: _.sortBy([{ rank: 2 }, { rank: 1 }], 'rank').map(function(value) { return value.rank; }),
  flattened: _.flatMap([{ values: [1, 2] }, { values: [3] }], 'values'),
  some: _.some([{ ready: false }, { ready: true }], ['ready', true]),
  updated: _.update({ nested: { value: 2 } }, 'nested.value', function(value) { return value * 4; }),
  nil: [_.isNil(null), _.isNil(undefined), _.isNil(0)],
  dropped: _.dropRight([1, 2, 3], 2),
  pulled: (function() { var value = ['a', 'b', 'c']; return { removed: _.pullAt(value, [0, 2]), value: value }; })(),
  last: _.last(['a', 'b']),
  saveChat: typeof SillyTavern.saveChat().then === 'function',
};
`
  const html = tavernScriptFrameSource({
    id: 'lodash-runtime', name: '工具兼容', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'lodash-runtime', scriptName: '工具兼容', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)

  assert.deepEqual(JSON.parse(JSON.stringify(context.__lodashSurface)), {
    escaped: '&lt;&amp;&gt;&quot;', object: true, date: true, string: true,
    path: ['a', '0', 'b'], unique: [1, 2], concatenated: [1, 2, 3, 4],
    remaining: [1, 3], removed: [2, 4], intersection: [2], empty: true, mapped: { a: 6 }, saveChat: true,
    sorted: [1, 2], flattened: [1, 2, 3], some: true, updated: { nested: { value: 8 } },
    nil: [true, true, false], dropped: [1], pulled: { removed: ['a', 'c'], value: ['b'] }, last: 'b',
  })
})

test('bridges SillyTavern saveChat root fields without letting scripts overwrite Host transcript fields', async () => {
  const checkpoint = {
    default: {
      storageFrame: {
        revision: 1,
        checkpoint: { 纪要表: [{ row_id: 'AM0001' }] },
        operationLog: [],
      },
    },
  }
  const html = tavernScriptFrameSource({
    id: 'database', name: '数据库', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, '', {
    scriptScope: 'character',
    scriptId: 'database', scriptName: '数据库', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [],
    messages: [
      { messageId: 0, seq: 4, role: 'user', text: '开始', isHidden: false, data: {}, extra: {} },
      {
        messageId: 1, seq: 7, role: 'assistant', text: '回复', isHidden: false, data: {}, extra: {},
        annotations: { TavernDB_ACU_IsolatedData: checkpoint, TavernDB_ACU_Identity: 'fixture' },
      },
    ],
    characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const sillyTavern = context.SillyTavern as {
    readonly chat: Record<string, unknown>[]
    readonly saveChat: () => Promise<void>
  }
  assert.deepEqual(JSON.parse(JSON.stringify(sillyTavern.chat[1]?.TavernDB_ACU_IsolatedData)), checkpoint)

  ;((sillyTavern.chat[1]!.TavernDB_ACU_IsolatedData as typeof checkpoint)
    .default.storageFrame).revision = 2
  sillyTavern.chat[1]!.mes = '脚本不能伪造的正文'
  sillyTavern.chat[1]!.extra = { forged: true }
  await sillyTavern.saveChat()

  const posted = context.posted as Record<string, unknown>[]
  const mutation = posted.findLast(message => message.action === 'chat-mutate') as {
    readonly request?: unknown
  } | undefined
  assert.deepEqual(JSON.parse(JSON.stringify(mutation?.request)), {
    format: 0,
    operation: 'replace-message-annotations',
    messages: [{
      message_id: 1,
      value: {
        TavernDB_ACU_IsolatedData: {
          default: {
            storageFrame: {
              revision: 2,
              checkpoint: { 纪要表: [{ row_id: 'AM0001' }] },
              operationLog: [],
            },
          },
        },
        TavernDB_ACU_Identity: 'fixture',
      },
    }],
  })
  const saved = posted.filter(message => message.action === 'chat-mutate').length
  await sillyTavern.saveChat()
  assert.equal(posted.filter(message => message.action === 'chat-mutate').length, saved)
})

test('embeds the common Tavern Helper browser libraries without remote startup requests', () => {
  const html = tavernScriptFrameSource({
    id: 'offline-runtime', name: '离线运行时', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, {
    source: '', mode: 'classic', preloads: ['vue', 'yaml', 'zod'], inlineDependencies: [],
    needsDomPurify: false, needsFuse: false, compatibilityMarkers: [],
  }, {
    scriptScope: 'character',
    scriptId: 'offline-runtime', scriptName: '离线运行时', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [],
  })

  assert.match(html, /data-dsh-runtime-vendor="jquery"/u)
  assert.match(html, /data-dsh-runtime-vendor="lodash"/u)
  assert.match(html, /data-dsh-runtime-vendor="yaml"/u)
  assert.match(html, /data-dsh-runtime-vendor="vue"/u)
  assert.match(html, /data-dsh-runtime-vendor="zod"/u)
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/(?:jquery|lodash|vue|yaml|zod)@/u)
})

test('bridges external OAuth windows without relaxing the Tavern script sandbox', () => {
  const script = String.raw`
window.__externalLoginMessage = null;
window.__externalLoginMessages = 0;
window.addEventListener('message', event => {
  if (event.data?.channel === 'workshop:auth') {
    window.__externalLoginMessages += 1;
    window.__externalLoginMessage = { origin: event.origin, value: event.data };
  }
});
window.__externalWindow = window.open(
  'https://discord.com/oauth2/authorize?client_id=public-test',
  'discord_login',
  'width=600,height=800',
);
window.__blockedExternalWindow = window.open('http://unsafe.example.test/login');
`
  const html = tavernScriptFrameSource({
    id: 'external-login', name: '外部登录', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'external-login', scriptName: '外部登录', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const request = (context.posted as Record<string, unknown>[]).find(message => (
    message.action === 'capability-request' && message.capability === 'ui.external-window.open'
  ))
  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    source: 'dsh-agent-rp-tavern-script', scriptId: 'external-login', action: 'capability-request', requestId: '1',
    capability: 'ui.external-window.open',
    payload: {
      url: 'https://discord.com/oauth2/authorize?client_id=public-test',
      target: 'discord_login', features: 'width=600,height=800',
    },
  })
  assert.equal(context.__blockedExternalWindow, null)
  const handle = context.__externalWindow as { closed: boolean; close(): void }
  assert.equal(handle.closed, false)
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'capability-result', capability: 'ui.external-window.open', requestId: '1', ok: true,
  })
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'external-window-message', requestId: '1', origin: 'https://workshop.example.test',
    value: { channel: 'workshop:auth', action: 'loginSuccess', hash: 'test-result' },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(context.__externalLoginMessage)), {
    origin: 'https://workshop.example.test',
    value: { channel: 'workshop:auth', action: 'loginSuccess', hash: 'test-result' },
  })
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'external-window-message', requestId: '1', origin: 'https://workshop.example.test',
    value: { channel: 'workshop:auth', action: 'loginSuccess', hash: 'test-result' },
  })
  assert.equal(context.__externalLoginMessages, 1)
  assert.equal((context.posted as Record<string, unknown>[]).filter(message => (
    message.action === 'external-window-delivered' && message.requestId === '1'
  )).length, 2)
  assert.ok((context.posted as Record<string, unknown>[]).some(message => (
    message.action === 'external-window-delivered' && message.requestId === '1'
  )))
  handle.close()
  assert.equal(handle.closed, true)
  assert.ok((context.posted as Record<string, unknown>[]).some(message => (
    message.action === 'external-window-close' && message.requestId === '1'
  )))
})

test('requests and receives a Host-owned native identity attestation without opening a window', async () => {
  const script = String.raw`
window.__identityResult = dshIdentity.request({
  audience: 'https://workshop.example.test',
  nonce: 'abcdefghijklmnop',
  includeDisplayName: true,
});
`
  const html = tavernScriptFrameSource({
    id: 'native-identity', name: '原生身份', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'native-identity', scriptName: '原生身份', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const request = (context.posted as Record<string, unknown>[]).find(message => (
    message.action === 'capability-request' && message.capability === 'identity.native.attest'
  ))
  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    source: 'dsh-agent-rp-tavern-script', scriptId: 'native-identity', action: 'capability-request',
    requestId: '1', capability: 'identity.native.attest', payload: {
      audience: 'https://workshop.example.test', nonce: 'abcdefghijklmnop', includeDisplayName: true,
    },
  })
  const result = {
    format: 0, provider: 'dsh-native', attestation: 'header.payload.signature',
    expiresAt: 1_800_000_300_000, keyId: 'public-key-id',
    publicKey: { kty: 'EC', crv: 'P-256', x: 'public-x', y: 'public-y' },
  }
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'capability-result', capability: 'identity.native.attest', requestId: '1', ok: true, value: result,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(await context.__identityResult)), result)
})

test('relays an embedded HTTPS service identity request without changing the containing card script', async () => {
  const html = tavernScriptFrameSource({
    id: 'workshop-host', name: '工坊容器', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, '', {
    scriptScope: 'character',
    scriptId: 'workshop-host', scriptName: '工坊容器', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)

  const child = {}
  const frame = (context.document as { createElement(tag: string): RuntimeElement }).createElement('iframe')
  frame.contentWindow = child
  frame.setAttribute('src', 'https://workshop.example.test/?embed=1')
  ;(context.document as { body: RuntimeElement }).body.appendChild(frame)
  const replies: unknown[] = []
  let closed = 0
  const port = { postMessage(value: unknown) { replies.push(value) }, close() { closed += 1 } }
  ;(context.dispatchWindow as (type: string, event: unknown) => void)('message', {
    source: child,
    ports: [port],
    data: {
      channel: 'dsh-agent-rp:identity', action: 'request', format: 0, requestId: 'workshop-1',
      audience: 'https://workshop.example.test', nonce: 'abcdefghijklmnop', includeDisplayName: false,
    },
  })
  const request = (context.posted as Record<string, unknown>[]).find(message => (
    message.action === 'capability-request' && message.capability === 'identity.native.attest'
  ))
  assert.deepEqual(JSON.parse(JSON.stringify(request)), {
    source: 'dsh-agent-rp-tavern-script', scriptId: 'workshop-host', action: 'capability-request',
    requestId: '1', capability: 'identity.native.attest', payload: {
      audience: 'https://workshop.example.test', nonce: 'abcdefghijklmnop', includeDisplayName: false,
    },
  })
  const result = {
    format: 0, provider: 'dsh-native', attestation: 'header.payload.signature', expiresAt: 1_800_000_300_000,
    keyId: 'public-key-id', publicKey: { kty: 'EC', crv: 'P-256', x: 'public-x', y: 'public-y' },
  }
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'capability-result', capability: 'identity.native.attest', requestId: '1', ok: true, value: result,
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(replies)), [{
    channel: 'dsh-agent-rp:identity', action: 'result', format: 0, requestId: 'workshop-1', ok: true,
    value: result,
  }])
  assert.equal(closed, 1)

  const mismatchedReplies: unknown[] = []
  ;(context.dispatchWindow as (type: string, event: unknown) => void)('message', {
    source: child,
    ports: [{ postMessage(value: unknown) { mismatchedReplies.push(value) }, close() {} }],
    data: {
      channel: 'dsh-agent-rp:identity', action: 'request', format: 0, requestId: 'workshop-2',
      audience: 'https://other.example.test', nonce: 'abcdefghijklmnop', includeDisplayName: false,
    },
  })
  assert.deepEqual(mismatchedReplies, [])
  assert.equal((context.posted as Record<string, unknown>[]).filter(message => (
    message.action === 'capability-request' && message.capability === 'identity.native.attest'
  )).length, 1)
})

test('validates native identity requests at the opaque Tavern frame boundary', () => {
  const valid = {
    source: 'dsh-agent-rp-tavern-script', scriptId: 'native-identity',
    action: 'capability-request', capability: 'identity.native.attest', requestId: 'identity-1',
    payload: {
      audience: 'https://workshop.example.test', nonce: 'abcdefghijklmnop', includeDisplayName: false,
    },
  }
  assert.deepEqual(parseTavernNativeIdentityCapabilityRequest(valid), {
    requestId: 'identity-1', audience: 'https://workshop.example.test',
    nonce: 'abcdefghijklmnop', includeDisplayName: false,
  })
  for (const invalid of [
    { ...valid, payload: { ...valid.payload, audience: 'http://workshop.example.test' } },
    { ...valid, payload: { ...valid.payload, audience: 'https://workshop.example.test/path' } },
    { ...valid, payload: { ...valid.payload, nonce: 'short' } },
    { ...valid, payload: { ...valid.payload, sourceText: 'not accepted' } },
    { ...valid, ignored: 'not accepted' },
    { ...valid, ignored: '猫'.repeat(8_000) },
  ]) assert.equal(parseTavernNativeIdentityCapabilityRequest(invalid), undefined)
})

test('validates external-window requests and bounded callback messages at the opaque-frame boundary', () => {
  const valid = {
    action: 'capability-request', capability: 'ui.external-window.open', requestId: 'external-1',
    payload: {
      url: 'https://discord.com/oauth2/authorize?client_id=public-test',
      target: 'discord_login', features: 'width=600,height=800',
    },
  }
  assert.deepEqual(parseTavernExternalWindowCapabilityRequest(valid), {
    requestId: 'external-1', url: 'https://discord.com/oauth2/authorize?client_id=public-test',
    target: 'discord_login', features: 'width=600,height=800',
  })
  assert.equal(parseTavernExternalWindowCapabilityRequest({
    ...valid, payload: { ...valid.payload, url: 'http://discord.com/oauth2/authorize' },
  }), undefined)
  assert.equal(parseTavernExternalWindowCapabilityRequest({
    ...valid, payload: { ...valid.payload, url: 'https://user:password@example.test/login' },
  }), undefined)
  assert.equal(parseTavernExternalWindowCapabilityRequest({
    ...valid, payload: { ...valid.payload, target: 'x'.repeat(201) },
  }), undefined)
  assert.equal(parseTavernExternalWindowCapabilityRequest({ ...valid, ignored: '猫'.repeat(8_000) }), undefined)
  assert.equal(validExternalWindowMessage('tavern-script-frame-v0',
    'https://workshop.example.test', { channel: 'workshop:auth', action: 'loginSuccess' },
  ), true)
  assert.equal(validExternalWindowMessage('tavern-script-frame-v0', 'null', { action: 'loginSuccess' }), false)
  assert.equal(validExternalWindowMessage(
    'tavern-script-frame-v0', 'https://workshop.example.test/path', { action: 'loginSuccess' },
  ), false)
  assert.equal(validExternalWindowMessage(
    'tavern-script-frame-v0', 'https://workshop.example.test', '猫'.repeat(70_000),
  ), false)
})

test('bridges Tavern confirmation popups to the Host and returns custom results', async () => {
  const script = String.raw`
window.__popupResult = SillyTavern.callGenericPopup(
  builtin.renderMarkdown('**要保存吗？**'),
  SillyTavern.POPUP_TYPE.CONFIRM,
  '',
  { okButton: '保存', cancelButton: '放弃', customButtons: ['稍后'] },
);
toastr.success('已打开确认框');
`
  const html = tavernScriptFrameSource({
    id: 'popup', name: '确认保存', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'popup', scriptName: '确认保存', scriptInfo: '', buttons: [],
    characterName: '白露', characterId: 'bailu.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const popup = (context.posted as Record<string, unknown>[]).find(message => message.action === 'capability-request')
  assert.deepEqual(JSON.parse(JSON.stringify(popup)), {
    source: 'dsh-agent-rp-tavern-script', scriptId: 'popup', action: 'capability-request', requestId: '1',
    capability: 'ui.popup.open',
    payload: {
      popupType: 2, content: '<p><strong>要保存吗？</strong></p>', inputValue: '',
      options: {
        okButton: '保存', cancelButton: '放弃',
        customButtons: [{ text: '稍后', result: 2 }],
      },
    },
  })
  const toast = (context.posted as Record<string, unknown>[]).find(message => message.action === 'toast')
  assert.deepEqual(JSON.parse(JSON.stringify(toast)), {
    source: 'dsh-agent-rp-tavern-script', scriptId: 'popup', action: 'toast',
    level: 'success', value: '已打开确认框',
  })
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'capability-result', capability: 'ui.popup.open', requestId: '1', ok: true, value: 2,
  })
  assert.equal(await context.__popupResult, 2)
})

test('supports modern Popup instances and Popup.show convenience methods', async () => {
  const script = String.raw`
window.__modernPopup = {
  confirm: SillyTavern.Popup.show.confirm('删除记录', '**确定吗？**'),
  input: new SillyTavern.Popup('<p>新的名字</p>', SillyTavern.POPUP_TYPE.INPUT, '旧名字', {
    placeholder: '输入名字',
  }).show(),
};
`
  const html = tavernScriptFrameSource({
    id: 'modern-popup', name: '现代弹窗', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'modern-popup', scriptName: '现代弹窗', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const popups = (context.posted as Record<string, unknown>[]).filter(message => message.action === 'capability-request')
  assert.equal(popups.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(popups)), [{
    source: 'dsh-agent-rp-tavern-script', scriptId: 'modern-popup', action: 'capability-request', requestId: '1',
    capability: 'ui.popup.open', payload: {
      popupType: 2, content: '<h3>删除记录</h3><p><strong>确定吗？</strong></p>', inputValue: '', options: {},
    },
  }, {
    source: 'dsh-agent-rp-tavern-script', scriptId: 'modern-popup', action: 'capability-request', requestId: '2',
    capability: 'ui.popup.open', payload: {
      popupType: 3, content: '<p>新的名字</p>', inputValue: '旧名字', options: { placeholder: '输入名字' },
    },
  }])
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'capability-result', capability: 'ui.popup.open', requestId: '1', ok: true, value: 1,
  })
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'capability-result', capability: 'ui.popup.open', requestId: '2', ok: true, value: '新名字',
  })
  const result = context.__modernPopup as { confirm: Promise<boolean>; input: Promise<string> }
  assert.equal(await result.confirm, true)
  assert.equal(await result.input, '新名字')
})

test('validates typed popup capability requests at the opaque-frame boundary', () => {
  const valid = {
    action: 'capability-request', capability: 'ui.popup.open', requestId: 'request-1',
    payload: {
      popupType: 3, content: '<p>名称</p>', inputValue: '旧名称',
      options: { placeholder: '新名称', customButtons: [{ text: '保留', result: 2 }] },
    },
  }
  assert.deepEqual(parseTavernPopupCapabilityRequest(valid), {
    requestId: 'request-1', type: 3, content: '<p>名称</p>', inputValue: '旧名称',
    options: { placeholder: '新名称', customButtons: [{ text: '保留', result: 2 }] },
  })
  assert.equal(parseTavernPopupCapabilityRequest({ ...valid, capability: 'future.popup' }), undefined)
  assert.equal(parseTavernPopupCapabilityRequest({ ...valid, requestId: 'x'.repeat(129) }), undefined)
  assert.equal(parseTavernPopupCapabilityRequest({
    ...valid, payload: { ...valid.payload, content: 'x'.repeat(262_145) },
  }), undefined)
  assert.equal(parseTavernPopupCapabilityRequest({
    ...valid, payload: { ...valid.payload, options: { okButton: 'x'.repeat(201) } },
  }), undefined)
  assert.equal(parseTavernPopupCapabilityRequest({
    ...valid, payload: { ...valid.payload, options: { customButtons: Array.from({ length: 10 }, () => ({ text: 'x', result: 1 })) } },
  }), undefined)
  assert.equal(parseTavernPopupCapabilityRequest({
    ...valid, ignored: '猫'.repeat(700_000),
  }), undefined)
})

test('persists extension settings and exposes the lodash debounce used by public Tavern scripts', async () => {
  const script = String.raw`
const st = SillyTavern.getContext();
const sameSettings = st.extensionSettings === extension_settings;
st.extensionSettings.cardRefinery.theme = 'night';
const calls = [];
const saveDraft = st.libs.lodash.debounce(value => calls.push(value), 100);
saveDraft('old');
saveDraft('latest');
const pendingBeforeFlush = saveDraft.pending();
saveDraft.flush();
saveDraft('cancelled');
saveDraft.cancel();
window.__tavernSettings = {
  sameSettings,
  clone: st.libs.lodash.cloneDeep(st.extensionSettings),
  calls,
  pendingBeforeFlush,
  pendingAfterCancel: saveDraft.pending(),
  save: builtin.saveSettings(),
};
`
  const html = tavernScriptFrameSource({
    id: 'settings', name: '扩展设置', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'settings', scriptName: '扩展设置', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    extensionSettings: { cardRefinery: { theme: 'light', autosave: true } },
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  await (context.__tavernSettings as { save: Promise<void> }).save
  const result = JSON.parse(JSON.stringify(context.__tavernSettings)) as Record<string, unknown>
  assert.equal(result.sameSettings, true)
  assert.deepEqual(result.clone, { cardRefinery: { theme: 'night', autosave: true } })
  assert.deepEqual(result.calls, ['latest'])
  assert.equal(result.pendingBeforeFlush, true)
  assert.equal(result.pendingAfterCancel, false)
  const save = (context.posted as Record<string, unknown>[]).find(message => (
    message.action === 'capability-request' && message.capability === 'settings.extension.persist'
  ))
  assert.deepEqual(JSON.parse(JSON.stringify(save)), {
    source: 'dsh-agent-rp-tavern-script', scriptId: 'settings', action: 'capability-request', requestId: '1',
    capability: 'settings.extension.persist',
    payload: { settings: { cardRefinery: { theme: 'night', autosave: true } } },
  })
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'extension-settings-sync', settings: { shared: { revision: 2 } },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(context.extension_settings)), { shared: { revision: 2 } })
})

test('bridges localforage data and isolated instances to Host-owned persistent storage', async () => {
  const script = String.raw`
window.__localforage = (async () => {
  const storage = SillyTavern.libs.localforage;
  const stored = await storage.setItem('session', { stage: 2, title: '钟楼' });
  const loaded = await storage.getItem('session');
  const custom = storage.createInstance({ name: 'card-refinery', storeName: 'sessions' });
  await custom.setItem('draft', ['第一步', '第二步']);
  const customKeys = await custom.keys();
  const iterated = [];
  await custom.iterate((value, key, iteration) => { iterated.push({ value, key, iteration }); });
  const isolated = await storage.getItem('draft');
  await storage.removeItem('session');
  return {
    stored, loaded, customKeys, iterated, isolated,
    rootLength: await storage.length(),
    customLength: await custom.length(),
    firstCustomKey: await custom.key(0),
  };
})();
`
  const html = tavernScriptFrameSource({
    id: 'localforage', name: '持久存储', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'localforage', scriptName: '持久存储', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  assert.deepEqual(JSON.parse(JSON.stringify(await context.__localforage)), {
    stored: { stage: 2, title: '钟楼' },
    loaded: { stage: 2, title: '钟楼' },
    customKeys: ['draft'],
    iterated: [{ value: ['第一步', '第二步'], key: 'draft', iteration: 1 }],
    isolated: null,
    rootLength: 0,
    customLength: 1,
    firstCustomKey: 'draft',
  })
  const requests = (context.posted as Record<string, unknown>[]).filter(
    message => message.action === 'capability-request' && message.capability === 'storage.script.persist',
  )
  assert.ok(requests.some(message => (message.payload as Record<string, unknown>).namespace === 'localforage\u0000keyvaluepairs'))
  assert.ok(requests.some(message => (message.payload as Record<string, unknown>).namespace === 'card-refinery\u0000sessions'))
})

test('validates typed persistent-storage requests and results at the opaque-frame boundary', () => {
  const valid = {
    action: 'capability-request', capability: 'storage.script.persist', requestId: 'storage-1',
    payload: {
      operation: 'set', namespace: 'localforage\u0000keyvaluepairs', key: 'session',
      value: { stage: 2, flags: [true, null, 'ready'] },
    },
  }
  assert.deepEqual(parseTavernStorageCapabilityRequest(valid), {
    requestId: 'storage-1',
    request: {
      operation: 'set', namespace: 'localforage\u0000keyvaluepairs', key: 'session',
      value: { stage: 2, flags: [true, null, 'ready'] },
    },
  })
  assert.equal(parseTavernStorageCapabilityRequest({ ...valid, capability: 'future.storage' }), undefined)
  assert.equal(parseTavernStorageCapabilityRequest({
    ...valid, payload: { ...valid.payload, key: undefined },
  }), undefined)
  assert.equal(parseTavernStorageCapabilityRequest({
    ...valid, payload: { operation: 'keys', namespace: 'store', key: 'smuggled' },
  }), undefined)
  assert.equal(parseTavernStorageCapabilityRequest({
    ...valid, payload: { ...valid.payload, value: new Map([['key', 'value']]) },
  }), undefined)
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.equal(parseTavernStorageCapabilityRequest({
    ...valid, payload: { ...valid.payload, value: cyclic },
  }), undefined)
  assert.equal(parseTavernStorageCapabilityRequest({ ...valid, ignored: '猫'.repeat(700_000) }), undefined)
  assert.equal(validTavernStorageCapabilityResult({ saved: true }), true)
  assert.equal(validTavernStorageCapabilityResult(undefined), true)
  assert.equal(validTavernStorageCapabilityResult(new Uint8Array([1, 2, 3])), false)
  assert.equal(validTavernStorageCapabilityResult('猫'.repeat(700_000)), false)
})

test('validates bounded extension-settings capability requests before Host persistence', () => {
  const valid = {
    source: 'dsh-agent-rp-tavern-script', action: 'capability-request',
    capability: 'settings.extension.persist', requestId: 'settings-1',
    payload: { settings: { sample: { enabled: true } } },
  }
  assert.deepEqual(parseTavernExtensionSettingsCapabilityRequest(valid), {
    requestId: 'settings-1', settings: { sample: { enabled: true } },
  })
  assert.equal(parseTavernExtensionSettingsCapabilityRequest({ ...valid, capability: 'future.settings' }), undefined)
  assert.equal(parseTavernExtensionSettingsCapabilityRequest({
    ...valid, payload: { settings: [] },
  }), undefined)
  assert.equal(parseTavernExtensionSettingsCapabilityRequest({
    ...valid, payload: { settings: { binary: new Uint8Array([1, 2, 3]) } },
  }), undefined)
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.equal(parseTavernExtensionSettingsCapabilityRequest({
    ...valid, payload: { settings: cyclic },
  }), undefined)
  assert.equal(parseTavernExtensionSettingsCapabilityRequest({ ...valid, ignored: '猫'.repeat(700_000) }), undefined)
})

test('exposes only the current lossless character card through SillyTavern context and getCharData', () => {
  const characterCard = {
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: '白露', nickname: '露露', description: '钟表匠', personality: '沉静', scenario: '打烊前',
      first_mes: '门还没锁。', mes_example: '<START>', alternate_greetings: ['今天来得很早。'],
      system_prompt: '', post_history_instructions: '', creator_notes: '', tags: [], creator: 'fixture',
      character_version: '1', extensions: { custom: { retained: true } },
    },
  }
  const script = String.raw`
const st = SillyTavern.getContext();
const first = getCharData('current');
first.description = 'sandbox copy';
window.__currentCharacter = {
  characterId: st.characterId,
  thisChid: st.this_chid,
  globalThisChid: this_chid,
  characterCount: st.characters.length,
  sameCharacters: st.characters === characters,
  indexedName: st.characters[st.characterId].name,
  current: getCharData('current'),
  byName: getCharData('白露'),
  byAvatar: getCharData('bailu.png'),
  missing: getCharData('另一张卡'),
  names: getCharacterNames(),
  ids: getCharacterIds(),
};
`
  const html = tavernScriptFrameSource({
    id: 'current-card', name: '当前角色', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'current-card', scriptName: '当前角色', scriptInfo: '', buttons: [],
    characterName: '露露', characterId: 'bailu.png', characterCard, chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const result = JSON.parse(JSON.stringify(context.__currentCharacter)) as Record<string, unknown>
  assert.equal(result.characterId, 0)
  assert.equal(result.thisChid, 0)
  assert.equal(result.globalThisChid, 0)
  assert.equal(result.characterCount, 1)
  assert.equal(result.sameCharacters, true)
  assert.equal(result.indexedName, '白露')
  assert.equal((result.current as Record<string, unknown>).description, '钟表匠')
  assert.equal(((result.current as { data: { extensions: { custom: { retained: boolean } } } })
    .data.extensions.custom.retained), true)
  assert.deepEqual(result.byName, result.current)
  assert.deepEqual(result.byAvatar, result.current)
  assert.equal(result.missing, null)
  assert.deepEqual(result.names, ['白露'])
  assert.deepEqual(result.ids, ['bailu.png'])
})

test('lets Tavern scripts replace the complete preset regex list', async () => {
  const script = String.raw`
window.__regexMutation = replaceTavernRegexes([{
  id: 'script-added', script_name: '', enabled: true,
  find_regex: '/old/gu', replace_string: 'new', trim_strings: [],
  source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
  destination: { display: true, prompt: false }, run_on_edit: false,
  min_depth: null, max_depth: null,
}], { type: 'preset', name: 'in_use' }).then(() => getTavernRegexes({ type: 'preset', name: 'in_use' }));
`
  const html = tavernScriptFrameSource({
    id: 'regex-editor', name: '正则编辑', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'regex-editor', scriptName: '正则编辑', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test',
    approvedScriptOrigins: [], preset: {
      name: '预设', revision: 1,
      value: { settings: {}, prompts: [], prompts_unused: [], extensions: { regex_scripts: [] } },
    },
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const stored = JSON.parse(JSON.stringify(await context.__regexMutation)) as Record<string, unknown>[]
  assert.equal(stored.length, 1)
  assert.equal(stored[0]?.script_name, '未命名-script-added')
  const posted = (context.posted as Record<string, unknown>[]).find(message => message.action === 'preset-replace')
  assert.equal(
    ((posted?.preset as { extensions?: { regex_scripts?: Record<string, unknown>[] } })
      ?.extensions?.regex_scripts?.[0]?.script_name),
    '未命名-script-added',
  )
})

test('lets Tavern scripts inspect current character regexes through new and legacy APIs', () => {
  const characterRegex = {
    id: 'character-regex', script_name: '角色状态栏', enabled: true,
    find_regex: '/status/gu', replace_string: '状态', trim_strings: [],
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false }, run_on_edit: false,
    min_depth: null, max_depth: null,
  }
  const presetRegex = { ...characterRegex, id: 'preset-regex', script_name: '预设清理' }
  const script = String.raw`
const mutable = getTavernRegexes({ type: 'character', name: 'current' });
mutable[0].script_name = '不应污染快照';
window.__regexReads = {
  enabled: isCharacterTavernRegexesEnabled(),
  character: getTavernRegexes({ type: 'character', name: '角色' }),
  preset: getTavernRegexes({ type: 'preset', name: 'in_use' }),
  global: getTavernRegexes({ type: 'global' }),
  legacyAll: getTavernRegexes(),
  legacyCharacter: getTavernRegexes({ scope: 'character', enable_state: 'enabled' }),
  legacyGlobal: getTavernRegexes({ scope: 'global' }),
};
`
  const html = tavernScriptFrameSource({
    id: 'regex-reader', name: '正则读取', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'regex-reader', scriptName: '正则读取', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    preset: {
      name: '预设', revision: 1,
      value: { settings: {}, prompts: [], prompts_unused: [], extensions: { regex_scripts: [presetRegex] } },
    },
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [characterRegex],
    presetScriptTrees: [], characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const result = JSON.parse(JSON.stringify(context.__regexReads)) as Record<string, unknown>
  assert.equal(result.enabled, true)
  assert.deepEqual(result.character, [characterRegex])
  assert.deepEqual(result.preset, [presetRegex])
  assert.deepEqual(result.global, [])
  assert.deepEqual(result.legacyAll, [{ ...characterRegex, scope: 'character' }])
  assert.deepEqual(result.legacyCharacter, [{ ...characterRegex, scope: 'character' }])
  assert.deepEqual(result.legacyGlobal, [])
})

test('lets Tavern scripts inspect preset and character script trees without sharing mutations', () => {
  const characterScript: TavernScriptSnapshot['characterScriptTrees'][number] = {
    type: 'script', enabled: true, name: '角色状态', id: 'character-status', content: 'void 0', info: '',
    button: { enabled: true, buttons: [{ name: '查看', visible: true }] }, data: { mode: 'compact' },
    export_with: { data: true, button: true },
  }
  const presetScript = { ...characterScript, name: '预设工具', id: 'preset-tool' }
  const script = String.raw`
const mutable = getScriptTrees({ type: 'character' });
mutable[0].name = '不应污染快照';
window.__scriptTrees = {
  character: getScriptTrees({ type: 'character' }),
  preset: getScriptTrees({ type: 'preset' }),
  global: getScriptTrees({ type: 'global' }),
  buttons: getAllEnabledScriptButtons(),
};
`
  const html = tavernScriptFrameSource({
    id: 'tree-reader', name: '脚本读取', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'tree-reader', scriptName: '脚本读取', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [],
    presetScriptTrees: [presetScript], characterScriptTrees: [characterScript], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const result = JSON.parse(JSON.stringify(context.__scriptTrees)) as Record<string, unknown>
  assert.deepEqual(result.character, [characterScript])
  assert.deepEqual(result.preset, [presetScript])
  assert.deepEqual(result.global, [])
  assert.deepEqual(result.buttons, {
    'character-status': [{ button_id: 'character-status_查看', button_name: '查看' }],
    'preset-tool': [{ button_id: 'preset-tool_查看', button_name: '查看' }],
  })
})

test('updates only the current script scope when duplicate ids exist', () => {
  const sharedScript: TavernScriptSnapshot['characterScriptTrees'][number] = {
    type: 'script', enabled: true, name: '同名脚本', id: 'shared', content: 'void 0', info: '',
    button: { enabled: false, buttons: [] }, data: { owner: 'character' },
    export_with: { data: true, button: true },
  }
  const html = tavernScriptFrameSource({
    id: 'shared', name: '预设同名脚本', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: { owner: 'preset' },
  }, `
replaceVariables({ owner: 'preset-updated' }, { type: 'script' });
window.__duplicateTrees = {
  preset: getScriptTrees({ type: 'preset' }),
  character: getScriptTrees({ type: 'character' }),
};
`, {
    scriptScope: 'preset',
    scriptId: 'shared', scriptName: '预设同名脚本', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: { owner: 'preset' } },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [],
    presetScriptTrees: [{ ...sharedScript, data: { owner: 'preset' } }],
    characterScriptTrees: [sharedScript], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const result = JSON.parse(JSON.stringify(context.__duplicateTrees)) as {
    readonly preset: readonly { readonly data: unknown }[]
    readonly character: readonly { readonly data: unknown }[]
  }
  assert.deepEqual(result.preset[0]?.data, { owner: 'preset-updated' })
  assert.deepEqual(result.character[0]?.data, { owner: 'character' })
})

test('persists synchronous and asynchronous Tavern script tree updates', async () => {
  const characterScript: TavernScriptSnapshot['characterScriptTrees'][number] = {
    type: 'script', enabled: true, name: '初始脚本', id: 'character-tool', content: 'void 0', info: '',
    button: { enabled: true, buttons: [{ name: '查看', visible: true }] }, data: { mode: 'compact' },
    export_with: { data: true, button: true },
  }
  const script = String.raw`
window.__acceptance = (async () => {
  await replaceVariables({ mode: 'fresh' }, { type: 'script' });
  const sync = updateScriptTreesWith(trees => trees.map(tree => ({ ...tree, name: '同步修改' })), { type: 'character' });
  const asyncResult = await updateScriptTreesWith(async trees => [{
    type: 'folder', enabled: true, name: '工具箱', id: 'tools', scripts: trees,
  }], { type: 'character' });
  return { sync, asyncResult, current: getScriptTrees({ type: 'character' }), buttons: getAllEnabledScriptButtons() };
})();
`
  const html = tavernScriptFrameSource({
    id: 'character-tool', name: '脚本写入', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'character-tool', scriptName: '脚本写入', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [],
    presetScriptTrees: [], characterScriptTrees: [characterScript], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const result = JSON.parse(JSON.stringify(await context.__acceptance)) as Record<string, unknown>
  assert.equal((result.sync as Record<string, unknown>[])[0]?.name, '同步修改')
  assert.deepEqual(result.current, result.asyncResult)
  assert.equal(((result.current as Record<string, unknown>[])[0]?.scripts as Record<string, unknown>[])[0]?.name, '同步修改')
  assert.deepEqual(result.buttons, {
    'character-tool': [{ button_id: 'character-tool_查看', button_name: '查看' }],
  })
  const writes = (context.posted as Record<string, unknown>[]).filter(message => message.action === 'worldbook-mutate')
  assert.equal(writes.length, 2)
  assert.deepEqual(writes.map(message => (message.request as Record<string, unknown>).operation), [
    'replace-script-trees', 'replace-script-trees',
  ])
  const firstTrees = (writes[0]?.request as { trees: { data: Record<string, unknown> }[] }).trees
  assert.equal(firstTrees[0]?.data.mode, 'fresh')
})

test('applies and unregisters Tavern Helper macro-like replacements', () => {
  const script = String.raw`
const registration = registerMacroLike(/\{\{mood::(.*?)\}\}/gu, (context, _match, mood) =>
  context.message_id + ':' + context.role + ':' + mood);
registerMacroLike(/\{\{mood::(.*?)\}\}/iu, () => 'duplicate must not win');
window.__macroBefore = formatAsTavernRegexedString('{{mood::平静}}', 'ai_output', 'display', { depth: 0 });
window.__macroDirect = substitudeMacros('{{char}}/<char>/<bot>/{{user}}/<user>/{{lastMessageId}}/{{messageId}}/{{mood::安心}}');
registration.unregister();
window.__macroAfter = formatAsTavernRegexedString('{{mood::平静}}', 'ai_output', 'display', { depth: 0 });
`
  const html = tavernScriptFrameSource({
    id: 'macro-runtime', name: '宏替换', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'macro-runtime', scriptName: '宏替换', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [],
    messages: [{ messageId: 0, seq: 1, role: 'assistant', text: '', isHidden: false, data: {}, extra: {} }],
    characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  assert.equal(context.__macroBefore, '0:assistant:平静')
  assert.equal(context.__macroDirect, '角色/角色/角色/用户/用户/0/0/0:assistant:安心')
  assert.equal(context.__macroAfter, '{{mood::平静}}')
})

test('exposes synchronous SillyTavern context macros from current transcript and variable scopes', () => {
  const script = String.raw`
const st = SillyTavern.getContext();
window.__sillyTavernMacros = {
  sameContext: st === SillyTavern,
  direct: substituteParams('{{lastMessage}}|{{lastUserMessage}}|{{lastCharMessage}}|{{get_message_variable::status}}|{{get_chat_variable::route.name}}|{{get_character_variable::profile.title}}|{{get_preset_variable::tone}}|{{get_global_variable::theme}}|{{get_global_variable::missing}}'),
  formatted: substituteParams('状态:\n  {{format_message_variable::status}}\n路线: {{format_chat_variable::route}} / {{format_character_variable::profile}}\n配置:\n  {{format_global_variable::yaml}}'),
  throughContext: st.substituteParams('{{char}}/{{user}}/{{lastMessageId}}'),
  latestChatText: st.chat.at(-1).mes,
};
`
  const html = tavernScriptFrameSource({
    id: 'context-macros', name: '上下文宏', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'context-macros', scriptName: '上下文宏', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', userName: '旅人',
    approvedScriptOrigins: [],
    scopes: {
      global: { theme: '夜色', yaml: { lines: '第一行\n第二行', flags: [true, 'false'] } }, preset: { tone: '温柔' },
      character: { profile: { title: '导游' } }, chat: { route: { name: '北岸' } },
      message: {}, script: {},
    },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [],
    messages: [
      { messageId: 0, seq: 1, role: 'user', text: '去哪里？', isHidden: false, data: {}, extra: {} },
      {
        messageId: 1, seq: 2, role: 'assistant', text: '去灯塔。', isHidden: false,
        data: { status: { value: 3, $internal: '不应暴露' } }, extra: {},
      },
    ],
    characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const result = JSON.parse(JSON.stringify(context.__sillyTavernMacros)) as Record<string, unknown>
  assert.deepEqual(result, {
    sameContext: true,
    direct: '去灯塔。|去哪里？|去灯塔。|{"value":3}|北岸|导游|温柔|夜色|null',
    formatted: '状态:\n  value: 3\n路线: name: 北岸 / title: 导游\n配置:\n  lines: |-\n    第一行\n    第二行\n  flags:\n    - true\n    - "false"',
    throughContext: '角色/旅人/1',
    latestChatText: '去灯塔。',
  })
})

test('relays filtered Tavern Helper prompt injections and their disposer to the Host', async () => {
  const script = String.raw`
const registration = injectPrompts([
  { id: 'active', position: 'in_chat', depth: 2, role: 'system', content: '当前场景' },
  { id: 'filtered', position: 'in_chat', depth: 0, role: 'user', content: '不应注入', filter: () => false },
], { once: true });
window.__injectionReady = Promise.resolve().then(() => {
  registration.uninject();
  return Promise.resolve();
});
`
  const html = tavernScriptFrameSource({
    id: 'prompt-injector', name: '提示注入', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'prompt-injector', scriptName: '提示注入', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  assert.equal((context.posted as Record<string, unknown>[]).filter(message => message.action === 'injections-replace').length, 1)
  await context.__injectionReady
  await Promise.resolve()
  const mutations = (context.posted as Record<string, unknown>[])
    .filter(message => message.action === 'injections-replace')
  assert.deepEqual(JSON.parse(JSON.stringify(mutations.map(message => message.prompts))), [
    [{
      id: 'active', position: 'in_chat', depth: 2, role: 'system', content: '当前场景',
      shouldScan: false, once: true,
    }],
    [],
  ])
})

test('maps SillyTavern extension prompts and slash injects onto durable script injections', async () => {
  const script = String.raw`
const context = SillyTavern.getContext();
context.setExtensionPrompt(
  'standing-rules', '常驻规则', context.extension_prompt_types.IN_CHAT, 0, true,
  context.extension_prompt_roles.SYSTEM,
);
window.__slashInjection = triggerSlash('/inject id=scene-rules position=chat depth=2 scan=true role=user ephemeral=true "临时规则"');
`
  const html = tavernScriptFrameSource({
    id: 'legacy-prompt-injector', name: '旧式规则注入', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'legacy-prompt-injector', scriptName: '旧式规则注入', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)

  assert.equal(await context.__slashInjection, 'scene-rules')
  await new Promise(resolve => setTimeout(resolve, 0))
  const mutations = (): Record<string, unknown>[] => (context.posted as Record<string, unknown>[])
    .filter(message => message.action === 'injections-replace')
  assert.deepEqual(JSON.parse(JSON.stringify(mutations().at(-1)?.prompts)), [{
    id: 'standing-rules', position: 'in_chat', depth: 0, role: 'system', content: '常驻规则',
    shouldScan: true, once: false,
  }, {
    id: 'script_inject_scene-rules', position: 'in_chat', depth: 2, role: 'user', content: '临时规则',
    shouldScan: true, once: true,
  }])
  assert.equal((context.posted as Record<string, unknown>[])
    .some(message => message.action === 'trigger-slash'), false)

  const runtimeContext = context.SillyTavern as {
    setExtensionPrompt: (...args: unknown[]) => void
    extension_prompt_types: { IN_CHAT: number }
  }
  runtimeContext.setExtensionPrompt('standing-rules', '', runtimeContext.extension_prompt_types.IN_CHAT, 0, false, 0)
  await (context.triggerSlash as (command: string) => Promise<string>)('/flushinject scene-rules')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(JSON.parse(JSON.stringify(mutations().at(-1)?.prompts)), [])
})

test('reevaluates Tavern Helper injection filters after variable snapshots change', () => {
  const script = String.raw`
injectPrompts([{
  id: 'conditional', position: 'none', depth: 0, role: 'system',
  content: '触发条件世界书', should_scan: true,
  filter: () => getVariables({ type: 'chat' }).enabled === true,
}]);
`
  const snapshot = {
    scriptScope: 'character',
    scriptId: 'conditional-injector', scriptName: '条件注入', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: { enabled: false }, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  } as const
  const html = tavernScriptFrameSource({
    id: 'conditional-injector', name: '条件注入', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, snapshot)
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const mutations = (): Record<string, unknown>[] => (context.posted as Record<string, unknown>[])
    .filter(message => message.action === 'injections-replace')
  assert.equal(mutations().length, 0)
  const sync = (enabled: boolean, injectedPrompts: readonly unknown[]): void => {
    ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
      action: 'variables-sync',
      scopes: { ...snapshot.scopes, chat: { enabled } },
      messages: [],
      injectedPrompts,
      worldbooks: {},
      worldbookBindings: snapshot.worldbookBindings,
      activeWorldbookEntries: [],
    })
  }
  sync(true, [])
  assert.deepEqual(JSON.parse(JSON.stringify(mutations().at(-1)?.prompts)), [{
    id: 'conditional', position: 'none', depth: 0, role: 'system',
    content: '触发条件世界书', shouldScan: true, once: false,
  }])
  sync(false, mutations().at(-1)?.prompts as readonly unknown[])
  assert.deepEqual(JSON.parse(JSON.stringify(mutations().at(-1)?.prompts)), [])
})

test('consumes only one-shot prompt injections after a completed generation event', async () => {
  const html = tavernScriptFrameSource({
    id: 'once-injector', name: '单次提示', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, '', {
    scriptScope: 'character',
    scriptId: 'once-injector', scriptName: '单次提示', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
    injectedPrompts: [
      { id: 'once', position: 'in_chat', depth: 0, role: 'system', content: '仅一次', shouldScan: true, once: true },
      { id: 'lasting', position: 'in_chat', depth: 0, role: 'system', content: '保留', shouldScan: true, once: false },
    ],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'event', eventType: 'generation_ended', args: [0],
    mutationCause: { format: 0, sessionId: 'session-test', replySeq: 7 },
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  const mutation = (context.posted as Record<string, unknown>[])
    .findLast(message => message.action === 'injections-replace')
  assert.deepEqual(JSON.parse(JSON.stringify(mutation?.prompts)), [
    { id: 'lasting', position: 'in_chat', depth: 0, role: 'system', content: '保留', shouldScan: true, once: false },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(mutation?.cause)), {
    format: 0, sessionId: 'session-test', replySeq: 7,
  })
})

test('persists canonical MVU initialization listener changes', async () => {
  const html = tavernScriptFrameSource({
    id: 'mvu-schema', name: '变量结构', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, String.raw`
window.__mvuInitializedEvent = Mvu.events.VARIABLE_INITIALIZED;
eventOn(Mvu.events.VARIABLE_INITIALIZED, variables => { variables.stat_data.ready = true; });
`, {
    scriptScope: 'character',
    scriptId: 'mvu-schema', scriptName: '变量结构', scriptInfo: '', buttons: [],
    characterName: '角色', characterId: 'character.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: { stat_data: {} }, script: {} },
    worldbooks: {}, worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  assert.equal(context.__mvuInitializedEvent, 'mag_variable_initialized')

  ;(context.dispatchHost as (data: Record<string, unknown>) => void)({
    action: 'event', eventType: 'mag_variable_initialized', args: [{ stat_data: {} }, 0],
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  const mutation = (context.posted as Record<string, unknown>[])
    .findLast(message => message.action === 'variables-replace')
  assert.deepEqual(JSON.parse(JSON.stringify(mutation?.variables)), { stat_data: { ready: true } })
})

test('lets V18-style dry-run listeners capture prompts without Host generation', async () => {
  const prompts = [
    { role: 'system', content: '角色与世界状态' },
    { role: 'user', content: '最近十层对话' },
  ]
  const script = String.raw`
const marker = '__ssDryRunCapture_acceptance__';
const captured = { order: [] };
eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, data => {
  captured.order.push('ready');
  captured.ready = data.chat;
});
eventOn(tavern_events.GENERATE_AFTER_DATA, (data, dryRun) => {
  captured.order.push('data');
  captured.data = data.prompt;
  captured.dryRun = dryRun;
});
eventOn(tavern_events.GENERATE_AFTER_COMBINE_PROMPTS, data => {
  captured.order.push('combined');
  captured.combined = data.prompt;
});
const previousFetch = window.fetch;
window.fetch = async (input, init) => {
  const body = typeof init?.body === 'string' ? init.body : '';
  if (!body.includes(marker)) return previousFetch(input, init);
  captured.body = JSON.parse(body);
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'captured locally' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
window.__acceptance = generate({
  preset_name: 'in_use',
  user_input: '【玄狐上下文抓取】' + marker,
  should_silence: true,
  should_stream: false,
  automatic_trigger: true,
  _qrf_processed_by_hook: true,
  max_chat_history: 10,
}).then(result => ({ result, captured }));
`
  const html = tavernScriptFrameSource({
    id: 'v18-capture', name: '1', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'v18-capture', scriptName: '1', scriptInfo: '', buttons: [],
    characterName: '白露', characterId: 'bailu.png', chatId: 'session-test',
    approvedScriptOrigins: [],
    preset: { name: 'V18', revision: 1, value: {} },
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {},
    worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [],
    messages: [], characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext(prompts)
  runInNewContext(source!, context)
  const result = JSON.parse(JSON.stringify(await context.__acceptance)) as {
    result: string
    captured: {
      order: string[]
      ready: unknown
      data: unknown
      combined: unknown
      dryRun: boolean
      body: Record<string, unknown>
    }
  }
  assert.equal(result.result, 'captured locally')
  assert.deepEqual(result.captured.order, ['ready', 'data', 'combined'])
  assert.deepEqual(result.captured.ready, prompts)
  assert.deepEqual(result.captured.data, prompts)
  assert.deepEqual(result.captured.combined, prompts)
  assert.equal(result.captured.dryRun, false)
  assert.equal(result.captured.body.user_input, '【玄狐上下文抓取】__ssDryRunCapture_acceptance__')
  assert.deepEqual(result.captured.body.messages, [])
  const actions = (context.posted as Record<string, unknown>[]).map(message => message.action)
  assert.ok(actions.includes('generation-preview'))
  assert.ok(!actions.includes('generate'))
})

test('exposes worldbook entries and precise activation evidence to Tavern scripts', async () => {
  const script = String.raw`
window.__acceptance = Promise.all([
  getLorebookEntries('规则书'),
  getLorebookEntries('规则书', { filter: { type: 'constant' } }),
]).then(([entries, constants]) => ({
  entries,
  constants,
  activated: SillyTavern.getContext().chatMetadata.wi_activated,
}));
`
  const html = tavernScriptFrameSource({
    id: 'worldbook-reader', name: '世界书读取', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'worldbook-reader', scriptName: '世界书读取', scriptInfo: '', buttons: [],
    characterName: '白露', characterId: 'bailu.png', chatId: 'session-test',
    approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: { own: 'value' }, message: {}, script: {} },
    worldbooks: {
      规则书: [{
        uid: 7, name: '常驻规则', enabled: true,
        strategy: {
          type: 'constant', keys: ['规则'],
          keys_secondary: { logic: 'and_any', keys: ['附加'] }, scan_depth: 2,
        },
        position: { type: 'before_character_definition', role: 'system', depth: 4, order: 23 },
        content: '不得遗忘。', probability: 100,
        recursion: { prevent_incoming: false, prevent_outgoing: true, delay_until: null },
        effect: { sticky: 2, cooldown: null, delay: null },
      }],
    },
    worldbookBindings: { global: ['规则书'], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: ['规则书.7'], messages: [], characterRegexScripts: [],
    presetScriptTrees: [], characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const result = JSON.parse(JSON.stringify(await context.__acceptance)) as {
    entries: Record<string, unknown>[]
    constants: Record<string, unknown>[]
    activated: string[]
  }
  assert.deepEqual(result.activated, ['规则书.7'])
  assert.equal(result.entries.length, 1)
  assert.deepEqual(result.constants, result.entries)
  assert.deepEqual(result.entries[0], {
    uid: 7, display_index: 0, comment: '常驻规则', enabled: true, type: 'constant',
    position: 'before_character_definition', depth: null, order: 23, probability: 100,
    keys: ['规则'], key: ['规则'], logic: 'and_any', filters: ['附加'], filter: ['附加'], scan_depth: 2,
    case_sensitive: 'same_as_global', match_whole_words: 'same_as_global',
    use_group_scoring: 'same_as_global', automation_id: null,
    exclude_recursion: false, prevent_recursion: true, delay_until_recursion: false,
    content: '不得遗忘。', group: '', group_prioritized: false, group_weight: 100,
    sticky: 2, cooldown: null, delay: null, constant: true, disable: false,
  })
})

test('round-trips legacy lorebook mutations through the modern Host format', async () => {
  const script = String.raw`
window.__acceptance = (async () => {
  await replaceLorebookEntries('规则书', [{
    uid: 7, comment: '旧式条目', enabled: false, type: 'selective',
    position: 'at_depth_as_assistant', depth: 6, order: 31, probability: 70,
    keys: ['门'], logic: 'and_all', filters: ['夜'], scan_depth: 4,
    case_sensitive: true, match_whole_words: false, use_group_scoring: true,
    automation_id: 'legacy-event', exclude_recursion: true, prevent_recursion: false,
    delay_until_recursion: 2, content: '门只在夜里打开。', group: '夜间',
    group_prioritized: true, group_weight: 88, sticky: 3, cooldown: 2, delay: 1,
  }]);
  const replaced = await getLorebookEntries('规则书');
  const set = await setLorebookEntries('规则书', [{ uid: 7, enabled: true, content: '门在月升后打开。' }]);
  const created = await createLorebookEntries('规则书', [{ comment: '新增条目', position: 'before_author_note' }]);
  const deleted = await deleteLorebookEntries('规则书', [7]);
  return { replaced, set, created, deleted };
})();
`
  const html = tavernScriptFrameSource({
    id: 'legacy-worldbook-writer', name: '旧世界书写入', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, script, {
    scriptScope: 'character',
    scriptId: 'legacy-worldbook-writer', scriptName: '旧世界书写入', scriptInfo: '', buttons: [],
    characterName: '白露', characterId: 'bailu.png', chatId: 'session-test', approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {
      规则书: [{
        uid: 99, name: '将被替换', enabled: true,
        strategy: { type: 'constant', keys: [], keys_secondary: { logic: 'and_any', keys: [] }, scan_depth: 'same_as_global' },
        position: { type: 'at_depth', role: 'system', depth: 4, order: 100 }, content: '', probability: 100,
        recursion: { prevent_incoming: false, prevent_outgoing: false, delay_until: null },
        effect: { sticky: null, cooldown: null, delay: null },
      }],
    },
    worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [], messages: [], characterRegexScripts: [], presetScriptTrees: [],
    characterScriptTrees: [], displayRegexScripts: [],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const result = JSON.parse(JSON.stringify(await context.__acceptance)) as Record<string, Record<string, unknown>[] | Record<string, unknown>>
  const replaced = result.replaced as Record<string, unknown>[]
  assert.equal(replaced.length, 1)
  assert.deepEqual(replaced[0], {
    uid: 7, display_index: 0, comment: '旧式条目', enabled: false, type: 'selective',
    position: 'at_depth_as_assistant', depth: 6, order: 31, probability: 70,
    keys: ['门'], key: ['门'], logic: 'and_all', filters: ['夜'], filter: ['夜'], scan_depth: 4,
    case_sensitive: true, match_whole_words: false, use_group_scoring: true, automation_id: 'legacy-event',
    exclude_recursion: true, prevent_recursion: false, delay_until_recursion: 2,
    content: '门只在夜里打开。', group: '夜间', group_prioritized: true, group_weight: 88,
    sticky: 3, cooldown: 2, delay: 1, constant: false, disable: true,
  })
  const set = result.set as Record<string, unknown>[]
  assert.equal(set[0]?.enabled, true)
  assert.equal(set[0]?.content, '门在月升后打开。')
  const created = result.created as { entries: Record<string, unknown>[]; new_uids: number[] }
  assert.deepEqual(created.new_uids, [0])
  assert.equal(created.entries[1]?.comment, '新增条目')
  assert.equal(created.entries[1]?.position, 'before_author_note')
  const deleted = result.deleted as { entries: Record<string, unknown>[]; delete_occurred: boolean }
  assert.equal(deleted.delete_occurred, true)
  assert.deepEqual(deleted.entries.map(entry => entry.uid), [0])

  const writes = (context.posted as Record<string, unknown>[]).filter(message => message.action === 'worldbook-mutate')
  assert.equal(writes.length, 4)
  const firstRequest = writes[0]?.request as { entries?: Record<string, unknown>[] }
  assert.equal(firstRequest.entries?.[0]?.name, '旧式条目')
  assert.equal((firstRequest.entries?.[0]?.position as Record<string, unknown>)?.role, 'assistant')
})

test('runs preset scripts before character scripts for the selected view', () => {
  const preset = [{ ...base, scriptName: 'preset', findRegex: '/seed/gu', replaceString: 'old' }]
  assert.equal(renderCharacterDisplay('seed', character, AI_OUTPUT_PLACEMENT, 0, '宝宝', preset), 'new')
})

test('keeps display-only and prompt-only execution separate', () => {
  const prompt = [{ ...base, markdownOnly: false, promptOnly: true }]
  assert.equal(renderCharacterDisplay('old', { ...character, frontend: { ...character.frontend, regexScripts: [] } }, AI_OUTPUT_PLACEMENT, 0, '宝宝', prompt), 'old')
  assert.equal(renderCharacterPromptView('old', character, AI_OUTPUT_PLACEMENT, 0, '宝宝', prompt), 'new')
})

test('keeps author media fields available to prompts but out of the visible greeting', () => {
  const source = '<角色图片>角色名<img>external.png</img></角色图片>\n正文'
  assert.equal(renderCharacterDisplay(source, character, AI_OUTPUT_PLACEMENT, 0), '\n正文')
  assert.equal(renderCharacterPromptView(source, character, AI_OUTPUT_PLACEMENT, 0), source)
  const display = [{ ...base, findRegex: '/<角色图片>[\\s\\S]*?<\\/角色图片>/gu', replaceString: '<div>external.png</div>' }]
  const withoutCardScripts = { ...character, frontend: { ...character.frontend, regexScripts: [] } }
  assert.equal(renderCharacterDisplay(source, withoutCardScripts, AI_OUTPUT_PLACEMENT, 0, undefined, display), '<div></div>\n正文')
  const dlc = [{
    ...base,
    findRegex: '/<(?:illustration|img)>.*[^A-Za-z0-9\\.\\s<\\/>]+(.*?)<\\/(?:illustration|img)>/g',
    replaceString: '<center><img src=https://files.example.com/$1 width=50% /></center>',
  }]
  const dlcSource = '<角色图片><img>角色名external.png</img></角色图片>\n正文'
  assert.equal(
    renderCharacterDisplay(dlcSource, withoutCardScripts, AI_OUTPUT_PLACEMENT, 0, undefined, dlc),
    '<center><img src=https://files.example.com/external.png width=50% /></center>\n正文',
  )
})

test('runs ordinary message scripts before view-specific scripts', () => {
  const ordinary = { ...base, findRegex: '/<StatusBlocks>([\\s\\S]*?)<\\/StatusBlocks>/gu', replaceString: '$1', markdownOnly: false }
  const display = { ...base, findRegex: '/状态：(.+)/gu', replaceString: '```html\n<details><summary>状态</summary>$1</details>\n```' }
  const prompt = { ...base, findRegex: '/状态：(.+)/gu', replaceString: '状态记录：$1', markdownOnly: false, promptOnly: true }
  const source = '<StatusBlocks>状态：平静</StatusBlocks>'
  const noCardScripts = { ...character, frontend: { ...character.frontend, regexScripts: [] } }

  assert.equal(renderCharacterDisplay(source, noCardScripts, AI_OUTPUT_PLACEMENT, 0, '宝宝', [ordinary, display]),
    '```html\n<details><summary>状态</summary>平静</details>\n```')
  assert.equal(renderCharacterPromptView(source, noCardScripts, AI_OUTPUT_PLACEMENT, 0, '宝宝', [ordinary, prompt]),
    '状态记录：平静')
})

test('reports prompt regex outcomes without exposing expressions or replacements', () => {
  const scripts = [
    { ...base, scriptName: 'ordinary', markdownOnly: false, findRegex: '/old/gu' },
    { ...base, scriptName: 'prompt', markdownOnly: false, promptOnly: true, findRegex: '/new/gu', replaceString: 'done' },
    { ...base, scriptName: 'display', findRegex: '/done/gu' },
  ]
  const trace = traceCharacterPromptView(
    'old',
    { ...character, frontend: { ...character.frontend, regexScripts: [] } },
    AI_OUTPUT_PLACEMENT,
    0,
    '宝宝',
    scripts,
  )
  assert.equal(trace.text, 'done')
  assert.deepEqual(trace.scripts, [
    { index: 0, scriptName: 'ordinary', outcome: 'applied' },
    { index: 1, scriptName: 'prompt', outcome: 'applied' },
    { index: 2, scriptName: 'display', outcome: 'display-only' },
  ])
  assert.equal(JSON.stringify(trace).includes('/old/'), false)
})

test('runs the same two regex phases inside the isolated Tavern runtime', () => {
  const ordinary = { ...base, findRegex: '/<StatusBlocks>([\\s\\S]*?)<\\/StatusBlocks>/gu', replaceString: '$1', markdownOnly: false }
  const display = { ...base, findRegex: '/状态：(.+)/gu', replaceString: '<details><summary>状态</summary>$&</details>' }
  const html = tavernScriptFrameSource({
    id: 'status-runtime', name: '状态栏', content: '', info: '', enabled: true,
    buttonEnabled: false, buttons: [], data: {},
  }, '', {
    scriptScope: 'character',
    scriptId: 'status-runtime', scriptName: '状态栏', scriptInfo: '', buttons: [],
    characterName: '白露', characterId: 'bailu.png', chatId: 'session-test',
    approvedScriptOrigins: [],
    scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {}, script: {} },
    worldbooks: {},
    worldbookBindings: { global: [], character: { primary: null, additional: [] }, chat: null },
    activeWorldbookEntries: [],
    messages: [{ messageId: 0, seq: 1, role: 'assistant', text: '', isHidden: false, data: {}, extra: {} }],
    characterRegexScripts: [], presetScriptTrees: [], characterScriptTrees: [],
    displayRegexScripts: [ordinary, display],
  })
  const source = html.match(/<script>([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(source, undefined)
  const context = runtimeAcceptanceContext([])
  runInNewContext(source!, context)
  const format = context.formatAsDisplayedMessage as (text: string, option: { readonly message_id: number }) => string

  assert.equal(format('<StatusBlocks>状态：平静</StatusBlocks>', { message_id: 0 }),
    '<details><summary>状态</summary>状态：平静</details>')
  const body = (context.document as { readonly body: RuntimeElement }).body
  const chat = body.children[0] as RuntimeElement & { readonly id?: string; readonly className?: string }
  assert.equal(chat.children.length, 1)
  const retrieve = context.retrieveDisplayedMessage as (messageId: number) => unknown
  retrieve(0)
  const shell = chat.children[1] as RuntimeElement & { readonly className?: string }
  const mirrored = shell.children[0] as RuntimeElement & { readonly className?: string }
  assert.equal(chat.id, 'chat')
  assert.equal(chat.className, 'chat')
  assert.equal(shell.className, 'mes character_mes')
  assert.equal(mirrored.className, 'mes_text')
  assert.equal(mirrored.innerHTML, '')
})

test('supports raw and escaped macro substitution in the find expression', () => {
  const source = '宝宝.(白露)'
  const raw = [{ ...base, findRegex: String.raw`/{{user}}\.\({{char}}\)/gu`, replaceString: 'raw', substituteRegex: 1 }]
  const escaped = [{ ...base, findRegex: '/{{user}}{{char}}/gu', replaceString: 'escaped', substituteRegex: 2 }]
  const specialCharacter = { name: '(白露)', frontend: {
    regexScripts: [], tavernHelperScriptNames: [], tavernHelperScripts: [], tavernHelperVariables: {},
  } }
  assert.equal(renderCharacterDisplay(source, character, AI_OUTPUT_PLACEMENT, 0, '宝宝', raw), 'raw')
  assert.equal(renderCharacterDisplay('宝.宝(白露)', specialCharacter, AI_OUTPUT_PLACEMENT, 0, '宝.宝', escaped), 'escaped')
})

test('keeps prose and each fenced frontend document in source order', () => {
  const source = [
    '正文前',
    '',
    '```html',
    '<!doctype html><html><body>卡一</body></html>',
    '```',
    '',
    '正文中',
    '',
    '```html',
    '<!doctype html><html><body>卡二</body></html>',
    '```',
  ].join('\n')
  assert.deepEqual(splitCharacterDisplay(source), [
    { kind: 'markdown', text: '正文前\n\n' },
    { kind: 'html', source: '<!doctype html><html><body>卡一</body></html>\n' },
    { kind: 'markdown', text: '\n正文中\n\n' },
    { kind: 'html', source: '<!doctype html><html><body>卡二</body></html>\n' },
  ])
})

test('keeps HTML examples in fenced code as native Markdown', () => {
  const source = '前文\n\n```ts\nconst body = "<body>"\n```'
  assert.deepEqual(splitCharacterDisplay(source), [{ kind: 'markdown', text: source }])
})

test('isolates ordinary inline HTML for sanitized rendering', () => {
  const source = '正文\n\n<details><summary>状态</summary>平静</details>'
  const segments = splitCharacterDisplay(source)
  assert.deepEqual(segments, [{ kind: 'inline-html', source }])
  assert.equal(hasCharacterDisplayFrontend(segments), true)
  assert.equal(hasCharacterDisplayFrontend([{ kind: 'markdown', text: '纯文字' }]), false)
})

test('keeps legacy center wrappers for the card frontend compatibility pass', () => {
  const source = '<div>角色名<center><img src="image.png"></center></div>'
  assert.deepEqual(splitCharacterDisplay(source), [{ kind: 'inline-html', source }])
})

test('hides model-defined wrapper tags while preserving their displayed text', () => {
  assert.equal(normalizeSillyTavernMarkdown('<content>\n正文\n</content>'), '\n正文\n')
  assert.equal(normalizeSillyTavernMarkdown('<details><summary>展开</summary>正文</details>'),
    '<details><summary>展开</summary>正文</details>')
})

test('keeps unknown tags inside inline and fenced code examples', () => {
  const source = ['正文 <content>内容</content> `示例 <content>`', '', '```xml', '<content>示例</content>', '```'].join('\n')
  assert.equal(normalizeSillyTavernMarkdown(source),
    ['正文 内容 `示例 <content>`', '', '```xml', '<content>示例</content>', '```'].join('\n'))
})
