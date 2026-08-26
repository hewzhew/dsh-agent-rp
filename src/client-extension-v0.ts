/** Versioned browser contract for independent DSH plugins extending Agent RP UI. */

import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** The API version encoded by the `@hewzhew/dsh-agent-rp/client-extension/v0` export. */
export const AGENT_RP_CLIENT_EXTENSION_API_VERSION = 0 as const

/** Ordered external sections rendered inside the Agent RP sidebar workbench. */
export const AGENT_RP_WORKBENCH_SECTION_SLOT = 'agent-rp.workbench.section' as const

/** Client Cordis service used by independent plugins to install ST extension bundles. */
export const AGENT_RP_ST_EXTENSION_SERVICE = 'agentRpStExtensions' as const

/** One installed ST extension contributed by a trusted DSH client plugin. */
export interface AgentRpInstalledStExtensionRegistration {
  readonly id: string
  readonly displayName: string
  readonly loadingOrder: number
  readonly dependencies?: readonly string[]
  /** Optional manifest global invoked and awaited after GENERATION_STARTED. */
  readonly generateInterceptor?: string
  /** Skip this extension's GENERATION_STARTED listeners when its interceptor replaces them. */
  readonly generationStartedEvent?: 'emit' | 'interceptor-only'
  /** Self-contained ESM bundle evaluated in the singleton extension document. */
  readonly source: string
  /** Optional stylesheet text installed in the same document. */
  readonly style?: string
}

/** Public write-only face of the singleton ST extension registry. */
export interface AgentRpInstalledStExtensionService {
  /**
   * Install one extension for the calling plugin's lifetime.
   * @param registration - Stable manifest identity and browser build output.
   * @returns Idempotent revocation for explicit early removal.
   */
  register(registration: AgentRpInstalledStExtensionRegistration): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentRpStExtensions: AgentRpInstalledStExtensionService
  }
}

/** Host actions available to one independent workbench section. */
export interface AgentRpWorkbenchSectionOwnerProps {
  /** Close the Agent RP workbench after the extension opens its own surface. */
  readonly closeWorkbench: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Trusted client plugins can add complete task rows without receiving Agent RP private state. */
    'agent-rp.workbench.section': {
      kind: 'list'
      scope: 'root'
      owner: AgentRpWorkbenchSectionOwnerProps
    }
  }
}

/** Props received by a registered Agent RP workbench section component. */
export type AgentRpWorkbenchSectionProps = PropsRuntime<typeof AGENT_RP_WORKBENCH_SECTION_SLOT>
