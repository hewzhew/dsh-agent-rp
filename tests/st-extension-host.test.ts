import assert from 'node:assert/strict'
import test from 'node:test'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  installStExtensionHost,
  type StExtensionSessionBinding,
} from '../src/client/st-extension-host.ts'
import { InstalledStExtensionRegistry } from '../src/client/st-extension-registry.ts'
import { InstalledStExtensionSurface } from '../src/client/st-extension-surface.tsx'
import { agentRpProjectionDefinition } from '../src/projection.ts'

class FakeFrame {
  readonly messages: unknown[] = []
  readonly contentWindow = {
    postMessage: (message: unknown): void => { this.messages.push(message) },
  }
  readonly dataset: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  readonly style: Record<string, string> = {}
  hidden = false
  referrerPolicy = ''
  removed = false
  srcdoc = ''
  title = ''

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  remove(): void {
    this.removed = true
  }
}

class FakeDocument {
  readonly frames: FakeFrame[] = []
  readonly body = {
    append: (frame: FakeFrame): void => { this.frames.push(frame) },
  }

  createElement(name: string): FakeFrame {
    assert.equal(name, 'iframe')
    return new FakeFrame()
  }
}

class FakeWindow {
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>()

  addEventListener(name: string, listener: EventListenerOrEventListenerObject): void {
    assert.equal(name, 'message')
    this.listeners.add(listener as (event: MessageEvent<unknown>) => void)
  }

  removeEventListener(name: string, listener: EventListenerOrEventListenerObject): void {
    assert.equal(name, 'message')
    this.listeners.delete(listener as (event: MessageEvent<unknown>) => void)
  }

  dispatch(source: object, data: unknown): void {
    for (const listener of this.listeners) listener({ source, data } as MessageEvent<unknown>)
  }
}

class FakeSessionSource {
  currentBinding: StExtensionSessionBinding | undefined = {
    sessionId: SessionId('session-a'),
    projection: agentRpProjectionDefinition.wire.view(agentRpProjectionDefinition.init(
      Session.create(SessionId('session-a')).header,
    )),
  }
  readonly listeners = new Set<() => void>()

  current(): StExtensionSessionBinding | undefined {
    return this.currentBinding
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  select(sessionId: string | undefined): void {
    this.currentBinding = sessionId === undefined ? undefined : {
      sessionId: SessionId(sessionId),
      ...(this.currentBinding?.projection === undefined ? {} : { projection: this.currentBinding.projection }),
    }
    for (const listener of this.listeners) listener()
  }

  updateProjection(projection: NonNullable<StExtensionSessionBinding['projection']>): void {
    const current = this.currentBinding
    if (current === undefined) throw new Error('Cannot update a missing Session projection')
    this.currentBinding = { sessionId: current.sessionId, projection }
    for (const listener of this.listeners) listener()
  }
}

async function flushRebuild(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function withTranscript(
  projection: NonNullable<StExtensionSessionBinding['projection']>,
  messages: readonly {
    readonly messageId: number
    readonly seq: number
    readonly role: 'user' | 'assistant'
    readonly text: string
    readonly isHidden: boolean
  }[],
): NonNullable<StExtensionSessionBinding['projection']> {
  return {
    ...projection,
    tavern: {
      format: 0,
      characterSourceId: 'character-a',
      revision: 1,
      scopes: { global: {}, preset: {}, character: {}, chat: {}, message: {} },
      scripts: {},
      messages,
    },
  }
}

test('coalesces registrations into one frame, rebuilds once, and tears down completely', async () => {
  const registry = new InstalledStExtensionRegistry()
  const document = new FakeDocument()
  const window = new FakeWindow()
  const warnings: string[] = []
  const writes: unknown[] = []
  const sessions = new FakeSessionSource()
  const dispose = installStExtensionHost(
    window as unknown as Window,
    document as unknown as Document,
    registry,
    sessions,
    {
      read: async () => ({ fixture: { enabled: true } }),
      write: async settings => { writes.push(settings); return settings },
    },
    message => { warnings.push(message) },
  )
  const revokeA = registry.register({
    id: 'extension.a', displayName: 'A', loadingOrder: 0, source: 'export {}',
  })
  const revokeB = registry.register({
    id: 'extension.b', displayName: 'B', loadingOrder: 1, source: 'export {}',
  })
  await flushRebuild()

  assert.equal(document.frames.length, 1)
  const first = document.frames[0] as FakeFrame
  assert.equal(first.hidden, true)
  assert.equal(first.attributes.has('sandbox'), false)
  assert.match(first.srcdoc, /extension\.a/u)
  assert.match(first.srcdoc, /extension\.b/u)
  assert.match(first.srcdoc, /fixture/u)
  assert.match(first.srcdoc, /session-a/u)
  assert.match(first.srcdoc, /角色会话/u)

  window.dispatch(first.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host',
    token: JSON.parse(first.srcdoc.match(/const boot=(\{.*?\});const entries/u)?.[1] ?? '{}').token,
    action: 'host-state', status: 'ready', loaded: ['extension.a'], failed: ['extension.b'],
  })
  assert.equal(first.dataset.agentRpStExtensionPhase, 'ready')
  assert.equal(first.dataset.agentRpStExtensionLoaded, '1')
  assert.equal(first.dataset.agentRpStExtensionFailed, '1')
  window.dispatch(first.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host',
    token: JSON.parse(first.srcdoc.match(/const boot=(\{.*?\});const entries/u)?.[1] ?? '{}').token,
    action: 'settings-save', settings: { fixture: { enabled: false } },
  })
  await flushRebuild()
  assert.deepEqual(writes, [{ fixture: { enabled: false } }])
  sessions.select('session-b')
  assert.equal(document.frames.length, 1)
  const sessionMessage = first.messages[0] as {
    readonly source: string
    readonly action: string
    readonly token: string
    readonly sessionId: string
    readonly snapshot: { readonly characterName: string }
  }
  assert.equal(sessionMessage.source, 'dsh-agent-rp-host')
  assert.equal(sessionMessage.action, 'session-bind')
  assert.equal(sessionMessage.token,
    JSON.parse(first.srcdoc.match(/const boot=(\{.*?\});const entries/u)?.[1] ?? '{}').token)
  assert.equal(sessionMessage.sessionId, 'session-b')
  assert.equal(sessionMessage.snapshot.characterName, '角色会话')
  const changedProjection = {
    ...sessions.currentBinding!.projection!,
    characterName: '页面更新',
  }
  sessions.updateProjection(changedProjection)
  const projectionMessage = first.messages[1] as {
    readonly action: string
    readonly sessionId: string
    readonly snapshot: { readonly characterName: string }
  }
  assert.equal(projectionMessage.action, 'page-sync')
  assert.equal(projectionMessage.sessionId, 'session-b')
  assert.equal(projectionMessage.snapshot.characterName, '页面更新')

  registry.register({
    id: 'extension.c', displayName: 'C', loadingOrder: 2, source: 'export {}',
  })
  await flushRebuild()
  assert.equal(document.frames.length, 2)
  assert.equal(first.removed, true)

  revokeA()
  revokeB()
  await flushRebuild()
  assert.equal(document.frames.length, 3)
  dispose()
  assert.equal(document.frames.at(-1)?.removed, true)
  assert.equal(window.listeners.size, 0)
  assert.equal(sessions.listeners.size, 0)
  assert.deepEqual(warnings, [])
})

test('ignores stale frames and reports bounded current-frame failures', async () => {
  const registry = new InstalledStExtensionRegistry()
  const document = new FakeDocument()
  const window = new FakeWindow()
  const warnings: string[] = []
  const sessions = new FakeSessionSource()
  const dispose = installStExtensionHost(
    window as unknown as Window,
    document as unknown as Document,
    registry,
    sessions,
    { read: async () => ({}), write: async settings => settings },
    message => { warnings.push(message) },
  )
  registry.register({
    id: 'extension.failure', displayName: 'Failure', loadingOrder: 0, source: 'throw new Error()',
  })
  await flushRebuild()
  const frame = document.frames[0] as FakeFrame
  const token = JSON.parse(frame.srcdoc.match(/const boot=(\{.*?\});const entries/u)?.[1] ?? '{}').token as string
  window.dispatch({}, {
    source: 'dsh-agent-rp-st-extension-host', token,
    action: 'extension-state', extensionId: 'extension.failure', status: 'failed', error: 'stale',
  })
  window.dispatch(frame.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host', token,
    action: 'extension-state', extensionId: 'extension.failure', status: 'failed', error: 'boom',
  })
  window.dispatch(frame.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host', token,
    action: 'settings-surface', hasContent: true,
  })

  assert.deepEqual(warnings, ['agent-rp: installed ST extension "extension.failure" failed: boom'])
  assert.equal(frame.dataset.agentRpStExtensionSettings, 'visible')
  dispose()
})

test('mounts a visible frame in the product surface and synchronizes its state', async () => {
  const registry = new InstalledStExtensionRegistry()
  const document = new FakeDocument()
  const window = new FakeWindow()
  const sessions = new FakeSessionSource()
  const surface = new InstalledStExtensionSurface()
  const mounted: FakeFrame[] = []
  surface.bindFrameMount(frame => { mounted.push(frame as unknown as FakeFrame) })
  const dispose = installStExtensionHost(
    window as unknown as Window,
    document as unknown as Document,
    registry,
    sessions,
    { read: async () => ({}), write: async settings => settings },
    () => undefined,
    surface,
  )
  registry.register({
    id: 'extension.settings', displayName: 'Settings', loadingOrder: 0, source: 'export {}',
  })
  await flushRebuild()

  assert.equal(document.frames.length, 0)
  assert.equal(mounted.length, 1)
  const first = mounted[0] as FakeFrame
  assert.equal(first.hidden, false)
  assert.equal(first.style.height, '100%')
  const token = JSON.parse(first.srcdoc.match(/const boot=(\{.*?\});const entries/u)?.[1] ?? '{}').token as string
  window.dispatch(first.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host', token,
    action: 'settings-surface', hasContent: true,
  })
  window.dispatch(first.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host', token,
    action: 'host-state', status: 'ready', loaded: ['extension.settings'], failed: [],
  })
  surface.open()
  assert.deepEqual(surface.getSnapshot(), {
    available: true,
    failed: 0,
    loaded: 1,
    open: true,
    phase: 'ready',
    registryRevision: 1,
  })

  surface.close()
  assert.equal(first.removed, false)
  assert.equal(mounted.length, 1)
  dispose()
  assert.equal(first.removed, true)
  assert.equal(surface.getSnapshot().phase, 'idle')
})

test('queues appended transcript events until the current frame is ready', async () => {
  const registry = new InstalledStExtensionRegistry()
  const document = new FakeDocument()
  const window = new FakeWindow()
  const sessions = new FakeSessionSource()
  const dispose = installStExtensionHost(
    window as unknown as Window,
    document as unknown as Document,
    registry,
    sessions,
    { read: async () => ({}), write: async settings => settings },
    () => undefined,
  )
  registry.register({
    id: 'extension.events', displayName: 'Events', loadingOrder: 0, source: 'export {}',
  })
  await flushRebuild()
  const frame = document.frames[0] as FakeFrame
  const token = JSON.parse(frame.srcdoc.match(/const boot=(\{.*?\});const entries/u)?.[1] ?? '{}').token as string
  const initial = sessions.currentBinding!.projection!
  const user = { messageId: 0, seq: 10, role: 'user' as const, text: '你好', isHidden: false }
  sessions.updateProjection(withTranscript(initial, [user]))
  assert.equal(frame.messages.length, 0)

  window.dispatch(frame.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host', token,
    action: 'host-state', status: 'ready', loaded: ['extension.events'], failed: [],
  })
  const assistant = {
    messageId: 1, seq: 11, role: 'assistant' as const, text: '你好。', isHidden: false,
  }
  sessions.updateProjection(withTranscript(initial, [user, assistant]))

  assert.deepEqual((frame.messages as {
    readonly action: string
    readonly eventType?: string
    readonly args?: readonly unknown[]
    readonly snapshot?: { readonly messages: readonly { readonly text: string }[] }
  }[]).map(message => ({
    action: message.action,
    ...(message.eventType === undefined ? {} : { eventType: message.eventType }),
    ...(message.args === undefined ? {} : { args: message.args }),
    ...(message.snapshot === undefined ? {} : {
      messages: message.snapshot.messages.map(entry => entry.text),
    }),
  })), [
    { action: 'page-sync', messages: ['你好'] },
    { action: 'page-event', eventType: 'message_sent', args: [0] },
    { action: 'page-sync', messages: ['你好', '你好。'] },
    { action: 'page-event', eventType: 'message_received', args: [1, 'normal'] },
  ])

  sessions.select('session-b')
  const last = frame.messages.at(-1)
  assert.notEqual(last, undefined)
  assert.equal((last as { readonly action: string }).action, 'session-bind')
  assert.equal(frame.messages.filter(message => (
    message as { readonly action?: string }
  ).action === 'page-event').length, 2)
  dispose()
})

test('drops queued events from a Session replaced before the frame is ready', async () => {
  const registry = new InstalledStExtensionRegistry()
  const document = new FakeDocument()
  const window = new FakeWindow()
  const sessions = new FakeSessionSource()
  const dispose = installStExtensionHost(
    window as unknown as Window,
    document as unknown as Document,
    registry,
    sessions,
    { read: async () => ({}), write: async settings => settings },
    () => undefined,
  )
  registry.register({
    id: 'extension.events', displayName: 'Events', loadingOrder: 0, source: 'export {}',
  })
  await flushRebuild()
  const frame = document.frames[0] as FakeFrame
  const token = JSON.parse(frame.srcdoc.match(/const boot=(\{.*?\});const entries/u)?.[1] ?? '{}').token as string
  const initial = sessions.currentBinding!.projection!
  sessions.updateProjection(withTranscript(initial, [{
    messageId: 0, seq: 10, role: 'user', text: '旧会话消息', isHidden: false,
  }]))
  sessions.select('session-b')

  window.dispatch(frame.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host', token,
    action: 'host-state', status: 'ready', loaded: ['extension.events'], failed: [],
  })
  assert.deepEqual((frame.messages as { readonly action: string; readonly sessionId?: string }[])
    .map(message => ({ action: message.action, sessionId: message.sessionId })), [
    { action: 'session-bind', sessionId: 'session-b' },
  ])
  dispose()
})

test('drops a queued append removed by a same-Session transcript rewrite', async () => {
  const registry = new InstalledStExtensionRegistry()
  const document = new FakeDocument()
  const window = new FakeWindow()
  const sessions = new FakeSessionSource()
  const dispose = installStExtensionHost(
    window as unknown as Window,
    document as unknown as Document,
    registry,
    sessions,
    { read: async () => ({}), write: async settings => settings },
    () => undefined,
  )
  registry.register({
    id: 'extension.events', displayName: 'Events', loadingOrder: 0, source: 'export {}',
  })
  await flushRebuild()
  const frame = document.frames[0] as FakeFrame
  const token = JSON.parse(frame.srcdoc.match(/const boot=(\{.*?\});const entries/u)?.[1] ?? '{}').token as string
  const initial = sessions.currentBinding!.projection!
  sessions.updateProjection(withTranscript(initial, [{
    messageId: 0, seq: 10, role: 'user', text: '稍后被改写', isHidden: false,
  }]))
  sessions.updateProjection(withTranscript(initial, [{
    messageId: 0, seq: 20, role: 'assistant', text: '替换后的基线', isHidden: false,
  }]))

  window.dispatch(frame.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host', token,
    action: 'host-state', status: 'ready', loaded: ['extension.events'], failed: [],
  })
  assert.deepEqual((frame.messages as { readonly action: string }[]).map(message => message.action), [
    'page-sync',
  ])
  dispose()
})

test('persists generation prompts before acknowledging the selected browser barrier', async () => {
  const registry = new InstalledStExtensionRegistry()
  const document = new FakeDocument()
  const window = new FakeWindow()
  const sessions = new FakeSessionSource()
  const polls: {
    readonly sessionId: string
    readonly signal: AbortSignal
    readonly resolve: (request: {
      readonly format: 0
      readonly requestId: string
      readonly sessionId: string
      readonly turn: number
    } | undefined) => void
  }[] = []
  const completions: unknown[] = []
  const writes: unknown[] = []
  let releaseWrite!: () => void
  const writeBarrier = new Promise<void>(resolve => { releaseWrite = resolve })
  const dispose = installStExtensionHost(
    window as unknown as Window,
    document as unknown as Document,
    registry,
    sessions,
    { read: async () => ({}), write: async settings => settings },
    () => undefined,
    undefined,
    {
      client: {
        clientId: 'browser-a',
        poll: (sessionId, signal) => new Promise(resolve => {
          polls.push({ sessionId, signal, resolve })
        }),
        complete: async value => { completions.push(value) },
      },
      replacePrompts: async (sessionId, prompts) => {
        writes.push({ sessionId, prompts })
        await writeBarrier
      },
    },
  )
  registry.register({
    id: 'extension.memory', displayName: 'Memory', loadingOrder: 0,
    generateInterceptor: 'memoryInterceptor', source: 'export {}',
  })
  await flushRebuild()
  const frame = document.frames[0] as FakeFrame
  const token = JSON.parse(frame.srcdoc.match(/const boot=(\{.*?\});const entries/u)?.[1] ?? '{}').token as string
  window.dispatch(frame.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host', token,
    action: 'host-state', status: 'ready', loaded: ['extension.memory'], failed: [],
  })
  assert.equal(polls.length, 1)
  assert.equal(polls[0]?.sessionId, 'session-a')
  polls[0]?.resolve({ format: 0, requestId: 'request-a', sessionId: 'session-a', turn: 4 })
  await flushRebuild()
  assert.deepEqual(frame.messages.at(-1), {
    source: 'dsh-agent-rp-host', action: 'generation-start', token,
    requestId: 'request-a', sessionId: 'session-a', turn: 4,
  })

  const prompts = [{
    id: 'woven_imprint_memory', position: 'in_chat' as const, depth: 2, role: 'system' as const,
    content: '本轮记忆', shouldScan: false, once: false as const,
  }]
  window.dispatch(frame.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host', token, action: 'injections-replace',
    requestId: 'request-a', sessionId: 'session-a', prompts,
  })
  window.dispatch(frame.contentWindow, {
    source: 'dsh-agent-rp-st-extension-host', token, action: 'generation-ready',
    requestId: 'request-a', sessionId: 'session-a', outcome: 'applied',
  })
  await flushRebuild()
  assert.deepEqual(writes, [{ sessionId: 'session-a', prompts }])
  assert.deepEqual(completions, [])
  releaseWrite()
  for (let index = 0; index < 8 && completions.length === 0; index += 1) await Promise.resolve()
  assert.deepEqual(completions, [{
    format: 0, operation: 'complete', requestId: 'request-a', sessionId: 'session-a', outcome: 'applied',
  }])
  for (let index = 0; index < 4 && polls.length < 2; index += 1) await Promise.resolve()
  assert.equal(polls.length, 2)

  dispose()
  assert.equal(polls[1]?.signal.aborted, true)
})
