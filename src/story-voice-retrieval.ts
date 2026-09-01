/** Dialogue-first retrieval over local story sources for one planned character reply. */

import type { StorySource } from './story-workspace-protocol.ts'
import {
  normalizeStorySourceContent,
  splitLocatedStorySourcePassages,
  type LocatedStorySourcePassage,
} from './story-source.ts'
import {
  parseStoryVoiceDocument,
  storyVoiceSpeakerMatches,
  storyVoiceRelevanceScore,
  storyVoiceRelevanceTokens,
  type StoryVoiceEvidenceLine,
  type StoryVoiceEvidenceParts,
  type StoryVoiceDocumentLine,
} from './story-voice-evidence.ts'

const SOURCE_CONTEXT_RADIUS = 4
const SOURCE_CONTEXT_CHARACTERS = 6_000
const VOICE_NOTE_PATTERN = /(?:语气|对话|台词|说话|措辞|声音)/u

/** Current public meaning used to retrieve source dialogue for one planned reply. */
export interface StoryVoiceSourceQuery {
  /** The response premise, focus, and already approved dialogue. */
  readonly primary: string
  /** Broader player input and executable-world outcome used as a fallback. */
  readonly context: string
}

/** One source exchange selected before final line-level voice evidence pruning. */
export interface StoryVoiceSourceExcerpt {
  readonly reference: string
  readonly ordinal: number
  readonly sourceId: string
  readonly sourceName: string
  readonly locator: string
  readonly text: string
  readonly citationLocator: string
  readonly voiceParts: StoryVoiceEvidenceParts
}

interface ParsedPassage {
  readonly passage: LocatedStorySourcePassage
  readonly parts: StoryVoiceEvidenceParts
}

interface IndexedPassage {
  readonly passage: LocatedStorySourcePassage
  readonly lines: readonly StoryVoiceDocumentLine[]
  readonly notes: string
}

interface IndexedSource {
  readonly source: StorySource
  readonly sourceIndex: number
  readonly passages: readonly IndexedPassage[]
}

interface ParsedSource {
  readonly source: StorySource
  readonly sourceIndex: number
  readonly passages: readonly ParsedPassage[]
}

interface DialogueAnchor {
  readonly source: ParsedSource
  readonly passageIndex: number
  readonly lineIndex: number
  readonly primaryScore: number
  readonly contextScore: number
}

interface NoteCandidate {
  readonly source: ParsedSource
  readonly passageIndex: number
  readonly score: number
}

function locatorSection(locator: string): string {
  return locator.replace(/(?:^| · )第 \d+ 段$/u, '')
}

function passageNotes(text: string, hasDialogue: boolean): string {
  if (hasDialogue) return ''
  return text.replace(/^(?:原文|参考译文)\s*[：:]?$/u, '').trim()
}

function indexSourcePassages(source: StorySource): readonly IndexedPassage[] {
  const content = normalizeStorySourceContent(source.content)
  const document = parseStoryVoiceDocument(content)
  return splitLocatedStorySourcePassages(source).map(passage => {
    const lines = document.occurrences.filter(line => line.sourceStart >= passage.sourceStart
      && line.sourceStart < passage.sourceEnd)
    return {
      passage,
      lines,
      notes: passageNotes(passage.text, lines.length > 0),
    }
  })
}

function attributeSource(source: IndexedSource, characterNames: readonly string[]): ParsedSource {
  return {
    source: source.source,
    sourceIndex: source.sourceIndex,
    passages: source.passages.map(({ passage, lines, notes }) => {
      const orderedLines: StoryVoiceEvidenceLine[] = lines.map(line => ({
        speaker: line.speaker,
        dialogue: line.dialogue,
        variant: line.variant,
        owner: storyVoiceSpeakerMatches(characterNames, line.speaker) ? 'target' : 'context',
        ...(line.parallelKey === undefined ? {} : { parallelKey: line.parallelKey }),
      }))
      return {
        passage,
        parts: {
          orderedLines,
          targetLines: orderedLines.filter(line => line.owner === 'target'),
          contextLines: orderedLines.filter(line => line.owner === 'context'),
          notes,
        },
      }
    }),
  }
}

function mergeVoiceParts(passages: readonly ParsedPassage[]): StoryVoiceEvidenceParts {
  const orderedLines: StoryVoiceEvidenceLine[] = []
  const seenLines = new Set<string>()
  const notes: string[] = []
  const seenNotes = new Set<string>()
  for (const passage of passages) {
    for (const line of passage.parts.orderedLines) {
      const key = `${line.owner}\u0000${line.variant}\u0000${line.speaker}\u0000${line.dialogue}`
      if (seenLines.has(key)) continue
      seenLines.add(key)
      orderedLines.push(line)
    }
    for (const note of passage.parts.notes.split('\n')) {
      if (note === '' || seenNotes.has(note)) continue
      seenNotes.add(note)
      notes.push(note)
    }
  }
  return {
    orderedLines,
    targetLines: orderedLines.filter(line => line.owner === 'target'),
    contextLines: orderedLines.filter(line => line.owner === 'context'),
    notes: notes.join('\n'),
  }
}

function selectedContext(source: ParsedSource, centerIndex: number): readonly ParsedPassage[] {
  const center = source.passages[centerIndex]!
  const section = locatorSection(center.passage.locator)
  const selected = [center]
  let characters = center.passage.text.length
  for (let distance = 1; distance <= SOURCE_CONTEXT_RADIUS; distance += 1) {
    for (const passageIndex of [centerIndex - distance, centerIndex + distance]) {
      const candidate = source.passages[passageIndex]
      if (candidate === undefined || locatorSection(candidate.passage.locator) !== section
        || characters + candidate.passage.text.length > SOURCE_CONTEXT_CHARACTERS) continue
      selected.push(candidate)
      characters += candidate.passage.text.length
    }
  }
  return selected.sort((left, right) => left.passage.ordinal - right.passage.ordinal)
}

function excerpt(source: ParsedSource, centerIndex: number): StoryVoiceSourceExcerpt {
  const selected = selectedContext(source, centerIndex)
  const center = source.passages[centerIndex]!.passage
  const first = selected[0]!.passage
  const last = selected.at(-1)!.passage
  return {
    reference: `local:${source.source.id}:${String(center.ordinal + 1)}`,
    ordinal: center.ordinal,
    sourceId: source.source.id,
    sourceName: source.source.name,
    locator: center.locator,
    text: selected.map(candidate => candidate.passage.text).join('\n'),
    citationLocator: first.locator === last.locator ? first.locator : `${first.locator} – ${last.locator}`,
    voiceParts: mergeVoiceParts(selected),
  }
}

function renderedLength(value: StoryVoiceSourceExcerpt): number {
  return `### [${value.reference}] ${value.sourceName} · ${value.locator}\n${value.text}`.length
}

/**
 * Select target-character exchanges from every local source before applying the character budget.
 * Speaker aliases identify ownership but never contribute to semantic ranking.
 */
function searchIndexedStoryVoiceSources(
  indexedSources: readonly IndexedSource[],
  characterNames: readonly string[],
  query: StoryVoiceSourceQuery,
  maxCharacters: number,
): readonly StoryVoiceSourceExcerpt[] {
  const primaryTokens = storyVoiceRelevanceTokens(query.primary)
  const contextTokens = storyVoiceRelevanceTokens(query.context)
  const parsedSources = indexedSources.map(source => attributeSource(source, characterNames))
  const anchors: DialogueAnchor[] = []
  const notes: NoteCandidate[] = []
  for (const source of parsedSources) {
    const lines = source.passages.flatMap((passage, passageIndex) => passage.parts.orderedLines.map(line => ({
      line,
      passageIndex,
    })))
    for (const [lineIndex, current] of lines.entries()) {
      if (current!.line.owner !== 'target') continue
      const previous = lines[lineIndex - 1]
      const sameSection = previous !== undefined
        && locatorSection(source.passages[previous.passageIndex]!.passage.locator)
          === locatorSection(source.passages[current!.passageIndex]!.passage.locator)
      const text = `${sameSection ? previous.line.dialogue : ''}\n${current!.line.dialogue}`
      anchors.push({
        source,
        passageIndex: current!.passageIndex,
        lineIndex,
        primaryScore: storyVoiceRelevanceScore(primaryTokens, text),
        contextScore: storyVoiceRelevanceScore(contextTokens, text),
      })
    }
    for (const [passageIndex, passage] of source.passages.entries()) {
      if (passage.parts.targetLines.length > 0 || passage.parts.notes === '') continue
      const label = `${source.source.name}\n${passage.passage.locator}`
      notes.push({
        source,
        passageIndex,
        score: (VOICE_NOTE_PATTERN.test(passage.passage.locator) ? 1_000 : 0)
          + storyVoiceRelevanceScore(primaryTokens, `${label}\n${passage.parts.notes}`) * 4
          + storyVoiceRelevanceScore(contextTokens, `${label}\n${passage.parts.notes}`),
      })
    }
  }
  const rankedAnchors = [...anchors].sort((left, right) => {
    const leftTier = left.primaryScore > 0 ? 0 : left.contextScore > 0 ? 1 : 2
    const rightTier = right.primaryScore > 0 ? 0 : right.contextScore > 0 ? 1 : 2
    return leftTier - rightTier
      || right.primaryScore - left.primaryScore
      || right.contextScore - left.contextScore
      || left.source.sourceIndex - right.source.sourceIndex
      || left.passageIndex - right.passageIndex
      || left.lineIndex - right.lineIndex
  })
  const rankedNotes = [...notes].sort((left, right) => right.score - left.score
    || left.source.sourceIndex - right.source.sourceIndex || left.passageIndex - right.passageIndex)
  const selected: StoryVoiceSourceExcerpt[] = []
  const seenWindows = new Set<string>()
  let characters = 0
  const append = (candidate: StoryVoiceSourceExcerpt): boolean => {
    const key = `${candidate.sourceId}\u0000${candidate.citationLocator}`
    if (seenWindows.has(key)) return false
    const length = renderedLength(candidate) + (selected.length === 0 ? 0 : 2)
    if (characters + length > maxCharacters) return false
    seenWindows.add(key)
    selected.push(candidate)
    characters += length
    return true
  }
  const preferredNotes = rankedNotes.filter(candidate => candidate.score > 0)
  if (preferredNotes[0] !== undefined) append(excerpt(preferredNotes[0].source, preferredNotes[0].passageIndex))
  const relevantAnchors = rankedAnchors.filter(anchor => anchor.primaryScore > 0 || anchor.contextScore > 0)
  for (const anchor of relevantAnchors.length === 0 ? rankedAnchors.slice(0, 2) : relevantAnchors) {
    append(excerpt(anchor.source, anchor.passageIndex))
  }
  if (selected.every(candidate => candidate.voiceParts.targetLines.length === 0)) {
    const fallback = rankedAnchors[0]
    if (fallback !== undefined) append(excerpt(fallback.source, fallback.passageIndex))
  }
  return selected
}

/** One turn-local index that parses every enabled original-work source exactly once. */
export class StoryVoiceSourceIndex {
  readonly #sources: readonly IndexedSource[]

  /** @param sources Editable sources available to this story turn; only `original` sources may establish character voice. */
  constructor(sources: readonly StorySource[]) {
    this.#sources = sources.flatMap((source, sourceIndex) => {
      if (!source.enabled || source.kind !== 'original') return []
      return [{ source, sourceIndex, passages: indexSourcePassages(source) }]
    })
  }

  /** Select bounded exchanges after assigning source lines to one character's aliases. */
  search(
    characterNames: readonly string[],
    query: StoryVoiceSourceQuery,
    maxCharacters = 20_000,
  ): readonly StoryVoiceSourceExcerpt[] {
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new Error('故事声音资料检索上限无效')
    return searchIndexedStoryVoiceSources(this.#sources, characterNames, query, maxCharacters)
  }
}

/** Build a one-shot index and select local exchanges for callers outside the turn pipeline. */
export function searchStoryVoiceSourceExcerpts(
  sources: readonly StorySource[],
  characterNames: readonly string[],
  query: StoryVoiceSourceQuery,
  maxCharacters = 20_000,
): readonly StoryVoiceSourceExcerpt[] {
  return new StoryVoiceSourceIndex(sources).search(characterNames, query, maxCharacters)
}
