/** Deterministic slot assignment for Character Cards imported into an executable world. */

import { storyVoiceSpeakerMatches } from '../story-voice-evidence.ts'

/** One world slot eligible to receive an imported actor resource. */
export interface StoryWorldActorAssignmentCandidate {
  readonly slotId: string
  readonly names: readonly string[]
  readonly required: boolean
}

/** Assign one imported actor by identity, then required-slot order, then remaining-slot order. */
export function assignImportedStoryWorldActor(
  assignments: Readonly<Record<string, string>>,
  candidates: readonly StoryWorldActorAssignmentCandidate[],
  actor: { readonly id: string; readonly name: string },
): Readonly<Record<string, string>> {
  if (Object.values(assignments).includes(actor.id)) return assignments
  const available = candidates.filter(candidate => assignments[candidate.slotId] === undefined)
  const target = available.find(candidate => storyVoiceSpeakerMatches(candidate.names, actor.name))
    ?? available.find(candidate => candidate.required)
    ?? available[0]
  return target === undefined ? assignments : { ...assignments, [target.slotId]: actor.id }
}
