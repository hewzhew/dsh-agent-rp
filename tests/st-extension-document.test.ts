import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compileStExtensionDocument,
  compileStExtensionGenerationEventAdapter,
  compileStExtensionGenerationRuntime,
  parseStExtensionHostMessage,
} from '../src/client/st-extension-document.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { InstalledStExtensionEntry } from '../src/client/st-extension-registry.ts'
import { tavernPageSnapshot } from '../src/client/tavern-snapshot.ts'
import { agentRpProjectionDefinition } from '../src/projection.ts'

function entry(
  id: string,
  dependencies: readonly string[] = [],
  source = `globalThis[${JSON.stringify(id)}] = true`,
): InstalledStExtensionEntry {
  return Object.freeze({
    id,
    displayName: id,
    loadingOrder: 0,
    dependencies: Object.freeze([...dependencies]),
    source,
  })
}

test('builds one shared settings document and transports extension source without HTML termination', () => {
  const dangerous = 'globalThis.loaded = "</script><script>globalThis.injected = true</script>\u2028"'
  const projectionSession = Session.create(SessionId('settings-document'))
  const projection = agentRpProjectionDefinition.wire.view(
    agentRpProjectionDefinition.init(projectionSession.header),
  )
  const source = compileStExtensionDocument({
    entries: [entry('extension.dangerous', [], dangerous)],
    nonce: 'nonce_1234567890_safe',
    sessionId: 'session-a',
    settings: { community: { enabled: true } },
    snapshot: tavernPageSnapshot(projection, SessionId('session-a')),
    token: 'token</script>',
  })

  assert.equal((source.match(/id="extensions_settings"/gu) ?? []).length, 1)
  assert.equal((source.match(/id="extensions_settings2"/gu) ?? []).length, 1)
  assert.equal(source.includes(dangerous), false)
  assert.equal(source.includes('</script><script>globalThis.injected'), false)
  assert.match(source, /\\u003c\/script>\\u003cscript>globalThis\.injected/u)
  assert.match(source, /\\u2028/u)
  assert.equal(source.includes('Content-Security-Policy'), false)
  assert.match(source, /background:transparent;color:CanvasText;color-scheme:dark/u)
  assert.match(source, /URL\.createObjectURL\(new Blob/u)
  assert.match(source, /await import\(url\)/u)
  assert.match(source, /globalThis\.extension_settings=clone\(boot\.settings\)/u)
  assert.match(source, /globalThis\.saveSettingsDebounced=/u)
  assert.match(source, /context\.saveSettings=saveSettings/u)
  assert.match(source, /context\.saveSettingsDebounced=globalThis\.saveSettingsDebounced/u)
  assert.match(source, /globalThis\.__dshAgentRpSessionId=sessionId/u)
  assert.match(source, /globalThis\.SillyTavern=context/u)
  assert.match(source, /globalThis\.getContext=\(\)=>context/u)
  assert.match(source, /description:String\(data\.description\?\?''\)/u)
  assert.match(source, /personality:String\(data\.personality\?\?''\)/u)
  assert.match(source, /CHAT_CHANGED:'chat_id_changed'/u)
  assert.match(source, /MESSAGE_UPDATED:'message_updated'/u)
  assert.match(source, /GENERATION_STARTED:'generation_started'/u)
  assert.match(source, /applySnapshot\(message\.snapshot\)/u)
  assert.match(source, /message\.action==='page-sync'/u)
  assert.match(source, /message\.action==='page-event'/u)
  assert.match(source, /enqueueEvent\(message\.eventType,clone\(message\.args\)\)/u)
  assert.match(source, /dsh-agent-rp-session-change/u)
  assert.match(source, /style\?\.remove\(\)/u)
  assert.match(source, /catch\{return '无法读取扩展错误'\}/u)
  const program = source.match(/<script nonce="nonce_1234567890_safe">([\s\S]*)<\/script>/u)?.[1]
  assert.notEqual(program, undefined)
  assert.doesNotThrow(() => new Function(program!))
})

test('installs generation APIs in the document foundation instead of the first extension module', () => {
  const source = compileStExtensionDocument({
    entries: [entry('extension.invalid', [], 'export const broken =')],
    nonce: 'nonce_1234567890_safe',
    sessionId: 'session-a',
    settings: {},
    token: 'host-token',
  })
  const boot = JSON.parse(source.match(/const boot=(\{.*?\});const entries/u)?.[1] ?? '{}') as {
    readonly entries?: readonly { readonly source?: string }[]
  }
  const firstSource = boot.entries?.[0]?.source

  assert.equal(firstSource, 'globalThis.__dshAgentRpCurrentExtensionId="extension.invalid";\nexport const broken =')
  assert.doesNotMatch(firstSource, /extension_prompt_types|interceptorOnly/u)
  const contextIndex = source.indexOf('globalThis.SillyTavern=context')
  const generationIndex = source.indexOf('globalThis.extension_prompt_types=types')
  const activationIndex = source.indexOf('const run=async entry=>')
  assert.ok(contextIndex >= 0 && contextIndex < generationIndex)
  assert.ok(generationIndex < activationIndex)
  assert.match(source, /\}\)\(\);\n\(\(\)=>\{'use strict';const boot=\{"interceptorOnly"/u)
})

test('compiles dependency-aware isolated activation with terminal host reporting', () => {
  const source = compileStExtensionDocument({
    entries: [
      entry('extension.dependent', ['extension.base']),
      entry('extension.base'),
      entry('extension.missing', ['extension.absent']),
    ],
    nonce: 'nonce_1234567890_safe',
    sessionId: null,
    settings: {},
    token: 'host-token',
  })

  assert.match(source, /entry\.dependencies\.some\(id=>!loaded\.has\(id\)\)/u)
  assert.match(source, /await run\(entry\)/u)
  assert.match(source, /if\(progressed\)continue/u)
  assert.match(source, /扩展依赖存在循环/u)
  assert.match(source, /status:'failed'/u)
  assert.match(source, /status:'loaded'/u)
  assert.match(source, /post\('host-state',\{status:'ready'/u)
})

test('rejects a nonce that could escape the CSP attribute', () => {
  assert.throws(() => compileStExtensionDocument({
    entries: [],
    nonce: 'bad\" nonce',
    sessionId: null,
    settings: {},
    token: 'token',
  }), /nonce is invalid/u)
})

test('accepts only bounded lifecycle reports for the current frame token', () => {
  assert.deepEqual(parseStExtensionHostMessage({
    source: 'dsh-agent-rp-st-extension-host',
    token: 'current',
    action: 'host-state',
    status: 'ready',
    loaded: ['extension.a'],
    failed: ['extension.b'],
  }, 'current'), {
    source: 'dsh-agent-rp-st-extension-host',
    token: 'current',
    action: 'host-state',
    status: 'ready',
    loaded: ['extension.a'],
    failed: ['extension.b'],
  })
  assert.equal(parseStExtensionHostMessage({
    source: 'dsh-agent-rp-st-extension-host',
    token: 'stale',
    action: 'settings-surface',
    hasContent: true,
  }, 'current'), undefined)
  assert.deepEqual(parseStExtensionHostMessage({
    source: 'dsh-agent-rp-st-extension-host',
    token: 'current',
    action: 'settings-save',
    settings: { community: { enabled: true } },
  }, 'current'), {
    source: 'dsh-agent-rp-st-extension-host',
    token: 'current',
    action: 'settings-save',
    settings: { community: { enabled: true } },
  })
  assert.equal(parseStExtensionHostMessage({
    source: 'dsh-agent-rp-st-extension-host',
    token: 'current',
    action: 'settings-save',
    settings: [],
  }, 'current'), undefined)
  assert.equal(parseStExtensionHostMessage({
    source: 'dsh-agent-rp-st-extension-host',
    token: 'current',
    action: 'extension-state',
    extensionId: 'extension.a',
    status: 'failed',
    error: '',
  }, 'current'), undefined)
  assert.equal(parseStExtensionHostMessage({
    source: 'dsh-agent-rp-st-extension-host',
    token: 'current',
    action: 'host-state',
    status: 'ready',
    loaded: ['extension.a'],
    failed: ['extension.a'],
  }, 'current'), undefined)
  assert.deepEqual(parseStExtensionHostMessage({
    source: 'dsh-agent-rp-st-extension-host', token: 'current', action: 'injections-replace',
    requestId: 'request-a', sessionId: 'session-a', prompts: [{
      id: 'memory', position: 'in_chat', depth: 2, role: 'system', content: '记忆',
      shouldScan: false, once: false,
    }],
  }, 'current'), {
    source: 'dsh-agent-rp-st-extension-host', token: 'current', action: 'injections-replace',
    requestId: 'request-a', sessionId: 'session-a', prompts: [{
      id: 'memory', position: 'in_chat', depth: 2, role: 'system', content: '记忆',
      shouldScan: false, once: false,
    }],
  })
  assert.deepEqual(parseStExtensionHostMessage({
    source: 'dsh-agent-rp-st-extension-host', token: 'current', action: 'generation-ready',
    requestId: 'request-a', sessionId: 'session-a', outcome: 'failed', error: 'sidecar unavailable',
  }, 'current'), {
    source: 'dsh-agent-rp-st-extension-host', token: 'current', action: 'generation-ready',
    requestId: 'request-a', sessionId: 'session-a', outcome: 'failed', error: 'sidecar unavailable',
  })
  assert.equal(parseStExtensionHostMessage({
    source: 'dsh-agent-rp-st-extension-host', token: 'current', action: 'generation-ready',
    requestId: 'request-a', sessionId: 'session-a', outcome: 'applied', error: 'unexpected',
  }, 'current'), undefined)
})

test('runs generation events and declared interceptors before publishing durable prompts', async () => {
  const runtime = compileStExtensionGenerationRuntime({
    entries: [
      entry('extension.first'),
      { ...entry('extension.memory'), generateInterceptor: 'memoryInterceptor' },
      { ...entry('extension.after'), generateInterceptor: 'afterInterceptor' },
    ],
    nonce: 'nonce_1234567890_safe',
    sessionId: 'session-a',
    settings: {},
    snapshot: {
      ...tavernPageSnapshot(
        agentRpProjectionDefinition.wire.view(agentRpProjectionDefinition.init(
          Session.create(SessionId('generation-document')).header,
        )),
        SessionId('session-a'),
      ),
      installedExtensionPrompts: [{
        id: 'previous', position: 'before', depth: 0, role: 'user', content: '旧提示',
        shouldScan: true, once: false,
      }],
    },
    token: 'frame-token',
  })
  const order: string[] = []
  const posts: unknown[] = []
  const listeners: ((event: { readonly source: object; readonly data: unknown }) => void)[] = []
  const parent = { postMessage: (message: unknown) => { posts.push(message) } }
  const scope: Record<string, unknown> = {
    __dshAgentRpSessionId: 'session-a',
    event_types: { GENERATION_STARTED: 'generation_started' },
    eventSource: {
      emit: async (event: string) => { order.push(`event:${event}`) },
    },
    SillyTavern: { getContext() { return this } },
  }
  new Function('globalThis', 'parent', 'addEventListener', runtime)(
    scope,
    parent,
    (name: string, listener: (event: { readonly source: object; readonly data: unknown }) => void) => {
      assert.equal(name, 'message')
      listeners.push(listener)
    },
  )
  const context = scope.SillyTavern as {
    readonly extension_prompts: Record<string, { readonly value: string }>
  }
  assert.equal(context.extension_prompts.previous?.value, '旧提示')
  scope.memoryInterceptor = async () => {
    order.push('interceptor:memory')
    const setPrompt = scope.setExtensionPrompt as (...args: unknown[]) => void
    const types = scope.extension_prompt_types as { readonly IN_CHAT: number }
    const roles = scope.extension_prompt_roles as { readonly SYSTEM: number }
    setPrompt('woven_imprint_memory', '本轮记忆', types.IN_CHAT, 2, false, roles.SYSTEM)
  }
  scope.afterInterceptor = async () => { order.push('interceptor:after') }
  listeners[0]?.({
    source: parent,
    data: {
      source: 'dsh-agent-rp-host', token: 'frame-token', action: 'generation-start',
      requestId: 'request-a', sessionId: 'session-a', turn: 7,
    },
  })
  for (let index = 0; index < 8 && posts.length < 2; index += 1) await Promise.resolve()

  assert.deepEqual(order, [
    'event:generation_started', 'interceptor:memory', 'interceptor:after',
  ])
  assert.deepEqual(posts, [
    {
      source: 'dsh-agent-rp-st-extension-host', token: 'frame-token', action: 'injections-replace',
      requestId: 'request-a', sessionId: 'session-a', prompts: [
        {
          id: 'previous', position: 'before', depth: 0, role: 'user', content: '旧提示',
          shouldScan: true, once: false,
        },
        {
          id: 'woven_imprint_memory', position: 'in_chat', depth: 2, role: 'system', content: '本轮记忆',
          shouldScan: false, once: false,
        },
      ],
    },
    {
      source: 'dsh-agent-rp-st-extension-host', token: 'frame-token', action: 'generation-ready',
      requestId: 'request-a', sessionId: 'session-a', outcome: 'applied',
    },
  ])
})

test('suppresses only an explicitly interceptor-owned generation listener', async () => {
  const adapter = compileStExtensionGenerationEventAdapter({
    entries: [
      {
        ...entry('extension.memory'),
        generateInterceptor: 'memoryInterceptor',
        generationStartedEvent: 'interceptor-only',
      },
      entry('extension.events'),
    ],
    nonce: 'nonce_1234567890_safe',
    sessionId: 'session-a',
    settings: {},
    token: 'frame-token',
  })
  const listeners = new Set<(...args: unknown[]) => unknown>()
  const original = {
    on: (_type: string, listener: (...args: unknown[]) => unknown) => { listeners.add(listener) },
    once: (_type: string, listener: (...args: unknown[]) => unknown) => { listeners.add(listener) },
    emit: async (...args: unknown[]) => {
      for (const listener of listeners) await listener(...args.slice(1))
    },
    emitAndWait: async (...args: unknown[]) => {
      for (const listener of listeners) await listener(...args.slice(1))
    },
    removeListener: (_type: string, listener: (...args: unknown[]) => unknown) => {
      listeners.delete(listener)
    },
  }
  const scope: Record<string, unknown> = {
    event_types: { GENERATION_STARTED: 'generation_started' },
    eventSource: original,
    SillyTavern: { eventSource: original },
  }
  new Function('globalThis', adapter)(scope)
  const adapted = scope.eventSource as typeof original
  const observed: string[] = []
  scope.__dshAgentRpCurrentExtensionId = 'extension.memory'
  adapted.on('generation_started', () => { observed.push('memory-event') })
  scope.__dshAgentRpCurrentExtensionId = 'extension.events'
  adapted.on('generation_started', () => { observed.push('ordinary-event') })
  await adapted.emit('generation_started')

  assert.deepEqual(observed, ['ordinary-event'])
})
