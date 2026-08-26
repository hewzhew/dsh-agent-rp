import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentPresetGateway } from '../src/agent-capability-preset.ts'

const agentRpComposition = `
- id: agent-rp-runtime
  name: cordis:group
  isolate:
    agentRp.actorRevisions: true
  config:
    - id: agent-rp-character
      name: '@hewzhew/dsh-agent-rp'
      config:
        mode: character
`

/** Build the complete Agent preset service required to prove one fixture Agent mounted Agent RP. */
export function agentRpPresetGateway(options: {
  readonly active?: Agent
  readonly onMount?: (ctx: Context) => void
} = {}): AgentPresetGateway {
  const exactId = (id: string | undefined): 'agent-rp' => {
    if (id !== 'agent-rp') throw new Error(`Unexpected Agent preset id: ${String(id)}`)
    return id
  }
  return {
    list: async () => [{ id: 'agent-rp', trust: 'user' }],
    read: async id => { exactId(id); return agentRpComposition },
    resolve: async id => ({ id: exactId(id), trust: 'user' }),
    mount: async (ctx, id) => { exactId(id); options.onMount?.(ctx) },
    serviceFor: (agent, name) => agent === options.active && name === 'agentRp.actorRevisions' ? {} : undefined,
  }
}
