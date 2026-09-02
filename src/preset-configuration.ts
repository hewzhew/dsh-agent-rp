/** Host command adapter for session-owned Prompt Manager changes. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { configurePreset, parsePresetConfigurationRequest } from './preset-configuration-core.ts'
import { readActiveSessionPreset } from './import/session-preset.ts'
import { sessionEvents } from './session-events.ts'

export { canEditPresetPrompt, canTogglePresetPrompt, configurePreset, parsePresetConfigurationRequest } from './preset-configuration-core.ts'
export type { PresetConfigurationRequest } from './preset-configuration-types.ts'

/** Validate one UI-only preset command; its existing command/run event is the durable mutation. */
export function configurePresetFromCommand(invocation: {
  readonly agent: Agent
  readonly rawInput: string
}): { readonly kind: 'success' } {
  const events = sessionEvents(invocation.agent.session)
  const current = events.at(-1)
  if (current?.type !== 'command/run'
    || current.data.name !== 'rp-preset-configure'
    || current.data.args !== invocation.rawInput) {
    throw new Error('preset configuration command is not the current session event')
  }
  const active = readActiveSessionPreset(events.slice(0, -1))
  if (active === undefined) throw new Error('this roleplay Session has no imported preset')
  configurePreset(active, parsePresetConfigurationRequest(invocation.rawInput))
  return { kind: 'success' }
}
