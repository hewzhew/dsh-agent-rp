/** Built-in library adapters for the source-neutral Roleplay resource catalog. */

import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { CharacterLibrary } from './character-library.ts'
import { createCharacterCardSessionSeed } from './import/character-card-seed.ts'
import { readActiveSessionCharacter, type FileAttachmentRef } from './import/session-character.ts'
import { createPresetSessionSeed } from './import/session-preset.ts'
import { readActiveSessionWorldInfos } from './import/session-world-info.ts'
import { appendCharacterWorldSessionSeed, appendWorldInfoLibrarySessionSeed } from './import/world-info-seed.ts'
import type { PersonaLibrary } from './persona-library.ts'
import type { PresetLibrary, PresetLibraryEntry } from './preset-library.ts'
import type { RegexPackLibrary } from './regex-pack-library.ts'
import { renderImportedCharacterPrompt, substituteCardMacros } from './prompt.ts'
import type {
  RoleplayResourceMaterializationInput,
  RoleplayResourceProvider,
} from './roleplay-resource-catalog.ts'
import type { RoleplayResourceDescriptor } from './roleplay-resource-catalog-protocol.ts'
import {
  CHARACTER_LIBRARY_ROLEPLAY_PROVIDER_ID,
  PERSONA_LIBRARY_ROLEPLAY_PROVIDER_ID,
  PRESET_LIBRARY_ROLEPLAY_PROVIDER_ID,
  REGEX_PACK_LIBRARY_ROLEPLAY_PROVIDER_ID,
  WORLD_INFO_LIBRARY_ROLEPLAY_PROVIDER_ID,
  characterLibraryRoleplayResourceId,
  presetLibraryRoleplayResourceId,
  regexPackLibraryRoleplayResourceId,
  worldInfoLibraryRoleplayResourceId,
} from './roleplay-resource-library-ids.ts'
import { appendSessionRegexPack } from './session-regex-pack.ts'
import type {} from './session-persona.ts'
import type { WorldInfoLibrary } from './world-info-library.ts'

export {
  characterLibraryRoleplayResourceId,
  presetLibraryRoleplayResourceId,
  regexPackLibraryRoleplayResourceId,
  worldInfoLibraryRoleplayResourceId,
} from './roleplay-resource-library-ids.ts'

function available(
  value: Omit<RoleplayResourceDescriptor, 'availability'>,
): RoleplayResourceDescriptor {
  return { ...value, availability: 'available' }
}

function boundedPreview(value: string): { readonly preview: string; readonly truncated: boolean } {
  return { preview: value.slice(0, 2000), truncated: value.length > 2000 }
}

function libraryId(resourceId: string, prefix: string): string {
  if (!resourceId.startsWith(prefix) || resourceId.length === prefix.length) {
    throw new Error(`资源引用 ${JSON.stringify(resourceId)} 不属于当前资源库`)
  }
  return resourceId.slice(prefix.length)
}

function noVariant(input: RoleplayResourceMaterializationInput): void {
  if (input.selection.variant !== undefined) {
    throw new Error(`${input.descriptor.name} 不支持资源变体 ${JSON.stringify(input.selection.variant)}`)
  }
}

function greetingIndex(input: RoleplayResourceMaterializationInput): number {
  if (input.selection.variant === undefined) return 0
  const match = /^greeting:(0|[1-9][0-9]{0,5})$/u.exec(input.selection.variant)
  if (match === null) throw new Error('角色开场变体必须使用 greeting:<序号>')
  return Number(match[1])
}

function characterAttachment(
  characterId: string,
  transport: 'png' | 'json' | 'charx',
  bytes: number,
  originalFilename: string,
  mediaType: string,
): FileAttachmentRef {
  const extension = transport === 'png' ? 'png' : transport === 'charx' ? 'charx' : 'json'
  return {
    kind: 'file',
    attachmentId: AttachmentId(`library:${characterId}`),
    bytes,
    name: new RegExp(`\\.${extension}$`, 'iu').test(originalFilename)
      ? originalFilename
      : `character.${extension}`,
    mediaType,
  }
}

function presetAttachment(entry: PresetLibraryEntry): FileAttachmentRef {
  return {
    kind: 'file',
    attachmentId: AttachmentId(`library:${entry.id}`),
    bytes: Buffer.byteLength(JSON.stringify(entry.preset), 'utf8'),
    name: 'preset.json',
    mediaType: 'application/json',
  }
}

/** Publish the four current Host libraries without exposing any imported payload. */
export function roleplayLibraryResourceProviders(libraries: {
  readonly characters: CharacterLibrary
  readonly personas: PersonaLibrary
  readonly presets: PresetLibrary
  readonly regexPacks?: RegexPackLibrary
  readonly worldInfos: WorldInfoLibrary
}): readonly RoleplayResourceProvider[] {
  const regexPacks = libraries.regexPacks
  const regexProvider: RoleplayResourceProvider | undefined = regexPacks === undefined ? undefined : {
    id: REGEX_PACK_LIBRARY_ROLEPLAY_PROVIDER_ID,
    list: () => regexPacks.list().map(entry => available({
      id: regexPackLibraryRoleplayResourceId(entry.id),
      kind: 'regex',
      name: entry.name,
      updatedAt: entry.updatedAt,
    })),
    inspect: descriptor => {
      const pack = regexPacks.get(libraryId(descriptor.id, 'regex:library:'))
      return {
        kind: 'regex',
        scriptCount: pack.scriptCount,
        enabledCount: pack.enabledCount,
        displayCount: pack.displayCount,
        promptCount: pack.promptCount,
      }
    },
    materialize: input => {
      noVariant(input)
      const pack = regexPacks.get(libraryId(input.selection.id, 'regex:library:'))
      return {
        events: appendSessionRegexPack(input.events, {
          format: 0,
          id: pack.id,
          name: pack.name,
          scripts: pack.scripts,
        }),
      }
    },
  }
  return [{
    id: CHARACTER_LIBRARY_ROLEPLAY_PROVIDER_ID,
    list: () => [
      ...libraries.characters.list('active'),
      ...libraries.characters.list('archived'),
    ].map(entry => ({
      id: characterLibraryRoleplayResourceId(entry.id),
      kind: 'actor' as const,
      name: entry.displayName,
      availability: entry.archived ? 'archived' as const : 'available' as const,
      updatedAt: entry.updatedAt,
    })),
    inspect: descriptor => {
      const resolved = libraries.characters.resolve(libraryId(descriptor.id, 'character:library:'))
      return {
        kind: 'actor',
        openings: resolved.detail.greetings.slice(0, 1024).map((greeting, index) => ({
          id: `greeting:${index}`,
          label: index === 0 ? '默认开场' : `备选开场 ${index}`,
          ...boundedPreview(resolved.detail.renderedGreetings[index] ?? greeting),
        })),
      }
    },
    materialize: input => {
      if (input.events.length !== 0) throw new Error('角色资源必须是体验中的第一个日志快照')
      const id = libraryId(input.selection.id, 'character:library:')
      const resolved = libraries.characters.resolve(id)
      if (resolved.detail.archived) throw new Error('请先恢复这个角色，再开始体验')
      const index = greetingIndex(input)
      const greeting = resolved.detail.greetings[index]
      if (greeting === undefined) throw new Error(`角色卡没有第 ${index + 1} 条开场白`)
      const source = characterAttachment(
        id,
        resolved.transport.transport,
        resolved.source.bytes,
        resolved.source.originalFilename,
        resolved.source.mediaType,
      )
      const characterEvents = createCharacterCardSessionSeed(
        resolved.card,
        source,
        index,
        substituteCardMacros(greeting, resolved.card, input.context.participantName).trim(),
        resolved.transport,
        input.context.participantName,
        undefined,
        id,
      )
      return {
        events: appendCharacterWorldSessionSeed(characterEvents, resolved.worldBinding, libraries.worldInfos),
        title: resolved.detail.displayName,
      }
    },
    projectActor: (selection, descriptor) => {
      if (selection.variant !== undefined) throw new Error('故事人物绑定暂不使用角色开场变体')
      const resolved = libraries.characters.resolve(libraryId(descriptor.id, 'character:library:'))
      if (resolved.detail.archived) throw new Error('请先恢复这个角色，再绑定人物')
      return {
        name: resolved.detail.displayName,
        persona: renderImportedCharacterPrompt(resolved.card, [], []),
      }
    },
  }, {
    id: PERSONA_LIBRARY_ROLEPLAY_PROVIDER_ID,
    list: () => libraries.personas.list().map(entry => available({
      id: entry.id,
      kind: 'persona',
      name: entry.name,
      updatedAt: entry.updatedAt,
    })),
    inspect: descriptor => ({
      kind: 'persona',
      description: libraries.personas.get(descriptor.id).description,
    }),
    materialize: input => {
      noVariant(input)
      const persona = libraries.personas.get(input.selection.id)
      return {
        events: [...structuredClone(input.events), {
          type: 'agent-rp/persona-seed' as const,
          seq: input.events.length,
          time: Date.now(),
          data: {
            format: 0 as const,
            persona: { id: persona.id, name: persona.name, description: persona.description },
          },
          ignorable: true,
        }],
      }
    },
  }, {
    id: PRESET_LIBRARY_ROLEPLAY_PROVIDER_ID,
    list: () => libraries.presets.list().map(entry => available({
      id: presetLibraryRoleplayResourceId(entry.id),
      kind: 'prompt-policy',
      name: entry.name,
      updatedAt: entry.updatedAt,
    })),
    inspect: descriptor => {
      const preset = libraries.presets.get(libraryId(descriptor.id, 'preset:library:'))
      return {
        kind: 'prompt-policy',
        moduleCount: preset.promptCount,
        enabledModuleCount: preset.enabledCount,
      }
    },
    materialize: input => {
      noVariant(input)
      const preset = libraries.presets.get(libraryId(input.selection.id, 'preset:library:'))
      return {
        events: createPresetSessionSeed(input.events, preset.preset, presetAttachment(preset), preset.id),
      }
    },
  }, {
    id: WORLD_INFO_LIBRARY_ROLEPLAY_PROVIDER_ID,
    list: () => libraries.worldInfos.list().map(entry => available({
      id: worldInfoLibraryRoleplayResourceId(entry.id),
      kind: 'world',
      name: entry.name,
    })),
    inspect: descriptor => ({
      kind: 'world',
      entryCount: libraries.worldInfos.resolve(
        libraryId(descriptor.id, 'standalone:library:'),
      ).upload.entryCount,
    }),
    materialize: input => {
      noVariant(input)
      const id = libraryId(input.selection.id, 'standalone:library:')
      const activeCharacter = readActiveSessionCharacter(input.events)
      const binding = activeCharacter?.result.libraryId === undefined
        ? undefined
        : libraries.characters.worldBinding(activeCharacter.result.libraryId)
      if (binding?.primary?.worldInfoId === id
        || binding?.additional.some(reference => reference.worldInfoId === id)) {
        return { events: input.events }
      }
      const world = libraries.worldInfos.asset(id)
      const primaryScene = input.context.mode === 'scene'
        && !readActiveSessionWorldInfos(input.events).some(active => active.placement === 'experience')
      return {
        events: appendWorldInfoLibrarySessionSeed(input.events, world, {
          placement: 'experience',
          purpose: primaryScene ? 'scenario' : 'selected',
        }),
        title: world.upload.name,
      }
    },
  }, ...(regexProvider === undefined ? [] : [regexProvider])]
}
