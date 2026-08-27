/** Browser-local UUIDs for durable object identity, never for secrets or capability tokens. */

let fallbackSequence = 0

function fallbackBytes(): Uint8Array {
  const bytes = new Uint8Array(16)
  const timestamp = Date.now()
  const sequence = fallbackSequence
  fallbackSequence = (fallbackSequence + 1) >>> 0
  for (let index = 0; index < bytes.length; index += 1) {
    const timeByte = Math.floor(timestamp / (2 ** ((index % 6) * 8))) & 0xff
    const sequenceByte = Math.floor(sequence / (2 ** ((index % 4) * 8))) & 0xff
    bytes[index] = Math.floor(Math.random() * 256) ^ timeByte ^ sequenceByte
  }
  return bytes
}

/** Create a UUID for non-security-sensitive client objects even when Web Crypto is absent. */
export function createClientOpaqueUuid(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  const bytes = typeof webCrypto?.getRandomValues === 'function'
    ? webCrypto.getRandomValues(new Uint8Array(16))
    : fallbackBytes()
  bytes[6] = (bytes[6] ?? 0) & 0x0f | 0x40
  bytes[8] = (bytes[8] ?? 0) & 0x3f | 0x80
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}
