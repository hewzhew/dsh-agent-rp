import assert from 'node:assert/strict'
import test from 'node:test'
import { createClientOpaqueUuid } from '../src/client/client-opaque-id.ts'

test('creates distinct version 4 UUIDs for non-secret client object ids', () => {
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  const nativeValues = Array.from({ length: 32 }, () => createClientOpaqueUuid())
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
  let fallbackValues: readonly string[]
  try {
    fallbackValues = Array.from({ length: 32 }, () => createClientOpaqueUuid())
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'crypto')
    else Object.defineProperty(globalThis, 'crypto', descriptor)
  }
  const values = [...nativeValues, ...fallbackValues]
  assert.equal(new Set(values).size, values.length)
  assert.equal(values.every(value => pattern.test(value)), true)
})
