import { JsonValue, SessionEvent } from "@deepseek-ai/dsh-session";
import { Context } from "@deepseek-ai/cordis";
import { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import { Agent } from "@deepseek-ai/dsh-agent";

/** Reusable resource categories that can be selected independently for an experience. */
declare const ROLEPLAY_RESOURCE_KINDS: readonly ["actor", "persona", "world", "prompt-policy", "regex"];
type RoleplayResourceKind = typeof ROLEPLAY_RESOURCE_KINDS[number];
/** Source-neutral identity used to select one exact reusable resource. */
interface RoleplayResourceReference {
  readonly kind: RoleplayResourceKind;
  readonly id: string;
}
/** One reusable resource plus an optional provider-owned immutable variant. */
interface RoleplayResourceSelection extends RoleplayResourceReference {
  readonly variant?: string;
}
/** One selectable actor opening; preview is bounded presentation text, not the durable snapshot. */
interface RoleplayActorOpeningDetail {
  readonly id: string;
  readonly label: string;
  readonly preview: string;
  readonly truncated: boolean;
}
interface RoleplayActorResourceDetail {
  readonly kind: 'actor';
  readonly openings: readonly RoleplayActorOpeningDetail[];
}
interface RoleplayPersonaResourceDetail {
  readonly kind: 'persona';
  readonly description: string;
}
interface RoleplayWorldResourceDetail {
  readonly kind: 'world';
  readonly entryCount: number;
}
interface RoleplayPromptPolicyResourceDetail {
  readonly kind: 'prompt-policy';
  readonly moduleCount: number;
  readonly enabledModuleCount: number;
}
interface RoleplayRegexResourceDetail {
  readonly kind: 'regex';
  readonly scriptCount: number;
  readonly enabledCount: number;
  readonly displayCount: number;
  readonly promptCount: number;
}
/** Source-neutral, kind-specific information needed to configure one selection. */
type RoleplayResourceDetail = RoleplayActorResourceDetail | RoleplayPersonaResourceDetail | RoleplayWorldResourceDetail | RoleplayPromptPolicyResourceDetail | RoleplayRegexResourceDetail;
/** Stable reference and presentation metadata without source-format payloads. */
interface RoleplayResourceDescriptor extends RoleplayResourceReference {
  readonly name: string;
  readonly availability: 'available' | 'archived';
  readonly updatedAt?: number;
}
/** Host service used by trusted plugins to publish discoverable Roleplay resources. */
declare const ROLEPLAY_RESOURCE_CATALOG_KEY = "agentRp.resources";
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only Roleplay resource providers owned by the current Host. */
    'agentRp.resources': RoleplayResourceCatalog;
  }
}
/** One trusted provider. Returned descriptors must be detached, synchronous values. */
interface RoleplayResourceProvider {
  readonly id: string;
  list(): readonly RoleplayResourceDescriptor[];
  /** Return bounded kind-specific presentation details without exposing source payloads. */
  inspect?(descriptor: RoleplayResourceDescriptor): RoleplayResourceDetail;
  /** Preserve the Session-event prefix and append a snapshot when the selection is not already active. */
  materialize?(input: RoleplayResourceMaterializationInput): RoleplayResourceMaterialization;
}
/** Source-neutral facts shared with each provider while a new experience is assembled. */
interface RoleplayResourceMaterializationContext {
  readonly mode: 'character' | 'scene';
  readonly participantName?: string;
}
/** Detached input given to the unique provider that owns the selected resource. */
interface RoleplayResourceMaterializationInput {
  readonly selection: RoleplayResourceSelection;
  readonly descriptor: RoleplayResourceDescriptor;
  readonly events: readonly SessionEvent[];
  readonly context: RoleplayResourceMaterializationContext;
}
/** Complete event prefix after one provider has preserved it and optionally appended a snapshot. */
interface RoleplayResourceMaterialization {
  readonly events: readonly SessionEvent[];
  readonly title?: string;
}
/** Host-only ownership result used to dispatch a stable reference back to its provider. */
interface LocatedRoleplayResource {
  readonly providerId: string;
  readonly descriptor: RoleplayResourceDescriptor;
}
/**
 * Live resource directory. Providers retain their own storage and mutation policy;
 * the catalog exposes only normalized discovery metadata and exact runtime ids.
 */
declare class RoleplayResourceCatalog {
  #private;
  /** Register one provider and return a stale-disposer-safe revocation. */
  register(provider: RoleplayResourceProvider): () => void;
  /** Resolve a deterministic detached snapshot from every currently loaded provider. */
  list(kind?: RoleplayResourceKind): readonly RoleplayResourceDescriptor[];
  /** Resolve one exact kind/id pair without exposing a provider-specific object. */
  get(kind: RoleplayResourceKind, id: string): RoleplayResourceDescriptor | undefined;
  /** Locate the unique Host provider that owns one stable resource reference. */
  locate(kind: RoleplayResourceKind, id: string): LocatedRoleplayResource | undefined;
  /** Read bounded kind-specific details from the unique owning provider. */
  inspect(kind: RoleplayResourceKind, id: string): RoleplayResourceDetail;
  /** Dispatch one selection to its owning provider and verify append-only Session semantics. */
  materialize(selection: RoleplayResourceSelection, events: readonly SessionEvent[], context: RoleplayResourceMaterializationContext): RoleplayResourceMaterialization;
}
/** Register through the caller's Cordis scope so unload always removes the provider. */
declare function registerRoleplayResourceProvider(ctx: Context, provider: RoleplayResourceProvider): void;
/** Format-independent description of one Roleplay turn runtime. */
/** Stable lifecycle shared by native resources and compatibility adapters. */
declare const ROLEPLAY_TURN_PHASES: readonly ["prepare", "recall", "act", "settle", "present"];
type RoleplayTurnPhase = typeof ROLEPLAY_TURN_PHASES[number];
/** One resource bound into the current experience without exposing its source format. */
interface RoleplayResourceRef {
  readonly id: string;
  readonly name: string;
  readonly owner: 'deployment' | 'session';
  /** Optional adapter provenance for diagnostics; runtime consumers must not branch on it. */
  readonly adapter?: string;
}
/** The playable experience can be a single character or a world-owned scene. */
interface RoleplayExperienceRef extends RoleplayResourceRef {
  readonly mode: 'character' | 'scene';
}
/** Player identity selected independently from the actor and world. */
interface RoleplayParticipantRef extends RoleplayResourceRef {
  readonly description?: string;
}
/** One world resource and its semantic placement in the experience. */
interface RoleplayWorldBinding extends RoleplayResourceRef {
  readonly placement: 'actor' | 'experience';
}
/** Prompt policy selected for this turn, independent from provider/model settings. */
interface RoleplayPromptBinding {
  readonly strategy: 'native' | 'modules';
  readonly resource?: RoleplayResourceRef;
}
/** Replayable state namespace participating in this turn. */
interface RoleplayStateBinding {
  readonly id: string;
  readonly owner: 'deployment' | 'session';
  readonly adapter?: string;
  readonly revision?: number;
}
/** Runtime module contribution and the phases in which it participates. */
interface RoleplayModuleBinding {
  readonly id: string;
  readonly source: 'native' | 'adapter';
  readonly phases: readonly RoleplayTurnPhase[];
  /** Runtime state namespaces whose turn-boundary changes belong to this module. */
  readonly stateIds?: readonly string[];
}
/**
 * Complete source-neutral view of the resources participating in one turn.
 * The snapshot is derived from deployment configuration plus the Session log;
 * it is never a second mutable source of truth.
 */
interface RoleplayRuntimeSnapshot {
  readonly format: 0;
  readonly lifecycle: typeof ROLEPLAY_TURN_PHASES;
  readonly experience: RoleplayExperienceRef;
  readonly actor?: RoleplayResourceRef;
  readonly participant?: RoleplayParticipantRef;
  readonly world: {
    readonly bindings: readonly RoleplayWorldBinding[];
    readonly tokenBudget?: number;
  };
  readonly prompt: RoleplayPromptBinding;
  readonly state: readonly RoleplayStateBinding[];
  readonly memory: {
    readonly read: true;
    readonly write: boolean;
  };
  readonly modules: readonly RoleplayModuleBinding[];
}
/** One SillyTavern character-scoped regex retained for display and prompt views. */
interface ImportedRegexScript {
  readonly id?: string;
  readonly scriptName: string;
  readonly findRegex: string;
  readonly replaceString: string;
  readonly trimStrings: readonly string[];
  readonly placement: readonly number[];
  readonly disabled: boolean;
  readonly markdownOnly: boolean;
  readonly promptOnly: boolean;
  readonly runOnEdit: boolean;
  readonly substituteRegex: number;
  readonly minDepth: number | null;
  readonly maxDepth: number | null;
}
/** One Tavern Helper button retained with its owning script. */
interface ImportedTavernHelperButton {
  readonly name: string;
  readonly visible: boolean;
}
/** One flattened Tavern Helper script retained from a card script tree. */
interface ImportedTavernHelperScript {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly info: string;
  /** Effective enablement after applying all parent-folder switches. */
  readonly enabled: boolean;
  readonly buttonEnabled: boolean;
  readonly buttons: readonly ImportedTavernHelperButton[];
  readonly data: Readonly<Record<string, JsonValue>>;
}
/** Non-sensitive Tavern Helper counts shown by reusable-library interfaces. */
interface TavernHelperLibrarySummary {
  readonly format?: 'object' | 'entries';
  readonly scriptCount: number;
  readonly enabledScriptCount: number;
  readonly expectedScriptCount?: number;
  readonly variableCount?: number;
  readonly ignoredFieldCount?: number;
}
/** Source encoding and non-sensitive counts retained from one Tavern Helper extension. */
interface TavernHelperImportSummary extends TavernHelperLibrarySummary {
  readonly format: 'object' | 'entries';
  readonly variableCount: number;
  readonly ignoredFieldCount: number;
}
/** One current or legacy SillyTavern World Info feature retained in raw JSON but not executed. */
declare const WORLD_INFO_IMPORT_DEGRADATIONS: readonly ["entry-advanced-matching", "entry-decorators", "entry-probability", "entry-regex", "entry-unsupported-position", "lorebook-recursion", "timed-effects", "vector-matching"];
/** One SillyTavern World Info feature retained in raw JSON but not executed. */
type WorldInfoImportDegradation = typeof WORLD_INFO_IMPORT_DEGRADATIONS[number];
/** One parsed SillyTavern chat row before conversion to a DSH Session log. */
interface ImportedSillyTavernChatMessage {
  readonly line: number;
  readonly name?: string;
  readonly text: string;
  readonly kind: 'user' | 'assistant' | 'narrator' | 'system';
  readonly swipes: readonly string[];
  readonly swipeId?: number;
  readonly extra?: JsonValue;
  /** Exact parsed message object, including unknown fields. */
  readonly raw: JsonValue;
}
/** Why one normalized lorebook entry did or did not enter the current prompt. */
type LorebookActivationReason = 'active-constant' | 'active-keyword' | 'disabled' | 'deleted' | 'empty-content' | 'compatibility-unsupported' | 'decorator-unsupported' | 'template-unsupported' | 'template-error' | 'regex-runtime-unavailable' | 'regex-invalid' | 'regex-execution-limit' | 'regex-resource-limit' | 'primary-unmatched' | 'secondary-unmatched' | 'budget-excluded' | 'session-budget-excluded';
/** Role assigned to one Prompt Manager entry. */
type SillyTavernPresetRole = 'system' | 'user' | 'assistant';
/** One losslessly ordered Prompt Manager module. */
interface SillyTavernPresetPrompt {
  readonly identifier: string;
  readonly name: string;
  readonly role: SillyTavernPresetRole;
  readonly content: string;
  readonly marker: boolean;
  readonly systemPrompt: boolean;
  readonly forbidOverrides: boolean;
  readonly injectionPosition?: number;
  readonly injectionDepth?: number;
  readonly injectionOrder?: number;
}
/** One module reference in the selected global prompt order. */
interface SillyTavernPresetOrderEntry {
  readonly identifier: string;
  readonly enabled: boolean;
}
/** Generation settings whose original values remain inspectable after import. */
interface SillyTavernPresetGeneration {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly reasoningEffort?: string;
  readonly topP?: number;
  readonly topK?: number;
  readonly topA?: number;
  readonly minP?: number;
  readonly frequencyPenalty?: number;
  readonly presencePenalty?: number;
  readonly repetitionPenalty?: number;
}
/** Preset-owned behavior for continuing the latest assistant reply. */
interface SillyTavernPresetContinuation {
  readonly prefill: boolean;
  readonly postfix: '' | ' ' | '\n' | '\n\n';
  readonly nudgePrompt: string;
}
/** Non-executable extension settings used to explain native coverage accurately. */
interface SillyTavernPresetExtensionCompatibility {
  readonly macroNestEnabled?: boolean;
  readonly chatSquashEnabled?: boolean;
  readonly regexBindingEnabled?: boolean;
  readonly regexBindingMatchesPresetScripts?: boolean;
  readonly tavernHelperScriptCount?: number;
  readonly enabledTavernHelperScriptCount?: number;
  readonly tavernHelperFormat?: TavernHelperImportSummary['format'];
  readonly tavernHelperVariableCount?: number;
  readonly tavernHelperIgnoredFieldCount?: number;
}
/** Normalized executable portion of one Chat Completion preset. */
interface ImportedSillyTavernPreset {
  readonly format: 0;
  readonly name: string;
  readonly prompts: readonly SillyTavernPresetPrompt[];
  readonly order: readonly SillyTavernPresetOrderEntry[];
  readonly generation: SillyTavernPresetGeneration;
  /** Optional for replay compatibility with Agent RP snapshots created before rc.173. */
  readonly continuation?: SillyTavernPresetContinuation;
  readonly formats: {
    readonly worldInfo: string;
    readonly scenario: string;
    readonly personality: string;
  };
  /** Preset-scoped scripts executed before character-scoped scripts. */
  readonly regexScripts: readonly ImportedRegexScript[];
  /** Preset-scoped Tavern Helper scripts executed before character scripts. */
  readonly tavernHelperScripts?: readonly ImportedTavernHelperScript[];
  /** Initial values for the Tavern Helper preset variable namespace. */
  readonly tavernHelperVariables?: Readonly<Record<string, JsonValue>>;
  readonly extensionSummary: {
    readonly regexScriptCount: number;
    readonly hasSPreset: boolean;
    readonly hasTavernHelper: boolean;
  };
  readonly extensionCompatibility?: SillyTavernPresetExtensionCompatibility;
}
/** Provider-neutral role retained by one ordered prompt contribution. */
type RoleplayPromptRole = 'system' | 'user' | 'assistant';
/** One ordered prompt module after adapter expansion. */
interface RoleplayOrderedPrompt {
  readonly role: RoleplayPromptRole;
  readonly content: string;
}
/** Host-compatible prompt split around the conversation history. */
interface RoleplayAssembledPrompt {
  readonly beforeHistory: readonly RoleplayOrderedPrompt[];
  readonly afterHistory: readonly RoleplayOrderedPrompt[];
  readonly inChat: readonly RoleplayInChatPrompt[];
  readonly includeHistory: boolean;
  readonly continuation?: RoleplayContinuationPlan;
  readonly enabledPromptCount: number;
  readonly unsupportedMacroCount: number;
  readonly templateRenderCount: number;
  readonly templateFailureCount: number;
}
/** Prompt fields required by the final LLM message assembly seam. */
type RoleplayProviderPromptPlan = Pick<RoleplayAssembledPrompt, 'beforeHistory' | 'afterHistory' | 'inChat' | 'includeHistory' | 'continuation'>;
/** Expanded continuation behavior retained until the final provider message seam. */
interface RoleplayContinuationPlan {
  readonly prefill: boolean;
  readonly postfix: '' | ' ' | '\n' | '\n\n';
  readonly nudgePrompt: string;
}
/** One expanded prompt module placed relative to recent chat messages. */
interface RoleplayInChatPrompt {
  readonly role: RoleplayPromptRole;
  readonly content: string;
  readonly depth: number;
  readonly order: number;
}
interface FileAttachmentRef {
  readonly kind: 'file';
  readonly attachmentId: ImageAttachmentRef['attachmentId'];
  readonly bytes: number;
  readonly name: string;
  readonly mediaType?: string;
}
/** Durable import metadata that points back to the original JSONL attachment. */
interface SillyTavernChatImportRecord {
  readonly format: 0;
  readonly source: {
    readonly attachmentConsumer: 'dsh-agent-rp';
    readonly attachments: readonly [FileAttachmentRef];
  };
  readonly header: JsonValue;
  readonly messages: readonly {
    readonly line: number;
    readonly kind: ImportedSillyTavernChatMessage['kind'];
    readonly name?: string;
    readonly swipes: readonly string[];
    readonly swipeId?: number;
    readonly extra?: JsonValue;
  }[];
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable SillyTavern provenance; the original file remains authoritative. */
    'agent-rp/sillytavern-chat-import': SillyTavernChatImportRecord;
  }
}
/**
 * Read the latest usable character identity attached to an imported chat Session.
 * @param events - current Session history.
 * @returns imported character and optional user names, when the chat header names a character.
 */
/** Model-facing canonical value for one completed World Info import. */
interface WorldInfoImportResult {
  readonly version: 0;
  readonly name: string;
  readonly sourceEventSeq: number;
  readonly sourceAttachmentId: string;
  readonly entryCount: number;
  readonly degradations: WorldInfoImportDegradation[];
}
/** Replayable presentation metadata carrying the lossless World Info JSON. */
interface WorldInfoImportMeta {
  readonly format: 0;
  readonly result: WorldInfoImportResult;
  readonly raw: JsonValue;
}
/** Durable model-free activation of one Host-owned World Info source. */
interface WorldInfoLibrarySeedRecord {
  readonly format: 0;
  readonly worldInfoLibraryId: string;
  readonly placement: 'actor' | 'experience';
  readonly purpose: 'character-binding' | 'selected' | 'scenario';
  readonly meta: WorldInfoImportMeta;
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable World Info activation available before the Agent is constructed. */
    'agent-rp/world-info-library-seed': WorldInfoLibrarySeedRecord;
  }
}
/** Parse replayable World Info metadata from a tool or private command result. */
/** Compact result of importing one preset attachment. */
interface PresetImportResult {
  readonly version: 0;
  readonly name: string;
  readonly sourceEventSeq: number;
  readonly sourceAttachmentId: string;
  readonly promptCount: number;
  readonly enabledCount: number;
  readonly regexScriptCount: number;
}
/** Model-free preset activation retained in one forked roleplay Session. */
interface PresetSeedRecord {
  readonly format: 0;
  readonly source: {
    readonly attachmentConsumer: 'dsh-agent-rp';
    readonly attachments: readonly [FileAttachmentRef];
  };
  readonly result: PresetImportResult;
  readonly preset: ImportedSillyTavernPreset;
  readonly libraryId?: string;
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable preset activation whose source attachment remains inspectable. */
    'agent-rp/sillytavern-preset-seed': PresetSeedRecord;
  }
}
/** Find the last successful preset import in one Session. */
/** Semantic state operation shared by legacy MVU blocks and native Agent actions. */
interface MvuStateOperation {
  readonly op: 'replace' | 'delta' | 'insert' | 'remove' | 'move';
  readonly path?: string;
  readonly from?: string;
  readonly to?: string;
  readonly value?: JsonValue;
}
/** Complete MVU state selected for one visible reply version. */
interface MvuStateSnapshot {
  readonly statData: JsonValue;
  readonly updateCount: number;
  readonly lastError?: string;
  /** Causal settlement record for a native Agent state action. */
  readonly source?: {
    readonly kind: 'agent-action';
    readonly turn: number;
    readonly resultEventSeqs: readonly number[];
  };
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** @mode event Complete MVU state selected for the active reply version. */
    'agent-rp/mvu-state': MvuStateSnapshot;
  }
}
/** Read and merge initial `stat_data` from the effective Session worlds. */
/** Stable Host-owned identities for Tavern Helper scripts. */
/** Script-tree namespace that owns one Tavern Helper script. */
type TavernScriptScope = 'global' | 'preset' | 'character';
type TavernMessageAnnotationValue = Readonly<Record<string, JsonValue>>;
/** Host-owned script namespace for one set of SillyTavern message root fields. */
interface TavernMessageAnnotationOwner {
  readonly scriptScope: TavernScriptScope;
  readonly scriptId: string;
}
/** Complete annotation namespace selected for one durable transcript message. */
interface TavernMessageAnnotationRecord {
  readonly format: 0;
  readonly messageSeq: number;
  readonly owner: TavernMessageAnnotationOwner;
  readonly value: TavernMessageAnnotationValue;
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** @mode event Script-owned SillyTavern message root fields bound to one transcript event. */
    'agent-rp/tavern-message-annotation': TavernMessageAnnotationRecord;
  }
}
/** Validate one record recovered from an event or fallback command result. */
/** Tavern Helper variable namespaces supported by the isolated runtime. */
type TavernVariableScope = 'global' | 'preset' | 'character' | 'chat' | 'message' | 'script';
type JsonRecord = Readonly<Record<string, JsonValue>>;
/** One normalized Tavern Helper script retained in a Session-owned script tree. */
interface TavernScript {
  readonly type: 'script';
  readonly enabled: boolean;
  readonly name: string;
  readonly id: string;
  readonly content: string;
  readonly info: string;
  readonly button: {
    readonly enabled: boolean;
    readonly buttons: readonly {
      readonly name: string;
      readonly visible: boolean;
    }[];
  };
  readonly data: JsonRecord;
  readonly export_with: {
    readonly data: boolean;
    readonly button: boolean;
  };
}
/** One normalized Tavern Helper folder containing direct child scripts. */
interface TavernScriptFolder {
  readonly type: 'folder';
  readonly enabled: boolean;
  readonly name: string;
  readonly id: string;
  readonly icon: string;
  readonly color: string;
  readonly scripts: readonly TavernScript[];
}
/** One public Tavern Helper script-tree node. */
type TavernScriptTree = TavernScript | TavernScriptFolder;
/** Script-tree storage scopes exposed by Tavern Helper. */
type TavernScriptTreeScope = TavernScriptScope;
/** JSON-safe Tavern Helper worldbook entry retained in one roleplay Session. */
interface TavernWorldbookEntry {
  readonly uid: number;
  readonly name: string;
  readonly enabled: boolean;
  readonly strategy: {
    readonly type: 'constant' | 'selective' | 'vectorized';
    readonly keys: readonly string[];
    readonly keys_secondary: {
      readonly logic: 'and_any' | 'and_all' | 'not_all' | 'not_any';
      readonly keys: readonly string[];
    };
    readonly scan_depth: 'same_as_global' | number;
  };
  readonly position: {
    readonly type: 'before_character_definition' | 'after_character_definition' | 'before_example_messages' | 'after_example_messages' | 'before_author_note' | 'after_author_note' | 'at_depth' | 'outlet';
    readonly role: 'system' | 'assistant' | 'user';
    readonly depth: number;
    readonly order: number;
  };
  readonly content: string;
  readonly probability: number;
  readonly recursion: {
    readonly prevent_incoming: boolean;
    readonly prevent_outgoing: boolean;
    readonly delay_until: number | null;
  };
  readonly effect: {
    readonly sticky: number | null;
    readonly cooldown: number | null;
    readonly delay: number | null;
  };
  readonly extra?: JsonRecord;
  readonly ignoreBudget?: boolean;
}
/** Explicit Tavern Helper worldbook selections; omitted fields retain imported defaults. */
interface TavernWorldbookBindings {
  readonly global?: readonly string[];
  readonly character?: {
    readonly primary: string | null;
    readonly additional: readonly string[];
  };
  readonly chat?: string | null;
}
/** One hidden prefix message retained for Tavern scripts but removed from model history. */
interface TavernHiddenMessage {
  readonly seq: number;
  readonly role: 'assistant' | 'user';
  readonly text: string;
}
/** Complete durable state written by one Tavern Helper variable mutation. */
interface TavernHelperState {
  readonly format: 0;
  readonly characterSourceId: string;
  readonly presetSourceId?: string;
  readonly presetScriptIds?: readonly string[];
  readonly revision: number;
  readonly scopes: {
    readonly global: JsonRecord;
    readonly preset: JsonRecord;
    readonly character: JsonRecord;
    readonly chat: JsonRecord;
    readonly message: JsonRecord;
  };
  /** Variable objects keyed by the Host-owned combination of script-tree scope and script id. */
  readonly scripts: Readonly<Record<string, JsonRecord>>;
  /** Session-local script-tree replacements; imported source files remain unchanged. */
  readonly scriptTrees?: Readonly<Partial<Record<TavernScriptTreeScope, readonly TavernScriptTree[]>>>;
  /** Script-authored prompts retained for subsequent model requests in this chat. */
  readonly injectedPrompts?: readonly TavernInjectedPrompt[];
  /** Page-level prompts owned by the singleton installed-extension collection. */
  readonly installedExtensionPrompts?: readonly TavernInstalledExtensionPrompt[];
  /** Script-owned, replayable session panels translated from the isolated compatibility DOM. */
  readonly statusPanels?: readonly TavernStatusPanel[];
  /** Contiguous transcript prefix excluded from the Session surface but retained for Tavern APIs. */
  readonly hiddenPrefix?: readonly TavernHiddenMessage[];
  /** Script-authored books and full replacements of imported books, keyed by visible name. */
  readonly worldbooks?: Readonly<Record<string, readonly TavernWorldbookEntry[]>>;
  /** Names deleted by scripts, including immutable imported books hidden by a tombstone. */
  readonly deletedWorldbookNames?: readonly string[];
  readonly worldbookBindings?: TavernWorldbookBindings;
  readonly lastMutation?: {
    readonly scope: TavernVariableScope | 'worldbook' | 'injection' | 'installed-extension-injection' | 'script-tree' | 'presentation';
    readonly scriptScope?: TavernScriptTreeScope;
    readonly scriptId?: string; /** Stable Host identity of the assistant reply whose browser event caused this write. */
    readonly cause?: TavernMutationCause;
  };
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** @mode event Complete Tavern Helper state selected for the active reply version. */
    'agent-rp/tavern-state': TavernHelperState;
    /** Branch-local Tavern Helper state produced for one causal reply, active only when explicitly marked. */
    'agent-rp/tavern-state-attachment': TavernHelperStateAttachment;
  }
}
/** One durable Tavern Helper snapshot and the event that owns it. */
/** Browser-to-Host causal identity for a mutation triggered while presenting one reply. */
interface TavernMutationCause {
  readonly format: 0;
  readonly sessionId: string;
  readonly replySeq: number;
}
/** Full script state attached to one reply without necessarily changing the active branch. */
interface TavernHelperStateAttachment {
  readonly format: 0;
  readonly cause: TavernMutationCause;
  readonly active: boolean;
  readonly state: TavernHelperState;
}
/** One validated model prompt owned by an isolated Tavern Helper script. */
interface TavernInjectedPrompt {
  readonly id: string;
  readonly scriptScope: TavernScriptTreeScope;
  readonly scriptId: string;
  readonly position: 'before' | 'after' | 'in_chat' | 'none';
  readonly depth: number;
  readonly role: 'system' | 'assistant' | 'user';
  readonly content: string;
  readonly shouldScan: boolean;
  readonly once: boolean;
}
/** One global SillyTavern extension prompt without a role-card script owner. */
type TavernInstalledExtensionPrompt = Omit<TavernInjectedPrompt, 'scriptScope' | 'scriptId'>;
/** One bounded status panel slot owned by an authenticated Tavern Helper script. */
interface TavernStatusPanel {
  readonly format: 0;
  readonly owner: {
    readonly scriptScope: TavernScriptTreeScope;
    readonly scriptId: string;
  };
  readonly target: {
    readonly kind: 'session';
  };
  /** Sanitized later at presentation time; null durably records an explicit withdrawal. */
  readonly html: string | null;
}
/** One authoritative state revision written to the Session log. */
interface RoleplayStateRecord {
  readonly format: 0;
  readonly id: string;
  readonly revision: number;
  /** Stable module authority; absent only on records written before ownership was introduced. */
  readonly ownerModuleId?: string;
  /** Module or explicit host action that produced this revision. */
  readonly writerModuleId: string;
  /** Exact `rp-state` command/run event for an explicit player edit. */
  readonly sourceEventSeq?: number;
  readonly value: JsonValue;
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Required native Roleplay state; skipping it would change later model-visible input. */
    'agent-rp/state': RoleplayStateRecord;
  }
}
/** Parse one private player request without accepting implicit authority fields. */
/** Compatibility dialogue preserves author-defined output formats; Agent turns use runtime actions. */
type RoleplayTurnMode = 'conversation' | 'agent';
/** One authoritative turn-mode selection reconstructed from the Session log. */
interface RoleplayTurnModeRecord {
  readonly format: 0;
  readonly mode: RoleplayTurnMode;
  readonly source: 'default' | 'user';
  /** Exact user command that selected this mode. */
  readonly sourceEventSeq?: number;
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Required capability selection that changes later model-visible tools and prompts. */
    'agent-rp/turn-mode': RoleplayTurnModeRecord;
  }
}
/** Parse one private player request without accepting implicit authority fields. */
type NativePromptPolicyLayer = 'frontstage' | 'stage';
/** One independently addressable behavior in a frozen native policy composition. */
interface NativePromptPolicyModule {
  readonly id: string;
  readonly name: string;
  readonly layer: NativePromptPolicyLayer;
  readonly enabled: boolean;
  readonly content: string;
}
/** Exact model-visible native policy frozen into a Session at launch. */
interface NativePromptPolicySnapshot {
  readonly format: 0;
  readonly id: string;
  readonly name: string;
  readonly modules: readonly NativePromptPolicyModule[];
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Skippable snapshot of one Agent RP-owned prompt policy composition. */
    'agent-rp/native-prompt-policy-seed': NativePromptPolicySnapshot;
  }
}
/** Validate a detached native policy without consulting mutable provider state. */
/** Immutable pack content appended by its resource provider. */
interface SessionRegexPackSnapshot {
  readonly format: 0;
  readonly id: string;
  readonly name: string;
  readonly scripts: readonly ImportedRegexScript[];
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ordered global-scope regex rules selected explicitly for this Session. */
    'agent-rp/regex-pack-seed': SessionRegexPackSnapshot;
  }
}
/** Validate one Session-owned pack without consulting the mutable library. */
/** Exact prepared input consumed by one model step in the settled turn. */
interface RoleplayTurnPlanReference {
  readonly step: number;
  readonly input: RoleplayTurnInputKey;
  /** Content-free receipt for replaying and diagnosing the exact prepared plan. */
  readonly receipt?: RoleplayTurnPlanReceipt;
}
/** Durable resource and decision references retained without duplicating model-visible prose. */
interface RoleplayTurnPlanReceipt {
  /** Structural projection used to compute the prepared-plan proofs. */
  readonly preparedPlanSchema?: RoleplayTurnPlanSchema;
  /** Content-free proof that replay rebuilt the complete provider-neutral plan byte-for-byte. */
  readonly preparedPlanSha256?: string;
  /** Per-section proofs used to diagnose drift without retaining model-visible prose twice. */
  readonly preparedPlanSectionsSha256?: Readonly<Partial<Record<keyof RoleplayTurnPlan, string>>>;
  readonly runtime: {
    readonly experienceId: string;
    readonly actorId?: string;
    readonly participantId?: string;
    readonly worldIds: readonly string[];
    readonly promptId?: string;
    readonly stateIds: readonly string[];
    readonly moduleIds: readonly string[]; /** Settle ownership retained so a cold restart can close the turn without volatile plans. */
    readonly settleModules?: readonly {
      readonly moduleId: string;
      readonly stateIds: readonly string[];
    }[]; /** Present participation retained so a cold restart can rebuild the selected surface. */
    readonly presentModuleIds?: readonly string[];
  };
  readonly world: {
    readonly activeEntries: readonly {
      readonly resourceId: string;
      readonly entryIds: readonly string[];
    }[];
    readonly approximateTokens: number;
    readonly tokenBudget?: number;
  };
  readonly promptDiagnostics: RoleplayTurnPlan['prompt']['diagnostics'];
  readonly act?: {
    readonly strategy?: RoleplayTurnPlan['act']['strategy'];
    readonly responseRepairs: readonly {
      readonly engine: RoleplayTurnPlan['act']['responseRepairs'][number]['engine'];
      readonly moduleId: string;
      readonly stateId: string;
    }[];
    readonly stateActions?: RoleplayTurnPlan['act']['stateActions'];
  };
  readonly stateReads: readonly {
    readonly id: string;
    readonly revision?: number;
    readonly eventSeq?: number;
  }[];
  readonly memoryReads: RoleplayTurnPlan['memory']['reads'];
  readonly memoryWriteAvailable?: boolean;
  readonly generation: RoleplayTurnPlan['generation'];
  readonly prepare: RoleplayTurnPlan['prepare'];
  readonly recall?: RoleplayTurnPlan['recall'];
}
/**
 * Published structural projections of the provider-neutral turn plan:
 * 0 predates prompt transforms, 1 adds transforms, 2 adds response repair programs,
 * 3 adds the independent turn strategy plus semantic state actions, 4 adds
 * the exact tool policy prepared for the model request and runtime gates, and
 * 5 moves imported state rules into the post-narrative settlement program.
 */
type RoleplayTurnPlanSchema = 0 | 1 | 2 | 3 | 4 | 5;
/** Revision change observed at the turn boundary for one runtime state namespace. */
interface RoleplayStateSettlement {
  readonly id: string;
  readonly beforeRevision?: number;
  readonly afterRevision?: number;
  readonly outcome: 'created' | 'updated' | 'unchanged' | 'removed' | 'unversioned' | 'failed';
  readonly error?: string;
}
/** Explainable result of one module that participates in the settle phase. */
interface RoleplaySettleModuleOutcome {
  readonly moduleId: string;
  readonly outcome: 'applied' | 'idle' | 'deferred' | 'failed';
  readonly changes: number;
  readonly error?: string;
}
/** One model message emitted while the Agent acted, without retaining its content twice. */
interface RoleplayActAssistantMessageReference {
  readonly eventSeq: number;
  readonly messageId: string;
  readonly interrupted?: true;
}
/** One tool invocation emitted while the Agent acted, without retaining its arguments twice. */
interface RoleplayActToolCallReference {
  readonly eventSeq: number;
  readonly callId: string;
  readonly name: string;
}
/** One tool result emitted while the Agent acted, without retaining its result content twice. */
interface RoleplayActToolResultReference {
  readonly eventSeq: number;
  readonly callId: string;
  readonly outcome: 'succeeded' | 'failed';
}
/** One auxiliary model call dispatched by a prepared act-phase program. */
interface RoleplayActModelCallReference {
  readonly requestEventSeq: number;
  readonly resultEventSeq: number;
  readonly requestId: string;
  readonly purpose: 'response-repair';
  readonly engine: RoleplayTurnPlan['act']['responseRepairs'][number]['engine'];
  readonly moduleId: string;
  readonly stateId: string;
  readonly outcome: 'applied' | 'rejected' | 'failed';
}
/** Ordered Session-log evidence for one prepared model step. */
interface RoleplayActStepReceipt {
  readonly step: number;
  readonly assistantMessages: readonly RoleplayActAssistantMessageReference[];
  readonly modelCalls: readonly RoleplayActModelCallReference[];
  readonly toolCalls: readonly RoleplayActToolCallReference[];
  readonly toolResults: readonly RoleplayActToolResultReference[];
}
/** Replayable summary of state and memory after one complete Roleplay turn. */
interface RoleplayTurnSettlement {
  readonly format: 0;
  readonly sessionId: string;
  readonly turn: number;
  readonly result: string;
  readonly plans: readonly RoleplayTurnPlanReference[];
  readonly reply?: {
    readonly eventSeq: number;
    readonly messageId: string;
  };
  /**
   * Content-free evidence for the act phase. Optional only for settlements
   * written before this receipt was introduced; every current compiler writes it.
   */
  readonly act?: {
    readonly steps: readonly RoleplayActStepReceipt[];
  };
  readonly state: readonly RoleplayStateSettlement[];
  readonly memory: {
    readonly writeAvailable: boolean;
    readonly createdIds: readonly string[]; /** Memory records active before this turn that are no longer active afterward. */
    readonly supersededIds: readonly string[];
    readonly activeCount: number;
  };
  readonly settle: {
    readonly modules: readonly RoleplaySettleModuleOutcome[];
  };
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Informational Roleplay settlement; losing it does not change Session reconstruction. */
    'agent-rp/turn-settlement': RoleplayTurnSettlement;
  }
}
/** A plan bound to the concrete model step that consumed it. */
interface BoundRoleplayTurnPlan {
  readonly step: number;
  readonly plan: RoleplayTurnPlan;
}
/** Model-facing tool that records semantic state work without mutating state mid-turn. */
declare const ROLEPLAY_STATE_ACTION_TOOL = "apply_roleplay_state";
/** Prepared capability contract frozen before one model step. */
interface RoleplayStateActionPlan {
  readonly engine: 'mvu-v0';
  readonly tool: typeof ROLEPLAY_STATE_ACTION_TOOL;
  readonly moduleId: string;
  readonly stateId: string;
  readonly expectedRevision: number;
  readonly operations: readonly MvuStateOperation['op'][];
  /** Adapter rules consulted only by the post-narrative settlement stage. */
  readonly instructions?: string;
}
/** Provider-neutral Agent tool guidance retained across workspace settings and model turns. */
/** Whether image tools must stay idle, may be chosen, or should be attempted each RP turn. */
type AgentRpImageMode = 'never' | 'requested' | 'auto' | 'always';
/** One deployment-owned instruction for an installed MCP or other tool provider. */
interface ToolGuidanceEntryConfig {
  readonly id: string;
  readonly enabled: boolean;
  readonly text: string;
}
/** Normalized settings compatible with Thetail's public tool-guidance format. */
interface ResolvedToolGuidanceConfig {
  readonly enabled: boolean;
  readonly includeFramework: boolean;
  readonly includeAgentRp: boolean;
  readonly imageMode: AgentRpImageMode;
  readonly custom: readonly ToolGuidanceEntryConfig[];
}
/** Immutable tool policy frozen into one concrete Roleplay turn. */
interface RoleplayToolPolicyPlan {
  readonly format: 0;
  /** Exact normalized workspace input needed to replay this policy. */
  readonly source: ResolvedToolGuidanceConfig;
  readonly capability: {
    /** Whether Agent RP's two durable-artifact presentation tools are visible and executable. */readonly artifactPresentation: boolean;
  };
  readonly behavior: {
    readonly image: {
      readonly mode: AgentRpImageMode; /** Runtime publication limit; choosing whether to generate remains an Agent decision. */
      readonly maxPublicationsPerTurn: 0 | 1;
    };
  };
  readonly guidance: {
    readonly includeFramework: boolean;
    readonly customIds: readonly string[]; /** Short model-visible context compiled from the structured policy. */
    readonly contextText: string;
  };
}
/** Exact replay key for the Session surface and newly claimed messages used by preparation. */
interface RoleplayTurnInputKey {
  readonly sessionId: string;
  readonly sessionSeq: number;
  readonly pendingMessageIds: readonly string[];
}
/** Provider-neutral generation preferences selected for this turn. */
interface RoleplayGenerationPolicy {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly reasoningEffort?: string;
  readonly topP?: number;
  readonly topK?: number;
  readonly topA?: number;
  readonly minP?: number;
  readonly frequencyPenalty?: number;
  readonly presencePenalty?: number;
  readonly repetitionPenalty?: number;
}
/** Explainable decision for one entry without retaining its private source text twice. */
interface RoleplayWorldEntryDecision {
  readonly entryId: string;
  readonly index: number;
  readonly active: boolean;
  readonly reason: LorebookActivationReason;
  readonly matchedKeys: readonly string[];
  readonly matchedSecondaryKeys: readonly string[];
  readonly approximateTokens: number;
  readonly template?: 'rendered' | 'source-limit' | 'syntax-error' | 'runtime-error' | 'execution-limit' | 'memory-limit' | 'output-limit' | 'resource-unsupported' | 'resource-limit';
}
/** Activated prompt contributions and diagnostics for one bound world resource. */
interface RoleplayWorldResourcePlan {
  readonly resource: RoleplayWorldBinding;
  readonly beforeActor: readonly string[];
  readonly afterActor: readonly string[];
  readonly entries: readonly RoleplayWorldEntryDecision[];
}
/** World preparation result in semantic experience/actor order. */
interface RoleplayWorldPlan {
  readonly engine: 'native-v0';
  readonly resources: readonly RoleplayWorldResourcePlan[];
  readonly inChat: readonly RoleplayInChatPrompt[];
  readonly experienceBeforeActor: readonly string[];
  readonly actorBefore: readonly string[];
  readonly actorAfter: readonly string[];
  readonly experienceAfterActor: readonly string[];
  readonly approximateTokens: number;
  readonly tokenBudget?: number;
}
/** Content-free phase outcome useful for diagnostics and later orchestration. */
interface RoleplayPhaseModuleOutcome {
  readonly moduleId: string;
  readonly outcome: 'applied' | 'idle' | 'degraded';
  readonly contributions: number;
}
type RoleplayPrepareModuleOutcome = RoleplayPhaseModuleOutcome;
type RoleplayRecallModuleOutcome = RoleplayPhaseModuleOutcome;
/** Logged plugin context that entered one concrete model step without duplicating its content. */
interface RoleplayExternalContextRead {
  readonly eventSeq: number;
  readonly messageId: string;
}
/** Source-neutral ownership of one ordered model-facing text transformation. */
type RoleplayPromptTransformOwner = 'regex' | 'prompt-policy' | 'actor';
/** Normalized regex operation prepared by an input adapter for the native prompt boundary. */
interface RoleplayPromptRegexTransform {
  readonly engine: 'regex-v0';
  readonly owner: RoleplayPromptTransformOwner;
  readonly ownerIndex: number;
  readonly name: string;
  readonly pattern: string;
  readonly replacement: string;
  readonly trim: readonly string[];
  readonly placements: readonly ('user-input' | 'assistant-output')[];
  readonly enabled: boolean;
  readonly phase: 'shared' | 'prompt-only';
  readonly identitySubstitution: 'none' | 'raw' | 'escaped';
  readonly minDepth?: number;
  readonly maxDepth?: number;
}
/** Exact ordered transformation program frozen before one provider request. */
interface RoleplayPromptTransformPlan {
  readonly actorName: string;
  readonly participantName?: string;
  readonly operations: readonly RoleplayPromptRegexTransform[];
}
/** Final prompt plus adapter expansion diagnostics. */
interface RoleplayTurnPromptPlan extends RoleplayProviderPromptPlan {
  readonly systemPromptText: string;
  readonly transforms: RoleplayPromptTransformPlan;
  readonly diagnostics: {
    readonly enabledModules: number;
    readonly unsupportedMacros: number;
    readonly templateFailures: number;
  };
}
/** Adapter-owned response repair prepared before the actor request begins. */
interface RoleplayMvuResponseRepairPlan {
  readonly engine: 'mvu-v0';
  readonly moduleId: string;
  readonly stateId: string;
  readonly updateInstructions?: string;
  readonly choiceInstructions?: string;
}
type RoleplayResponseRepairPlan = RoleplayMvuResponseRepairPlan;
/** Source-neutral act-phase programs frozen for one concrete model step. */
interface RoleplayTurnActPlan {
  readonly strategy: RoleplayTurnMode;
  readonly responseRepairs: readonly RoleplayResponseRepairPlan[];
  readonly stateActions: readonly RoleplayStateActionPlan[];
}
/** Exact state value and log boundary consumed while preparing this turn. */
interface RoleplayStateRead extends RoleplayStateBinding {
  readonly eventSeq?: number;
  readonly writerModuleId?: string;
  readonly value?: JsonValue;
}
/** One durable memory record consulted while preparing this turn. */
interface RoleplayMemoryRead {
  readonly id: string;
  readonly sourceEventSeq: number;
}
/** Exact memory policy, references, and model-visible context compiled for this turn. */
type RoleplayMemoryPlan = RoleplayRuntimeSnapshot['memory'] & {
  readonly reads: readonly RoleplayMemoryRead[];
  readonly contextText: string;
};
/** Immutable result of the prepare phase, with no renderer or source-format object in its public contract. */
interface RoleplayTurnPlan {
  readonly format: 0;
  readonly input: RoleplayTurnInputKey;
  readonly runtime: RoleplayRuntimeSnapshot;
  readonly world: RoleplayWorldPlan;
  readonly prompt: RoleplayTurnPromptPlan;
  readonly act: RoleplayTurnActPlan;
  readonly tools: RoleplayToolPolicyPlan;
  readonly stateReads: readonly RoleplayStateRead[];
  readonly memory: RoleplayMemoryPlan;
  readonly generation: RoleplayGenerationPolicy;
  readonly prepare: {
    readonly modules: readonly RoleplayPrepareModuleOutcome[];
  };
  readonly recall: {
    readonly modules: readonly RoleplayRecallModuleOutcome[];
    readonly contextReads?: readonly RoleplayExternalContextRead[];
  };
}
/** Host service shared by Agent RP profiles and trusted runtime plugins. */
declare const ROLEPLAY_RUNTIME_EXTENSIONS_KEY = "agentRp.runtimeExtensions";
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Trusted Host plugins can join the source-neutral Agent RP turn runtime here. */
    'agentRp.runtimeExtensions': RoleplayRuntimeExtensionRegistry;
  }
}
/** The only mutable input surface available to an extension is the durable Session log. */
interface RoleplayRuntimeExtensionResolveInput {
  readonly events: readonly SessionEvent[];
}
/** Session-derived bindings owned by one active extension module. */
interface RoleplayRuntimeExtensionResolution {
  readonly world?: readonly RoleplayWorldBinding[];
  readonly state?: readonly RoleplayStateBinding[];
  /** Existing state namespaces also observed or settled by this module. */
  readonly stateIds?: readonly string[];
  /** Content-free outcomes for the preparation phases declared by this module. */
  readonly outcomes?: {
    readonly prepare?: Omit<RoleplayPhaseModuleOutcome, 'moduleId'>;
    readonly recall?: Omit<RoleplayPhaseModuleOutcome, 'moduleId'>;
  };
}
/** One trusted Host plugin's stable runtime declaration. */
interface RoleplayRuntimeExtensionDefinition {
  readonly module: Omit<RoleplayModuleBinding, 'stateIds'>;
  /** Return undefined when the module does not participate in this Session. */
  resolve(input: RoleplayRuntimeExtensionResolveInput): RoleplayRuntimeExtensionResolution | undefined;
}
/** Immutable bindings merged into a source-neutral Roleplay runtime snapshot. */
interface ResolvedRoleplayRuntimeExtensions {
  readonly modules: readonly RoleplayModuleBinding[];
  readonly world: readonly RoleplayWorldBinding[];
  readonly state: readonly RoleplayStateBinding[];
  readonly prepare: readonly RoleplayPhaseModuleOutcome[];
  readonly recall: readonly RoleplayPhaseModuleOutcome[];
}
/**
 * Registry of trusted, synchronous Session-log resolvers.
 * Registration order never affects a turn: active modules are resolved by stable id.
 */
declare class RoleplayRuntimeExtensionRegistry {
  #private;
  /** Register one module and return its stale-disposer-safe revocation. */
  register(definition: RoleplayRuntimeExtensionDefinition): () => void;
  /** Resolve every active module from one immutable Session-log boundary. */
  resolve(events: readonly SessionEvent[]): ResolvedRoleplayRuntimeExtensions;
}
/** Register through the caller's Cordis scope so plugin unload always revokes the module. */
declare function registerRoleplayRuntimeExtension(ctx: Context, definition: RoleplayRuntimeExtensionDefinition): void;
/** Host service shared by Agent RP profiles and trusted Worker plugins. */
declare const ROLEPLAY_TURN_WORKERS_KEY = "agentRp.turnWorkers";
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Trusted Host plugins can register bounded post-narrative Workers here. */
    'agentRp.turnWorkers': RoleplayTurnWorkerRegistry;
  }
}
/** Ordered phases after the character Agent has committed its visible narrative. */
type RoleplayTurnWorkerPhase = 'review' | 'settle';
/** Stable terminal outcome returned by one independent Worker. */
interface RoleplayTurnWorkerOutcome {
  readonly outcome: 'applied' | 'unchanged' | 'skipped' | 'failed';
  readonly requestEventSeq?: number;
  readonly resultEventSeq?: number;
}
/** Content-free diagnostic for one Worker execution. */
interface RoleplayTurnWorkerResultRecord extends RoleplayTurnWorkerOutcome {
  readonly format: 0;
  readonly sessionId: string;
  readonly turn: number;
  readonly step: number;
  readonly workerId: string;
  readonly phase: RoleplayTurnWorkerPhase;
}
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Ignorable content-free result from one deterministic post-narrative Worker. */
    'agent-rp/turn-worker-result': RoleplayTurnWorkerResultRecord;
  }
}
/** Runtime inputs shared by every Worker in one closed Agent step. */
interface RoleplayTurnWorkerInput {
  readonly ctx: Context;
  readonly agent: Agent;
  readonly turn: number;
  readonly plan: BoundRoleplayTurnPlan;
  readonly signal: AbortSignal;
}
/** One independently registered responsibility in the post-narrative pipeline. */
interface RoleplayTurnWorker {
  readonly id: string;
  readonly phase: RoleplayTurnWorkerPhase;
  readonly order?: number;
  run(input: RoleplayTurnWorkerInput): Promise<RoleplayTurnWorkerOutcome>;
}
/** Registry and serial executor for bounded post-narrative Workers. */
declare class RoleplayTurnWorkerRegistry {
  #private;
  /** Register one stable Worker id and return its disposer. */
  register(worker: RoleplayTurnWorker): () => void;
  /** Run every registered Worker serially in review-before-settle order. */
  run(input: RoleplayTurnWorkerInput): Promise<readonly RoleplayTurnWorkerResultRecord[]>;
}
/** Register one trusted Host Worker through the versioned Agent RP extension service. */
declare function registerRoleplayTurnWorker(ctx: Context, worker: RoleplayTurnWorker): void;
declare const ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY = "agentRp.actorRevisions";
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Writable actor providers available to the current Agent RP profile. */
    'agentRp.actorRevisions': RoleplayActorRevisionRegistry;
  }
}
declare const ROLEPLAY_ACTOR_DEFINITION_FIELDS: readonly ["name", "description", "personality", "scenario", "exampleDialogue", "openings"];
type RoleplayActorDefinitionField = typeof ROLEPLAY_ACTOR_DEFINITION_FIELDS[number];
/** Editable actor definition independent from any Character Card transport. */
interface RoleplayActorDefinition {
  readonly name: string;
  readonly description: string;
  readonly personality: string;
  readonly scenario: string;
  readonly exampleDialogue: string;
  /** Default opening first, followed by optional alternatives. */
  readonly openings: readonly string[];
}
type RoleplayActorTextField = Exclude<RoleplayActorDefinitionField, 'openings'>;
interface RoleplayActorTextChange {
  readonly before: string;
  readonly after: string;
}
interface RoleplayActorOpeningsChange {
  readonly before: readonly string[];
  readonly after: readonly string[];
}
/** Exact before/after values proposed by the model; omitted fields stay untouched. */
type RoleplayActorRevisionChanges = { readonly [Field in RoleplayActorTextField]?: RoleplayActorTextChange } & {
  readonly openings?: RoleplayActorOpeningsChange;
};
/** Current provider-owned actor value and its opaque optimistic revision token. */
interface RoleplayActorRevisionSnapshot {
  readonly actor: {
    readonly kind: 'actor';
    readonly id: RoleplayResourceReference['id'];
  };
  readonly revision: string;
  readonly definition: RoleplayActorDefinition;
}
interface RoleplayActorRevisionInput {
  readonly actor: {
    readonly kind: 'actor';
    readonly id: string;
  };
  readonly expectedRevision: string;
  readonly changes: RoleplayActorRevisionChanges;
}
interface RoleplayActorRevisionProvider {
  readonly id: string;
  /** Return undefined only when this provider does not own the reference. */
  inspect(actor: {
    readonly kind: 'actor';
    readonly id: string;
  }): RoleplayActorRevisionSnapshot | undefined;
  /** Apply atomically against expectedRevision or throw RoleplayActorRevisionConflictError. */
  revise(input: RoleplayActorRevisionInput): RoleplayActorRevisionSnapshot;
}
declare class RoleplayActorRevisionConflictError extends Error {
  readonly current: RoleplayActorRevisionSnapshot;
  constructor(current: RoleplayActorRevisionSnapshot);
}
/** Mutable provider directory; resource formats retain their own storage and export policy. */
declare class RoleplayActorRevisionRegistry {
  #private;
  register(provider: RoleplayActorRevisionProvider): () => void;
  inspect(actor: {
    readonly kind: 'actor';
    readonly id: string;
  }): RoleplayActorRevisionSnapshot;
  revise(input: RoleplayActorRevisionInput): {
    readonly outcome: 'applied';
    readonly value: RoleplayActorRevisionSnapshot;
  } | {
    readonly outcome: 'conflict';
    readonly value: RoleplayActorRevisionSnapshot;
  };
}
/** Register one writable actor provider through the caller's owned Cordis lifetime. */
declare function registerRoleplayActorRevisionProvider(ctx: Context, provider: RoleplayActorRevisionProvider): void;
/** Script source selected for one future roleplay Session. */
type TavernPreflightScope = 'character' | 'preset';
/** One immutable script collection selected for a future Session. */
interface TavernPreflightSource {
  readonly scope: TavernPreflightScope;
  readonly ownerId: string;
  readonly scripts: readonly ImportedTavernHelperScript[];
}
/** Host service used by trusted input adapters without coupling the resource catalog to Tavern. */
declare const TAVERN_RESOURCE_PREFLIGHT_KEY = "agentRp.tavernResourcePreflight";
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Trusted adapters can describe static Tavern scripts owned by their Roleplay resources. */
    'agentRp.tavernResourcePreflight': TavernResourcePreflightRegistry;
  }
}
/** Immutable provider-owned selection metadata passed to one Tavern adapter. */
interface TavernResourcePreflightResolveInput {
  readonly selection: RoleplayResourceSelection;
  readonly descriptor: RoleplayResourceDescriptor;
}
/** One resource provider's optional Tavern compatibility contribution. */
interface TavernResourcePreflightContributor {
  readonly providerId: string;
  resolve(input: TavernResourcePreflightResolveInput): TavernPreflightSource | undefined;
}
/** Deterministic provider dispatcher kept separate from the source-neutral resource catalog. */
declare class TavernResourcePreflightRegistry {
  #private;
  /** Register one provider adapter and return a stale-disposer-safe revocation. */
  register(contributor: TavernResourcePreflightContributor): () => void;
  /** Resolve selected resources by exact catalog ownership without knowing provider-specific ids. */
  resolve(catalog: RoleplayResourceCatalog, selections: readonly RoleplayResourceSelection[]): readonly TavernPreflightSource[];
}
/** Register through the caller's Cordis scope so plugin unload revokes its adapter. */
declare function registerTavernResourcePreflightContributor(ctx: Context, contributor: TavernResourcePreflightContributor): void;
declare const TOOL_ARTIFACT_PRESENTATION_FORMAT = "dsh.tool-artifacts";
declare const ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT = "agent-rp.artifact-stage-intent";
/** One provider-neutral image persisted by DSH rather than embedded in model history. */
interface RoleplayToolImageArtifact {
  readonly type: 'image';
  readonly attachment: ImageAttachmentRef;
}
/** The DSH-owned replay envelope currently emitted in `tool/result.data.meta`. */
interface ToolArtifactPresentationMeta {
  readonly format: typeof TOOL_ARTIFACT_PRESENTATION_FORMAT;
  readonly version: 0;
  readonly artifacts: readonly RoleplayToolImageArtifact[];
  readonly data?: JsonValue;
}
/** Tool-owned data inside the canonical DSH artifact envelope that requests immediate RP staging. */
interface RoleplayArtifactAutoStageIntent {
  readonly format: typeof ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT;
  readonly version: 0;
  readonly sourceResultSeq?: number;
  readonly caption?: string;
}
/** Read the DSH artifact envelope without depending on a not-yet-published package export. */
declare function readToolArtifactPresentationMeta(value: JsonValue | undefined): ToolArtifactPresentationMeta | undefined;
/** Create the canonical DSH artifact envelope consumed by Agent RP and other capable clients. */
declare function roleplayToolArtifactPresentationMeta(artifacts: readonly RoleplayToolImageArtifact[], data?: JsonValue): JsonValue;
/** Parse producer-owned automatic stage intent without trusting arbitrary tool metadata. */
declare function readRoleplayArtifactAutoStageIntent(value: JsonValue | undefined): RoleplayArtifactAutoStageIntent | undefined;
/** Versioned public contract for independent DSH plugins extending Agent RP. */
/** The API version encoded by the `@dsh-external/dsh-agent-rp/extension/v0` export. */
declare const AGENT_RP_EXTENSION_API_VERSION: 0;
export { AGENT_RP_EXTENSION_API_VERSION, ROLEPLAY_ACTOR_DEFINITION_FIELDS, ROLEPLAY_ACTOR_REVISION_REGISTRY_KEY, ROLEPLAY_ARTIFACT_AUTO_STAGE_FORMAT, ROLEPLAY_RESOURCE_CATALOG_KEY, ROLEPLAY_RESOURCE_KINDS, ROLEPLAY_RUNTIME_EXTENSIONS_KEY, ROLEPLAY_TURN_WORKERS_KEY, type RoleplayActorDefinition, type RoleplayActorDefinitionField, type RoleplayActorRevisionChanges, RoleplayActorRevisionConflictError, type RoleplayActorRevisionInput, type RoleplayActorRevisionProvider, type RoleplayActorRevisionSnapshot, type RoleplayArtifactAutoStageIntent, type RoleplayResourceDescriptor, type RoleplayResourceDetail, type RoleplayResourceKind, type RoleplayResourceMaterialization, type RoleplayResourceMaterializationContext, type RoleplayResourceMaterializationInput, type RoleplayResourceProvider, type RoleplayResourceReference, type RoleplayResourceSelection, type RoleplayRuntimeExtensionDefinition, type RoleplayRuntimeExtensionResolution, type RoleplayRuntimeExtensionResolveInput, type RoleplayToolImageArtifact, type RoleplayTurnWorker, type RoleplayTurnWorkerInput, type RoleplayTurnWorkerOutcome, type RoleplayTurnWorkerPhase, TAVERN_RESOURCE_PREFLIGHT_KEY, TOOL_ARTIFACT_PRESENTATION_FORMAT, type TavernResourcePreflightContributor, type TavernResourcePreflightResolveInput, type ToolArtifactPresentationMeta, readRoleplayArtifactAutoStageIntent, readToolArtifactPresentationMeta, registerRoleplayActorRevisionProvider, registerRoleplayResourceProvider, registerRoleplayRuntimeExtension, registerRoleplayTurnWorker, registerTavernResourcePreflightContributor, roleplayToolArtifactPresentationMeta };