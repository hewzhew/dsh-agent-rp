/** Shared parsing for speaker-labelled dialogue used by voice generation and readiness views. */

const LABELED_DIALOGUE_PATTERN = /([\p{L}·・]{1,16})(?:\s*[：:]\s*[“"]([^”"\r\n]+)[”"]|\s*[：:]?\s*[「『]([^」』\r\n]+)[」』])/gu

/** One speaker-labelled line found in original, translated, or profile dialogue. */
export interface StoryVoiceEvidenceLine {
  readonly speaker: string
  readonly dialogue: string
  readonly owner: 'target' | 'context'
  readonly variant: 'original' | 'translation' | 'example'
}

/** One speaker-labelled line with offsets into the parsed source document. */
export interface StoryVoiceDocumentLine extends Omit<StoryVoiceEvidenceLine, 'owner'> {
  readonly sourceStart: number
  readonly sourceEnd: number
}

/** Speaker-labelled lines recovered from one document before assigning a target character. */
export interface StoryVoiceDocument {
  /** Every labelled occurrence, including repeated lines needed to retain local adjacency. */
  readonly occurrences: readonly StoryVoiceDocumentLine[]
  /** Content-deduplicated lines used by readiness counts and ordinary evidence rendering. */
  readonly orderedLines: readonly StoryVoiceDocumentLine[]
  readonly notes: string
}

/** Ordered target and surrounding dialogue recovered from one evidence document. */
export interface StoryVoiceEvidenceParts {
  readonly orderedLines: readonly StoryVoiceEvidenceLine[]
  readonly targetLines: readonly StoryVoiceEvidenceLine[]
  readonly contextLines: readonly StoryVoiceEvidenceLine[]
  readonly notes: string
}

/** One primary utterance and its aligned reference translation. */
export interface StoryVoiceEvidenceUnit {
  readonly lines: readonly StoryVoiceEvidenceLine[]
  readonly owner: StoryVoiceEvidenceLine['owner']
}

/** Character identity used to diagnose speaker-label attribution. */
export interface StoryVoiceCharacterIdentity {
  readonly id: string
  readonly names: readonly string[]
}

/** One normalized speaker label and every character identity that accepts it. */
export interface StoryVoiceSpeakerAttribution {
  readonly labels: readonly string[]
  readonly characterIds: readonly string[]
  readonly lineCount: number
}

/** Normalize one written speaker name for alias matching and evidence deduplication. */
export function normalizeStoryVoiceSpeakerName(value: string): string {
  return value.normalize('NFKC').replace(/[\s·・]/gu, '')
}

/** Return whether one written speaker label names a character or one of its aliases. */
export function storyVoiceSpeakerMatches(characterNames: readonly string[], speaker: string): boolean {
  const candidate = normalizeStoryVoiceSpeakerName(speaker)
  return candidate.length >= 2
    && characterNames.some(characterName => {
      const target = normalizeStoryVoiceSpeakerName(characterName)
      return target === candidate || target.endsWith(candidate) || candidate.endsWith(target)
    })
}

/** Build bounded lexical signals for comparing a planned reply with source dialogue. */
export function storyVoiceRelevanceTokens(value: string): ReadonlySet<string> {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  const tokens = new Set<string>()
  for (const match of normalized.matchAll(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu)) {
    const chunk = match[0]
    if (/^[\p{Script=Han}]+$/u.test(chunk)) {
      for (let width = 2; width <= Math.min(4, chunk.length); width += 1) {
        for (let index = 0; index + width <= chunk.length; index += 1) {
          tokens.add(chunk.slice(index, index + width))
        }
      }
    } else if (chunk.length >= 2) {
      tokens.add(chunk)
    }
  }
  return tokens
}

/** Score source dialogue against lexical signals without considering its speaker label. */
export function storyVoiceRelevanceScore(tokens: ReadonlySet<string>, value: string): number {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  return [...tokens].reduce((score, token) => score + (normalized.includes(token) ? token.length : 0), 0)
}

/** Parse speaker-labelled dialogue once without assigning it to a target character. */
export function parseStoryVoiceDocument(text: string): StoryVoiceDocument {
  const occurrences: StoryVoiceDocumentLine[] = []
  const orderedLines: StoryVoiceDocumentLine[] = []
  const seen = new Set<string>()
  const noteParts: string[] = []
  let cursor = 0
  let translated = false
  for (const match of text.matchAll(LABELED_DIALOGUE_PATTERN)) {
    const index = match.index
    if (index === undefined) continue
    const prose = text.slice(cursor, index)
    noteParts.push(prose)
    for (const marker of prose.matchAll(/(原文|参考译文)\s*[：:]?/gu)) {
      translated = marker[1] === '参考译文'
    }
    cursor = index + match[0].length
    const speaker = match[1]!.trim()
    const dialogue = (match[2] ?? match[3] ?? '').trim()
    const variant = translated
      ? 'translation'
      : /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(dialogue) ? 'original' : 'example'
    const line = {
      speaker,
      dialogue,
      variant,
      sourceStart: index,
      sourceEnd: index + match[0].length,
    } as const
    occurrences.push(line)
    const key = `${variant}\u0000${normalizeStoryVoiceSpeakerName(speaker)}\u0000${dialogue}`
    if (dialogue === '' || seen.has(key)) continue
    seen.add(key)
    orderedLines.push(line)
  }
  noteParts.push(text.slice(cursor))
  const notes = noteParts.join('')
    .replace(/(?:原文|参考译文)\s*[：:]?/gu, '')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line !== '')
    .join('\n')
  return { occurrences, orderedLines, notes }
}

/** Attribute one parsed document using a character's names and aliases. */
export function attributeStoryVoiceDocument(
  characterNames: readonly string[],
  document: StoryVoiceDocument,
): StoryVoiceEvidenceParts {
  const orderedLines = document.orderedLines.map((line): StoryVoiceEvidenceLine => ({
    speaker: line.speaker,
    dialogue: line.dialogue,
    variant: line.variant,
    owner: storyVoiceSpeakerMatches(characterNames, line.speaker) ? 'target' : 'context',
  }))
  return {
    orderedLines,
    targetLines: orderedLines.filter(line => line.owner === 'target'),
    contextLines: orderedLines.filter(line => line.owner === 'context'),
    notes: document.notes,
  }
}

/** Parse speaker-labelled dialogue and attribute lines using one character's names and aliases. */
export function parseStoryVoiceEvidence(characterNames: readonly string[], text: string): StoryVoiceEvidenceParts {
  return attributeStoryVoiceDocument(characterNames, parseStoryVoiceDocument(text))
}

/** Pair primary dialogue with reference translations using the same ownership rules as voice generation. */
export function storyVoiceEvidenceUnits(parts: StoryVoiceEvidenceParts): readonly StoryVoiceEvidenceUnit[] {
  const primary = parts.orderedLines.filter(line => line.variant !== 'translation')
  const translations = parts.orderedLines.filter(line => line.variant === 'translation')
  if (primary.length === 0) return translations.map(line => ({ lines: [line], owner: line.owner }))
  const unusedTranslations = new Set(translations.map((_line, index) => index))
  const units = primary.map((line, index): StoryVoiceEvidenceUnit => {
    const aligned = translations[index]
    const sameOwner = (candidate: StoryVoiceEvidenceLine): boolean => candidate.owner === line.owner
    const sameFallbackSpeaker = (candidate: StoryVoiceEvidenceLine): boolean => line.owner === 'target'
      || normalizeStoryVoiceSpeakerName(candidate.speaker) === normalizeStoryVoiceSpeakerName(line.speaker)
    const translationIndex = aligned !== undefined
      && unusedTranslations.has(index)
      && sameOwner(aligned)
      ? index
      : translations.findIndex((candidate, candidateIndex) => unusedTranslations.has(candidateIndex)
        && sameOwner(candidate) && sameFallbackSpeaker(candidate))
    const translation = translationIndex < 0 ? undefined : translations[translationIndex]
    if (translation !== undefined) unusedTranslations.delete(translationIndex)
    return {
      lines: translation === undefined ? [line] : [line, translation],
      owner: line.owner,
    }
  })
  return [
    ...units,
    ...[...unusedTranslations].map(index => ({
      lines: [translations[index]!],
      owner: translations[index]!.owner,
    })),
  ]
}

/** Group written speaker labels and report unmatched or multiply matched identities. */
export function storyVoiceSpeakerAttributions(
  document: StoryVoiceDocument,
  characters: readonly StoryVoiceCharacterIdentity[],
): readonly StoryVoiceSpeakerAttribution[] {
  const grouped = new Map<string, { labels: string[]; lineCount: number }>()
  for (const line of document.orderedLines) {
    const key = normalizeStoryVoiceSpeakerName(line.speaker)
    const current = grouped.get(key)
    if (current === undefined) {
      grouped.set(key, { labels: [line.speaker], lineCount: 1 })
      continue
    }
    if (!current.labels.includes(line.speaker)) current.labels.push(line.speaker)
    current.lineCount += 1
  }
  return [...grouped.values()].map(group => ({
    labels: group.labels,
    characterIds: characters
      .filter(character => group.labels.some(label => storyVoiceSpeakerMatches(character.names, label)))
      .map(character => character.id),
    lineCount: group.lineCount,
  }))
}
