/** Model-free `/rp-draw` execution and cancellable provider lifecycle. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { GeneratedImageLibrary } from './generated-image-library.ts'
import { generateImage } from './image-generation-providers.ts'
import {
  encodeImageGenerationRecord,
  imageCredentialRefName,
  parseImageGenerationRequest,
  type GeneratedImageJob,
  type ImageGenerationRequest,
} from './image-generation-protocol.ts'
import { WorkspaceSettingsStore } from './workspace-settings-store.ts'
import { sessionEvents } from './session-events.ts'

const activeJobs = new Map<string, AbortController>()

function abortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError')
}

/** Run one configured image job for either a player command or a model tool. */
export async function executeConfiguredImageGeneration(
  library: GeneratedImageLibrary,
  settingsStore: WorkspaceSettingsStore,
  credentials: CredentialProvider,
  request: ImageGenerationRequest,
  signal: AbortSignal,
): Promise<GeneratedImageJob> {
  const normalized = parseImageGenerationRequest(request)
  const settings = settingsStore.get().imageGeneration
  library.begin(normalized, settings.provider)
  const controller = new AbortController()
  const relayAbort = (): void => { controller.abort(signal.reason) }
  signal.addEventListener('abort', relayAbort, { once: true })
  activeJobs.set(normalized.jobId, controller)
  try {
    const credential = await credentials.resolve(credentialRef(imageCredentialRefName(settings.provider)))
    const asset = await generateImage(
      settings,
      credential?.value,
      normalized.prompt,
      controller.signal,
      (progress, phase) => { library.progress(normalized.jobId, progress, phase) },
    )
    return library.complete(normalized.jobId, asset)
  } catch (error: unknown) {
    if (abortError(error, controller.signal)) {
      library.cancelled(normalized.jobId)
      throw new Error('图片生成已取消')
    }
    const message = error instanceof Error ? error.message : String(error)
    library.fail(normalized.jobId, message)
    throw new Error(message)
  } finally {
    signal.removeEventListener('abort', relayAbort)
    activeJobs.delete(normalized.jobId)
  }
}

/** Abort one currently running image job in this Host process. */
export function cancelGeneratedImageJob(jobId: string): boolean {
  const controller = activeJobs.get(jobId)
  if (controller === undefined) return false
  controller.abort(new Error('图片生成已取消'))
  return true
}

/** Execute a user-requested image command without adding image bytes to model history. */
export async function executeImageGenerationCommand(
  library: GeneratedImageLibrary,
  settingsStore: WorkspaceSettingsStore,
  credentials: CredentialProvider,
  invocation: {
    readonly commandId: CommandId
    readonly agent: Agent
    readonly rawInput: string
    readonly signal: AbortSignal
  },
): Promise<{ readonly kind: 'success'; readonly text: string }> {
  const request = parseImageGenerationRequest(invocation.rawInput)
  const source = sessionEvents(invocation.agent.session).at(-1)
  if (source?.type !== 'command/run' || source.data.name !== 'rp-draw'
    || String(source.data.commandId) !== String(invocation.commandId)) {
    throw new Error('图片生成命令不是当前 Session 事件')
  }
  const job = await executeConfiguredImageGeneration(
    library,
    settingsStore,
    credentials,
    request,
    invocation.signal,
  )
  return { kind: 'success', text: encodeImageGenerationRecord(job) }
}
