/** Browser lifecycle owner for the singleton installed ST extension document. */

import { compileStExtensionDocument, parseStExtensionHostMessage } from './st-extension-document.ts'
import type { InstalledStExtensionRegistry } from './st-extension-registry.ts'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentRpProjection } from '../projection-types.ts'
import { tavernPageSnapshot } from './tavern-snapshot.ts'
import type { InstalledStExtensionSurface } from './st-extension-surface.tsx'
import { advanceTavernTranscript, type TavernTranscriptCursor } from './tavern-transcript.ts'
import type { TavernInstalledExtensionPrompt } from '../tavern-helper.ts'
import type {
  StExtensionGenerationRequest,
} from '../st-extension-generation-protocol.ts'
import type { StExtensionGenerationClient } from './st-extension-generation.ts'

type ExtensionSettings = Readonly<Record<string, JsonValue>>

interface StExtensionPageEvent {
  readonly role: 'user' | 'assistant'
  readonly seq: number
}

function transcriptPageEvents(
  messages: readonly NonNullable<AgentRpProjection['tavern']>['messages'][number][],
): readonly StExtensionPageEvent[] {
  return messages.map(message => ({ role: message.role, seq: message.seq }))
}

/** Persistent settings operations owned by the installed extension collection. */
export interface StExtensionSettingsStore {
  readonly read: () => Promise<ExtensionSettings>
  readonly write: (settings: ExtensionSettings) => Promise<ExtensionSettings>
}

/** Current DSH Session and its reference-stable Agent RP projection. */
export interface StExtensionSessionBinding {
  readonly sessionId: SessionId
  readonly projection?: AgentRpProjection
}

/** Current DSH Session selection observed without owning its lifecycle. */
export interface StExtensionSessionSource {
  readonly current: () => StExtensionSessionBinding | undefined
  readonly subscribe: (listener: () => void) => () => void
}

/** Durable write and long-poll transport for generation-time extension prompts. */
export interface StExtensionGenerationBridge {
  readonly client: StExtensionGenerationClient
  readonly replacePrompts: (
    sessionId: SessionId,
    prompts: readonly TavernInstalledExtensionPrompt[],
  ) => Promise<void>
}

interface PendingFrameGeneration {
  readonly frame: HTMLIFrameElement
  readonly request: StExtensionGenerationRequest
  readonly sessionId: SessionId
  promptWrite: Promise<void>
  ready: boolean
  readonly finish: (result: { readonly outcome: 'applied' | 'failed'; readonly error?: string }) => void
}

/**
 * Mount one rebuildable extension iframe for a browser ClientContext.
 * @param hostWindow - Browser window receiving reports from the current frame.
 * @param hostDocument - Browser document that owns the singleton frame.
 * @param registry - Client-side extension registration source.
 * @param warn - Content-free lifecycle warning sink.
 * @returns Complete teardown for the Client plugin effect.
 */
export function installStExtensionHost(
  hostWindow: Window,
  hostDocument: Document,
  registry: InstalledStExtensionRegistry,
  sessionSource: StExtensionSessionSource,
  settingsStore: StExtensionSettingsStore,
  warn: (message: string) => void,
  surface?: InstalledStExtensionSurface,
  generation?: StExtensionGenerationBridge,
): () => void {
  let active = true
  let scheduled = false
  let frame: HTMLIFrameElement | undefined
  let frameReady = false
  let pendingSync: 'session-bind' | 'page-sync' | undefined
  let pendingEvents: readonly StExtensionPageEvent[] = []
  let token: string | undefined
  let sessionBinding = sessionSource.current()
  let transcriptCursor: TavernTranscriptCursor | undefined = advanceTavernTranscript(
    undefined,
    sessionBinding?.projection?.tavern?.messages ?? [],
  ).cursor
  let settings: ExtensionSettings = {}
  let settingsWrites: Promise<void> = Promise.resolve()
  let generationLoopAbort: AbortController | undefined
  let pendingGeneration: PendingFrameGeneration | undefined
  const settingsReady = settingsStore.read().then(value => {
    settings = value
  }, (error: unknown) => {
    warn(`agent-rp: installed ST extension settings failed to load: ${String(error)}`)
  })

  const stopGenerationLoop = (): void => {
    generationLoopAbort?.abort()
    generationLoopAbort = undefined
  }

  const runFrameGeneration = (
    request: StExtensionGenerationRequest,
    currentSessionId: SessionId,
    currentFrame: HTMLIFrameElement,
    currentToken: string,
    signal: AbortSignal,
  ): Promise<{ readonly outcome: 'applied' | 'failed'; readonly error?: string }> => new Promise(resolve => {
    if (signal.aborted) {
      resolve({ outcome: 'failed', error: 'extension document changed before generation' })
      return
    }
    let settled = false
    const finish = (result: { readonly outcome: 'applied' | 'failed'; readonly error?: string }): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (pendingGeneration?.request.requestId === request.requestId) pendingGeneration = undefined
      resolve(result)
    }
    const abort = (): void => {
      finish({ outcome: 'failed', error: 'extension document changed during generation' })
    }
    pendingGeneration = {
      frame: currentFrame,
      request,
      sessionId: currentSessionId,
      promptWrite: Promise.resolve(),
      ready: false,
      finish,
    }
    signal.addEventListener('abort', abort, { once: true })
    currentFrame.contentWindow?.postMessage({
      source: 'dsh-agent-rp-host', action: 'generation-start', token: currentToken,
      requestId: request.requestId, sessionId: request.sessionId, turn: request.turn,
    }, '*')
  })

  const startGenerationLoop = (): void => {
    stopGenerationLoop()
    const currentFrame = frame
    const currentToken = token
    const currentSessionId = sessionBinding?.sessionId
    if (!active || generation === undefined || !frameReady || currentFrame === undefined
      || currentToken === undefined || currentSessionId === undefined) return
    const controller = new AbortController()
    generationLoopAbort = controller
    void (async () => {
      while (active && !controller.signal.aborted && frame === currentFrame
        && token === currentToken && sessionBinding?.sessionId === currentSessionId) {
        let request: StExtensionGenerationRequest | undefined
        try {
          request = await generation.client.poll(String(currentSessionId), controller.signal)
        } catch (error: unknown) {
          if (!controller.signal.aborted) {
            warn(`agent-rp: installed ST extension generation poll failed: ${String(error)}`)
          }
          return
        }
        if (request === undefined) continue
        const result = request.sessionId === String(currentSessionId)
          ? await runFrameGeneration(request, currentSessionId, currentFrame, currentToken, controller.signal)
          : { outcome: 'failed' as const, error: 'generation request Session does not match browser host' }
        try {
          await generation.client.complete({
            format: 0,
            operation: 'complete',
            requestId: request.requestId,
            sessionId: request.sessionId,
            ...result,
          })
        } catch (error: unknown) {
          if (!controller.signal.aborted) {
            warn(`agent-rp: installed ST extension generation completion failed: ${String(error)}`)
          }
        }
      }
    })()
  }

  const removeFrame = (): void => {
    stopGenerationLoop()
    if (frame !== undefined) surface?.detachFrame(frame)
    frame?.remove()
    frame = undefined
    frameReady = false
    pendingSync = undefined
    pendingEvents = []
    token = undefined
  }
  const rebuild = (): void => {
    scheduled = false
    if (!active) return
    removeFrame()
    const snapshot = registry.getSnapshot()
    if (snapshot.entries.length === 0) return
    void settingsReady.then(() => {
      if (!active || registry.getSnapshot().revision !== snapshot.revision) {
        schedule()
        return
      }
      token = crypto.randomUUID()
      const nonce = crypto.randomUUID().replaceAll('-', '')
      const next = hostDocument.createElement('iframe')
      next.title = 'SillyTavern 扩展宿主'
      next.dataset.agentRpStExtensionHost = ''
      next.dataset.agentRpStExtensionPhase = 'booting'
      next.dataset.agentRpStExtensionRevision = String(snapshot.revision)
      next.hidden = surface === undefined
      next.referrerPolicy = 'no-referrer'
      next.srcdoc = compileStExtensionDocument({
        entries: snapshot.entries,
        nonce,
        sessionId: sessionBinding?.sessionId ?? null,
        settings,
        ...(sessionBinding?.projection === undefined ? {} : {
          snapshot: tavernPageSnapshot(sessionBinding.projection, sessionBinding.sessionId, settings),
        }),
        token,
      })
      frame = next
      if (surface === undefined) hostDocument.body.append(next)
      else surface.attachFrame(next, snapshot.revision)
    })
  }
  const schedule = (): void => {
    if (scheduled || !active) return
    scheduled = true
    queueMicrotask(rebuild)
  }
  const postBinding = (action: 'session-bind' | 'page-sync'): void => {
    frame?.contentWindow?.postMessage({
      source: 'dsh-agent-rp-host', action, token,
      sessionId: sessionBinding?.sessionId ?? null,
      snapshot: sessionBinding?.projection === undefined
        ? null
        : tavernPageSnapshot(sessionBinding.projection, sessionBinding.sessionId, settings),
    }, '*')
  }
  const postEvents = (events: readonly StExtensionPageEvent[]): void => {
    for (const event of events) {
      const message = sessionBinding?.projection?.tavern?.messages.find(candidate => (
        candidate.seq === event.seq && candidate.role === event.role
      ))
      if (message === undefined) continue
      frame?.contentWindow?.postMessage({
        source: 'dsh-agent-rp-host', action: 'page-event', token,
        eventType: message.role === 'user' ? 'message_sent' : 'message_received',
        args: message.role === 'user' ? [message.messageId] : [message.messageId, 'normal'],
      }, '*')
    }
  }
  const bindSession = (): void => {
    const next = sessionSource.current()
    if (next?.sessionId === sessionBinding?.sessionId && next?.projection === sessionBinding?.projection) return
    const sessionChanged = next?.sessionId !== sessionBinding?.sessionId
    const advanced = advanceTavernTranscript(
      sessionChanged ? undefined : transcriptCursor,
      next?.projection?.tavern?.messages ?? [],
    )
    transcriptCursor = advanced.cursor
    sessionBinding = next
    if (frame === undefined) return
    const action = sessionChanged ? 'session-bind' : 'page-sync'
    const events = sessionChanged ? [] : transcriptPageEvents(advanced.appended)
    if (!frameReady) {
      if (action === 'session-bind') {
        pendingSync = action
        pendingEvents = []
      } else {
        pendingSync ??= action
        pendingEvents = [...pendingEvents, ...events]
      }
      return
    }
    postBinding(action)
    postEvents(events)
    if (sessionChanged) startGenerationLoop()
  }
  const receive = (event: MessageEvent<unknown>): void => {
    if (frame === undefined || token === undefined || event.source !== frame.contentWindow) return
    const message = parseStExtensionHostMessage(event.data, token)
    if (message === undefined) return
    if (message.action === 'settings-save') {
      settingsWrites = settingsWrites.then(async () => {
        settings = await settingsStore.write(message.settings)
      }).catch((error: unknown) => {
        warn(`agent-rp: installed ST extension settings failed to save: ${String(error)}`)
      })
      return
    }
    if (message.action === 'settings-surface') {
      frame.dataset.agentRpStExtensionSettings = message.hasContent ? 'visible' : 'empty'
      surface?.setAvailable(message.hasContent)
      return
    }
    if (message.action === 'injections-replace') {
      const pending = pendingGeneration
      if (generation === undefined || pending === undefined || pending.frame !== frame
        || pending.request.requestId !== message.requestId
        || pending.request.sessionId !== message.sessionId || pending.ready) return
      pending.promptWrite = pending.promptWrite.then(() => generation.replacePrompts(
        pending.sessionId,
        message.prompts,
      ))
      return
    }
    if (message.action === 'generation-ready') {
      const pending = pendingGeneration
      if (pending === undefined || pending.frame !== frame
        || pending.request.requestId !== message.requestId
        || pending.request.sessionId !== message.sessionId || pending.ready) return
      pending.ready = true
      void pending.promptWrite.then(() => {
        pending.finish(message.outcome === 'applied'
          ? { outcome: 'applied' }
          : { outcome: 'failed', ...(message.error === undefined ? {} : { error: message.error }) })
      }, (error: unknown) => {
        pending.finish({ outcome: 'failed', error: String(error).slice(0, 8_000) })
      })
      return
    }
    if (message.action === 'extension-state') {
      if (message.status === 'failed') {
        warn(`agent-rp: installed ST extension ${JSON.stringify(message.extensionId)} failed: ${message.error}`)
      }
      return
    }
    frame.dataset.agentRpStExtensionPhase = message.status
    frame.dataset.agentRpStExtensionLoaded = String(message.loaded.length)
    frame.dataset.agentRpStExtensionFailed = String(message.failed.length)
    surface?.setHostState(message.status, message.loaded.length, message.failed.length)
    frameReady = message.status === 'ready'
    if (pendingSync !== undefined) postBinding(pendingSync)
    postEvents(pendingEvents)
    pendingSync = undefined
    pendingEvents = []
    if (frameReady) startGenerationLoop()
    if (message.status === 'failed') warn(`agent-rp: installed ST extension host failed: ${message.error}`)
  }

  hostWindow.addEventListener('message', receive)
  const unsubscribe = registry.subscribe(schedule)
  const unsubscribeSession = sessionSource.subscribe(bindSession)
  schedule()
  return () => {
    if (!active) return
    active = false
    unsubscribe()
    unsubscribeSession()
    hostWindow.removeEventListener('message', receive)
    removeFrame()
  }
}
