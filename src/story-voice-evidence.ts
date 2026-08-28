/** Shared parsing for speaker-labelled dialogue used by voice generation and readiness views. */

const LABELED_DIALOGUE_PATTERN = /([\p{L}·・]{1,16})(?:\s*[：:]\s*[“"]([^”"\r\n]+)[”"]|\s*[：:]?\s*[「『]([^」』\r\n]+)[」』])/gu

/** One speaker-labelled line found in original, translated, or profile dialogue. */
export interface StoryVoiceEvidenceLine {
  readonly speaker: string
  readonly dialogue: string
  readonly owner: 'target' | 'context'
  readonly variant: 'original' | 'translation' | 'example'
}

/** Speaker-labelled lines recovered from one document before assigning a target character. */
export interface StoryVoiceDocument {
  readonly orderedLines: readonly Omit<StoryVoiceEvidenceLine, 'owner'>[]
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

/** Parse speaker-labelled dialogue once without assigning it to a target character. */
export function parseStoryVoiceDocument(text: string): StoryVoiceDocument {
  const orderedLines: Omit<StoryVoiceEvidenceLine, 'owner'>[] = []
  const seen = new Set<string>()
  const noteParts: string[] = []
  let cursor = 0
  let translated = false
  for (const match of text.matchAll(LABELED_DIALOGUE_PATTERN)) {
    const index = match.index
    if (index === undefined) continue
    const prose = text.slice(cursor, index)
    noteParts.push(prose)
    if (/参考译文\s*[：:]?/u.test(prose)) translated = true
    cursor = index + match[0].length
    const speaker = match[1]!.trim()
    const dialogue = (match[2] ?? match[3] ?? '').trim()
    const variant = translated
      ? 'translation'
      : /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(dialogue) ? 'original' : 'example'
    const key = `${variant}\u0000${normalizeStoryVoiceSpeakerName(speaker)}\u0000${dialogue}`
    if (dialogue === '' || seen.has(key)) continue
    seen.add(key)
    orderedLines.push({ speaker, dialogue, variant })
  }
  noteParts.push(text.slice(cursor))
  const notes = noteParts.join('')
    .replace(/参考译文\s*[：:]?/gu, '')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line !== '')
    .join('\n')
  return { orderedLines, notes }
}

/** Parse speaker-labelled dialogue and attribute lines using one character's names and aliases. */
export function parseStoryVoiceEvidence(characterNames: readonly string[], text: string): StoryVoiceEvidenceParts {
  const document = parseStoryVoiceDocument(text)
  const orderedLines = document.orderedLines.map((line): StoryVoiceEvidenceLine => ({
    ...line,
    owner: storyVoiceSpeakerMatches(characterNames, line.speaker) ? 'target' : 'context',
  }))
  return {
    orderedLines,
    targetLines: orderedLines.filter(line => line.owner === 'target'),
    contextLines: orderedLines.filter(line => line.owner === 'context'),
    notes: document.notes,
  }
}
