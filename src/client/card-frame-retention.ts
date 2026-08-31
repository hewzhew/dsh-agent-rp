/** Resource policy for retaining live Character Card frontends in long conversations. */

/** One visible Tavern message relevant to live-frontend retention. */
export interface CardFrameRetentionMessage {
  readonly messageId: number
}

/**
 * Select the newest visible message ids whose light frontends may remain live.
 * @param messages - Visible Tavern messages in conversation order.
 * @param renderDepth - Maximum number of recent message rows kept interactive.
 * @returns Message ids in the retained tail.
 */
export function retainedCardFrameMessageIds(
  messages: readonly CardFrameRetentionMessage[],
  renderDepth: number,
): ReadonlySet<number> {
  const start = Math.max(0, messages.length - renderDepth)
  return new Set(messages.slice(start).map(message => message.messageId))
}
