/** Iterative validation for JSON values crossing isolated browser runtimes. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Validate one finite, acyclic JSON value without recursive stack growth. */
export function isJsonValue(value: unknown): value is JsonValue {
  const pending: unknown[] = [value]
  const seen = new Set<object>()
  let nodes = 0
  while (pending.length > 0) {
    const item = pending.pop()
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) return false
      continue
    }
    if (typeof item !== 'object' || seen.has(item)) return false
    seen.add(item)
    nodes += 1
    if (nodes > 100_000) return false
    if (Array.isArray(item)) pending.push(...item)
    else {
      const prototype = Object.getPrototypeOf(item)
      if (prototype !== Object.prototype && prototype !== null) return false
      pending.push(...Object.values(item))
    }
  }
  return true
}
