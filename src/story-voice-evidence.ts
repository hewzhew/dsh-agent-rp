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

/** Parse speaker-labelled dialogue and attribute lines using one character's names and aliases. */
export function parseStoryVoiceEvidence(characterNames: readonly string[], text: string): StoryVoiceEvidenceParts {
  const document = parseStoryVoiceDocument(text)
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
