/** Browser-side readiness projection for the characters and sources used by one executable world. */

import { isFlyingChessWorldState } from '../flying-chess-protocol.ts'
import type { StoryCharacter, StoryWorkspaceSnapshot } from '../story-workspace-protocol.ts'
import { parseStoryVoiceDocument, storyVoiceSpeakerMatches } from '../story-voice-evidence.ts'

/** Output and evidence readiness for one installed world. */
export interface StoryPlayWorldReadiness {
  readonly participants: readonly StoryCharacter[]
  readonly enabledProseOutputCount: number
  readonly originalSourceCount: number
  readonly missingActors: readonly StoryCharacter[]
  readonly missingDialogue: readonly StoryCharacter[]
  readonly missingSourceVoice: readonly StoryCharacter[]
}

/** Resolve only the characters selected by the installed world's cast. */
export function storyPlayWorldParticipants(workspace: StoryWorkspaceSnapshot): readonly StoryCharacter[] {
  const ids = workspace.world !== undefined && isFlyingChessWorldState(workspace.world.state)
    ? workspace.world.state.playerOrder
    : (workspace.worldBinding?.cast.length ?? 0) > 0
      ? workspace.worldBinding?.cast.map(binding => binding.characterId) ?? []
      : workspace.characters.map(character => character.id)
  const characters = new Map(workspace.characters.map(character => [character.id, character]))
  return [...new Set(ids)].flatMap(id => {
    const character = characters.get(id)
    return character === undefined ? [] : [character]
  })
}

/** Inspect output, actor, profile-dialogue, and original-source readiness for the installed cast. */
export function inspectStoryPlayWorldReadiness(workspace: StoryWorkspaceSnapshot): StoryPlayWorldReadiness {
  const participants = storyPlayWorldParticipants(workspace)
  const originalSources = workspace.sources.filter(source => source.enabled && source.kind === 'original')
  const originalVoiceLines = originalSources.flatMap(source => parseStoryVoiceDocument(source.content).orderedLines)
  return {
    participants,
    enabledProseOutputCount: workspace.outputs.filter(output => output.enabled && output.kind === 'prose').length,
    originalSourceCount: originalSources.length,
    missingActors: participants.filter(character => character.actor === undefined),
    missingDialogue: participants.filter(character => character.profile.exampleDialogue.trim() === ''),
    missingSourceVoice: participants.filter(character => {
      const names = [character.name, ...(character.voiceAliases ?? [])]
      return !originalVoiceLines.some(line => storyVoiceSpeakerMatches(names, line.speaker))
    }),
  }
}
