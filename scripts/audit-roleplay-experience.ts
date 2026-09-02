/** Content-free audit of source-neutral resource materialization into a Session log. */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { CharacterLibrary } from '../src/character-library.ts'
import { resolveConfig } from '../src/config.ts'
import { parseSillyTavernPresetBytes } from '../src/import/sillytavern-preset.ts'
import { PersonaLibrary } from '../src/persona-library.ts'
import { PresetLibrary } from '../src/preset-library.ts'
import { prepareRoleplayExperienceSession } from '../src/roleplay-experience-materialization.ts'
import { readRoleplayExperienceSelection } from '../src/roleplay-experience-selection.ts'
import { RoleplayResourceCatalog } from '../src/roleplay-resource-catalog.ts'
import {
  characterLibraryRoleplayResourceId,
  presetLibraryRoleplayResourceId,
  roleplayLibraryResourceProviders,
  worldInfoLibraryRoleplayResourceId,
} from '../src/roleplay-resource-library-providers.ts'
import { resolveSessionRoleplayRuntime } from '../src/session-roleplay-runtime.ts'
import { WorldInfoLibrary } from '../src/world-info-library.ts'
import { sessionEvents } from '../src/session-events.ts'

export interface RoleplayExperienceAuditInput {
  readonly cardPath: string
  readonly presetPath: string
  readonly worldInfoPath: string
}

export interface RoleplayExperienceAuditResult {
  readonly audit: 'roleplay-experience-materialization-v1'
  readonly ok: true
  readonly assets: {
    readonly cardBytes: number
    readonly presetBytes: number
    readonly worldInfoBytes: number
  }
  readonly catalog: {
    readonly entries: number
    readonly kinds: Readonly<Record<string, number>>
    readonly actorOpenings: number
    readonly personaDescriptionChars: number
    readonly worldEntries: number
    readonly promptModules: number
    readonly enabledPromptModules: number
  }
  readonly session: {
    readonly events: number
    readonly selectionRecorded: boolean
    readonly replayExact: boolean
    readonly actorReferenceExact: boolean
    readonly participantReferenceExact: boolean
    readonly worldReferenceExact: boolean
    readonly promptPolicyReferenceExact: boolean
  }
}

function mediaType(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.charx') return 'application/zip'
  return 'application/json'
}

function counts(values: readonly { readonly kind: string }[]): Readonly<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const value of values) result[value.kind] = (result[value.kind] ?? 0) + 1
  return result
}

/** Import three real assets, select four independent resources, and prove cold replay. */
export function auditRoleplayExperience(input: RoleplayExperienceAuditInput): RoleplayExperienceAuditResult {
  const root = mkdtempSync(join(tmpdir(), 'agent-rp-experience-audit-'))
  try {
    const cardBytes = new Uint8Array(readFileSync(input.cardPath))
    const presetBytes = new Uint8Array(readFileSync(input.presetPath))
    const worldInfoBytes = new Uint8Array(readFileSync(input.worldInfoPath))
    const characters = new CharacterLibrary({ root: join(root, 'characters') })
    const personas = new PersonaLibrary({ root: join(root, 'personas') })
    const presets = new PresetLibrary({ root: join(root, 'presets') })
    const worldInfos = new WorldInfoLibrary({ root: join(root, 'worlds') })
    const actor = characters.importFile({
      data: cardBytes,
      filename: basename(input.cardPath),
      mediaType: mediaType(input.cardPath),
    })
    const participant = personas.save({
      format: 0,
      name: 'Audit User',
      description: 'Local model-free audit participant.',
    })
    const promptPolicy = presets.import(
      parseSillyTavernPresetBytes(presetBytes, basename(input.presetPath)),
    )
    const world = worldInfos.importFile({
      data: worldInfoBytes,
      filename: basename(input.worldInfoPath),
    })
    const catalog = new RoleplayResourceCatalog()
    for (const provider of roleplayLibraryResourceProviders({ characters, personas, presets, worldInfos })) {
      catalog.register(provider)
    }
    const actorId = characterLibraryRoleplayResourceId(actor.id)
    const worldId = worldInfoLibraryRoleplayResourceId(world.id)
    const promptPolicyId = presetLibraryRoleplayResourceId(promptPolicy.id)
    const prepared = prepareRoleplayExperienceSession(catalog, {
      mode: 'character',
      actor: { kind: 'actor', id: actorId, variant: 'greeting:0' },
      participant: { kind: 'persona', id: participant.id },
      worlds: [{ kind: 'world', id: worldId }],
      promptPolicy: { kind: 'prompt-policy', id: promptPolicyId },
    })
    const first = Session.create(SessionId('agent-rp-experience-audit-first'), prepared.seed)
    const reopened = Session.create(SessionId('agent-rp-experience-audit-reopened'), structuredClone(sessionEvents(first)))
    const runtime = resolveSessionRoleplayRuntime({
      session: reopened,
      deployment: resolveConfig({ characterName: 'Audit Actor' }),
    }).snapshot
    const selection = readRoleplayExperienceSelection(sessionEvents(reopened))
    const entries = catalog.list()
    const actorDetail = catalog.inspect('actor', actorId)
    const participantDetail = catalog.inspect('persona', participant.id)
    const worldDetail = catalog.inspect('world', worldId)
    const promptPolicyDetail = catalog.inspect('prompt-policy', promptPolicyId)
    if (actorDetail.kind !== 'actor' || participantDetail.kind !== 'persona'
      || worldDetail.kind !== 'world' || promptPolicyDetail.kind !== 'prompt-policy') {
      throw new Error('Roleplay experience audit resource detail kinds do not match')
    }
    return {
      audit: 'roleplay-experience-materialization-v1',
      ok: true,
      assets: {
        cardBytes: cardBytes.byteLength,
        presetBytes: presetBytes.byteLength,
        worldInfoBytes: worldInfoBytes.byteLength,
      },
      catalog: {
        entries: entries.length,
        kinds: counts(entries),
        actorOpenings: actorDetail.openings.length,
        personaDescriptionChars: participantDetail.description.length,
        worldEntries: worldDetail.entryCount,
        promptModules: promptPolicyDetail.moduleCount,
        enabledPromptModules: promptPolicyDetail.enabledModuleCount,
      },
      session: {
        events: sessionEvents(reopened).length,
        selectionRecorded: selection !== undefined,
        replayExact: JSON.stringify(sessionEvents(first)) === JSON.stringify(sessionEvents(reopened)),
        actorReferenceExact: runtime.actor?.id === actorId && runtime.experience.id === actorId,
        participantReferenceExact: runtime.participant?.id === participant.id,
        worldReferenceExact: runtime.world.bindings.some(binding => binding.id === worldId),
        promptPolicyReferenceExact: runtime.prompt.resource?.id === promptPolicyId,
      },
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function requiredOption(args: readonly string[], name: string): string {
  const index = args.indexOf(name)
  const value = index < 0 ? undefined : args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing required option ${name}`)
  return resolve(value)
}

function main(): void {
  const args = process.argv.slice(2)
  const result = auditRoleplayExperience({
    cardPath: requiredOption(args, '--card'),
    presetPath: requiredOption(args, '--preset'),
    worldInfoPath: requiredOption(args, '--world-info'),
  })
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
}

const entry = process.argv[1]
if (entry !== undefined && basename(entry).startsWith('audit-roleplay-experience.')
  && pathToFileURL(resolve(entry)).href === import.meta.url) {
  try {
    main()
  } catch {
    process.stderr.write(`${JSON.stringify({ audit: 'roleplay-experience-materialization-v1', ok: false })}\n`)
    process.exitCode = 1
  }
}
