/** Host-owned IndexedDB storage for isolated SillyTavern script sandboxes. */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  parseInstalledStExtensionSettingsIdentity,
  parseTavernExtensionSettingsIdentity,
  parseTavernScriptStorageIdentity,
} from '../tavern-script-identity.ts'

const LEGACY_DATABASE_NAME = 'dsh-agent-rp-tavern-storage'
const SCOPED_DATABASE_NAME = 'dsh-agent-rp-tavern-storage-scoped'
const EXTENSION_SETTINGS_DATABASE_NAME = 'dsh-agent-rp-tavern-extension-settings-scoped'
const DATABASE_VERSION = 1
const LEGACY_STORE_NAME = 'entries'
const SCOPED_STORE_NAME = 'scoped-entries'
const MIGRATION_STORE_NAME = 'storage-migrations'
const LEGACY_CLAIM_STORE_NAME = 'legacy-storage-claims'
const EXTENSION_SETTINGS_STORE_NAME = 'settings'
const EXTENSION_SETTINGS_MIGRATION_STORE_NAME = 'settings-migrations'
const EXTENSION_SETTINGS_LEGACY_CLAIM_STORE_NAME = 'legacy-settings-claim'
const EXTENSION_SETTINGS_LEGACY_CLAIM_KEY = 'legacy'
const MAX_TAVERN_EXTENSION_SETTINGS_BYTES = 2 * 1024 * 1024

/** Read-only key used by the former browser-global extension-settings implementation. */
export const LEGACY_TAVERN_EXTENSION_SETTINGS_KEY = 'dsh-agent-rp:tavern-extension-settings:v1'

type JsonRecord = Readonly<Record<string, JsonValue>>

interface LegacyTavernValue {
  readonly namespace: string
  readonly key: string
  readonly value: unknown
}

interface StoredTavernValue {
  readonly owner: string
  readonly namespace: string
  readonly key: string
  readonly value: JsonValue
}

interface StoredTavernExtensionSettings {
  readonly owner: string
  readonly value: JsonRecord
}

/** One validated localforage-compatible storage operation from a script sandbox. */
export interface TavernStorageRequest {
  readonly operation: 'get' | 'set' | 'remove' | 'clear' | 'keys' | 'length' | 'key'
  readonly namespace: string
  readonly key?: string
  readonly value?: JsonValue
  readonly index?: number
}

let legacyDatabase: Promise<IDBDatabase> | undefined
let scopedDatabase: Promise<IDBDatabase> | undefined
let extensionSettingsDatabase: Promise<IDBDatabase> | undefined

function openDatabase(
  name: string,
  current: Promise<IDBDatabase> | undefined,
  upgrade: (db: IDBDatabase) => void,
  assign: (value: Promise<IDBDatabase> | undefined) => void,
): Promise<IDBDatabase> {
  if (current !== undefined) return current
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION)
    request.addEventListener('upgradeneeded', () => { upgrade(request.result) })
    request.addEventListener('success', () => {
      request.result.addEventListener('versionchange', () => {
        request.result.close()
        assign(undefined)
      })
      resolve(request.result)
    })
    request.addEventListener('error', () => { reject(request.error ?? new Error('无法打开酒馆脚本存储')) })
    request.addEventListener('blocked', () => { reject(new Error('酒馆脚本存储正在被另一个页面升级')) })
  })
  const guarded = opening.catch((reason: unknown): never => {
    assign(undefined)
    throw reason
  })
  assign(guarded)
  return guarded
}

function openLegacyDatabase(): Promise<IDBDatabase> {
  return openDatabase(LEGACY_DATABASE_NAME, legacyDatabase, db => {
    if (db.objectStoreNames.contains(LEGACY_STORE_NAME)) return
    const legacy = db.createObjectStore(LEGACY_STORE_NAME, { keyPath: ['namespace', 'key'] })
    legacy.createIndex('namespace', 'namespace', { unique: false })
  }, value => { legacyDatabase = value })
}

function openScopedDatabase(): Promise<IDBDatabase> {
  return openDatabase(SCOPED_DATABASE_NAME, scopedDatabase, db => {
    if (!db.objectStoreNames.contains(SCOPED_STORE_NAME)) {
      const scoped = db.createObjectStore(SCOPED_STORE_NAME, { keyPath: ['owner', 'namespace', 'key'] })
      scoped.createIndex('owner-namespace', ['owner', 'namespace'], { unique: false })
    }
    if (!db.objectStoreNames.contains(MIGRATION_STORE_NAME)) {
      db.createObjectStore(MIGRATION_STORE_NAME, { keyPath: ['owner', 'namespace'] })
    }
    if (!db.objectStoreNames.contains(LEGACY_CLAIM_STORE_NAME)) {
      db.createObjectStore(LEGACY_CLAIM_STORE_NAME, { keyPath: 'namespace' })
    }
  }, value => { scopedDatabase = value })
}

function openExtensionSettingsDatabase(): Promise<IDBDatabase> {
  return openDatabase(EXTENSION_SETTINGS_DATABASE_NAME, extensionSettingsDatabase, db => {
    if (!db.objectStoreNames.contains(EXTENSION_SETTINGS_STORE_NAME)) {
      db.createObjectStore(EXTENSION_SETTINGS_STORE_NAME, { keyPath: 'owner' })
    }
    if (!db.objectStoreNames.contains(EXTENSION_SETTINGS_MIGRATION_STORE_NAME)) {
      db.createObjectStore(EXTENSION_SETTINGS_MIGRATION_STORE_NAME, { keyPath: 'owner' })
    }
    if (!db.objectStoreNames.contains(EXTENSION_SETTINGS_LEGACY_CLAIM_STORE_NAME)) {
      db.createObjectStore(EXTENSION_SETTINGS_LEGACY_CLAIM_STORE_NAME, { keyPath: 'key' })
    }
  }, value => { extensionSettingsDatabase = value })
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => { resolve(request.result) })
    request.addEventListener('error', () => { reject(request.error ?? new Error('酒馆脚本存储操作失败')) })
  })
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => { resolve() })
    transaction.addEventListener('abort', () => { reject(transaction.error ?? new Error('酒馆脚本存储事务已取消')) })
    transaction.addEventListener('error', () => { reject(transaction.error ?? new Error('酒馆脚本存储事务失败')) })
  })
}

function key(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw new Error('酒馆脚本存储键必须是 1–2048 个字符')
  }
  return value
}

function namespace(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error('酒馆脚本存储命名空间无效')
  }
  return value
}

function owner(value: string): string {
  if (parseTavernScriptStorageIdentity(value) === undefined) throw new Error('酒馆脚本存储身份无效')
  return value
}

function extensionSettingsOwner(value: string): { readonly id: string; readonly migrateLegacy: boolean } {
  if (parseTavernExtensionSettingsIdentity(value) !== undefined) return { id: value, migrateLegacy: true }
  if (parseInstalledStExtensionSettingsIdentity(value) !== undefined) return { id: value, migrateLegacy: false }
  throw new Error('酒馆扩展设置身份无效')
}

function encodedTavernExtensionSettings(value: unknown): { readonly source: string; readonly value: JsonRecord } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('酒馆扩展设置必须是对象')
  }
  let source: string
  try {
    source = JSON.stringify(value)
  } catch {
    throw new Error('酒馆扩展设置必须可以保存为 JSON')
  }
  if (new TextEncoder().encode(source).byteLength > MAX_TAVERN_EXTENSION_SETTINGS_BYTES) {
    throw new Error('酒馆扩展设置超过 2 MiB')
  }
  const parsed = JSON.parse(source) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('酒馆扩展设置必须是对象')
  }
  return { source, value: parsed as JsonRecord }
}

function legacyTavernExtensionSettings(storage: Pick<Storage, 'getItem'>): JsonRecord | undefined {
  try {
    const source = storage.getItem(LEGACY_TAVERN_EXTENSION_SETTINGS_KEY)
    return source === null ? undefined : encodedTavernExtensionSettings(JSON.parse(source)).value
  } catch {
    return undefined
  }
}

async function migrateLegacyExtensionSettings(
  db: IDBDatabase,
  ownerId: string,
  legacy: JsonRecord | undefined,
): Promise<void> {
  const transaction = db.transaction([
    EXTENSION_SETTINGS_STORE_NAME,
    EXTENSION_SETTINGS_MIGRATION_STORE_NAME,
    EXTENSION_SETTINGS_LEGACY_CLAIM_STORE_NAME,
  ], 'readwrite')
  const migrations = transaction.objectStore(EXTENSION_SETTINGS_MIGRATION_STORE_NAME)
  const migrated = await result(migrations.get(ownerId)) as object | undefined
  if (migrated === undefined) {
    const claims = transaction.objectStore(EXTENSION_SETTINGS_LEGACY_CLAIM_STORE_NAME)
    const claim = await result(claims.get(EXTENSION_SETTINGS_LEGACY_CLAIM_KEY)) as {
      readonly owner: string
    } | undefined
    if (claim === undefined) {
      claims.add({ key: EXTENSION_SETTINGS_LEGACY_CLAIM_KEY, owner: ownerId })
      const settings = transaction.objectStore(EXTENSION_SETTINGS_STORE_NAME)
      const existing = await result(settings.get(ownerId)) as StoredTavernExtensionSettings | undefined
      if (existing === undefined && legacy !== undefined) settings.put({ owner: ownerId, value: legacy })
    }
    migrations.put({ owner: ownerId })
  }
  await completed(transaction)
}

/** Read one script-tree installation's settings and claim the former global value at most once. */
export async function readTavernExtensionSettings(
  ownerIdentity: string,
  legacyStorage: Pick<Storage, 'getItem'>,
): Promise<JsonRecord> {
  const owner = extensionSettingsOwner(ownerIdentity)
  try {
    const db = await openExtensionSettingsDatabase()
    if (owner.migrateLegacy) {
      await migrateLegacyExtensionSettings(db, owner.id, legacyTavernExtensionSettings(legacyStorage))
    }
    const transaction = db.transaction(EXTENSION_SETTINGS_STORE_NAME, 'readonly')
    const stored = await result(transaction.objectStore(EXTENSION_SETTINGS_STORE_NAME).get(owner.id)) as
      StoredTavernExtensionSettings | undefined
    return stored === undefined ? {} : encodedTavernExtensionSettings(stored.value).value
  } catch {
    // An unavailable or corrupt browser store must not prevent the isolated script from starting.
    return {}
  }
}

/** Validate and persist the complete settings object for one Host-derived script-tree installation. */
export async function writeTavernExtensionSettings(
  ownerIdentity: string,
  value: unknown,
): Promise<JsonRecord> {
  const ownerId = extensionSettingsOwner(ownerIdentity).id
  const encoded = encodedTavernExtensionSettings(value)
  const db = await openExtensionSettingsDatabase()
  const transaction = db.transaction([
    EXTENSION_SETTINGS_STORE_NAME,
    EXTENSION_SETTINGS_MIGRATION_STORE_NAME,
  ], 'readwrite')
  transaction.objectStore(EXTENSION_SETTINGS_STORE_NAME).put({ owner: ownerId, value: encoded.value })
  transaction.objectStore(EXTENSION_SETTINGS_MIGRATION_STORE_NAME).put({ owner: ownerId })
  await completed(transaction)
  return encoded.value
}

async function legacyEntries(store: IDBObjectStore, name: string): Promise<LegacyTavernValue[]> {
  return await result(store.index('namespace').getAll(IDBKeyRange.only(name))) as LegacyTavernValue[]
}

async function scopedEntries(store: IDBObjectStore, ownerId: string, name: string): Promise<StoredTavernValue[]> {
  return await result(store.index('owner-namespace').getAll(IDBKeyRange.only([ownerId, name]))) as StoredTavernValue[]
}

async function claimLegacyNamespace(db: IDBDatabase, ownerId: string, name: string): Promise<boolean> {
  const transaction = db.transaction([MIGRATION_STORE_NAME, LEGACY_CLAIM_STORE_NAME], 'readwrite')
  const migrations = transaction.objectStore(MIGRATION_STORE_NAME)
  const marker = await result(migrations.get([ownerId, name])) as object | undefined
  if (marker !== undefined) return false
  const claims = transaction.objectStore(LEGACY_CLAIM_STORE_NAME)
  const claim = await result(claims.get(name)) as { readonly owner: string } | undefined
  if (claim !== undefined && claim.owner !== ownerId) {
    migrations.put({ owner: ownerId, namespace: name })
    await completed(transaction)
    return false
  }
  if (claim === undefined) claims.add({ namespace: name, owner: ownerId })
  await completed(transaction)
  return true
}

async function copyLegacyNamespace(
  legacyDb: IDBDatabase,
  scopedDb: IDBDatabase,
  ownerId: string,
  name: string,
): Promise<void> {
  const legacyRead = legacyDb.transaction(LEGACY_STORE_NAME, 'readonly')
  const legacy = await legacyEntries(legacyRead.objectStore(LEGACY_STORE_NAME), name)
  const transaction = scopedDb.transaction([SCOPED_STORE_NAME, MIGRATION_STORE_NAME], 'readwrite')
  const migrations = transaction.objectStore(MIGRATION_STORE_NAME)
  const marker = await result(migrations.get([ownerId, name])) as object | undefined
  if (marker !== undefined) return
  const scopedStore = transaction.objectStore(SCOPED_STORE_NAME)
  const scoped = await scopedEntries(scopedStore, ownerId, name)
  const existing = new Set(scoped.map(value => value.key))
  for (const value of legacy) {
    if (existing.has(value.key)) continue
    scopedStore.put({ owner: ownerId, namespace: name, key: value.key, value: value.value })
  }
  migrations.put({ owner: ownerId, namespace: name })
  await completed(transaction)
}

async function migrateLegacyNamespace(ownerId: string, name: string): Promise<IDBDatabase> {
  const scopedDb = await openScopedDatabase()
  if (!await claimLegacyNamespace(scopedDb, ownerId, name)) return scopedDb
  const legacyDb = await openLegacyDatabase()
  await copyLegacyNamespace(legacyDb, scopedDb, ownerId, name)
  return scopedDb
}

/** Execute one localforage-compatible request inside a Host-derived script identity. */
export async function executeTavernStorageRequest(
  ownerIdentity: string,
  request: TavernStorageRequest,
): Promise<unknown> {
  const ownerId = owner(ownerIdentity)
  const name = namespace(request.namespace)
  const db = await migrateLegacyNamespace(ownerId, name)
  if (request.operation === 'get') {
    const transaction = db.transaction(SCOPED_STORE_NAME, 'readonly')
    const value = await result(transaction.objectStore(SCOPED_STORE_NAME).get([
      ownerId, name, key(request.key),
    ])) as StoredTavernValue | undefined
    return value?.value ?? null
  }
  if (request.operation === 'set') {
    const itemKey = key(request.key)
    const transaction = db.transaction(SCOPED_STORE_NAME, 'readwrite')
    transaction.objectStore(SCOPED_STORE_NAME).put({
      owner: ownerId, namespace: name, key: itemKey, value: request.value ?? null,
    })
    await completed(transaction)
    return request.value ?? null
  }
  if (request.operation === 'remove') {
    const transaction = db.transaction(SCOPED_STORE_NAME, 'readwrite')
    transaction.objectStore(SCOPED_STORE_NAME).delete([ownerId, name, key(request.key)])
    await completed(transaction)
    return undefined
  }
  if (request.operation === 'clear') {
    const read = db.transaction(SCOPED_STORE_NAME, 'readonly')
    const values = await scopedEntries(read.objectStore(SCOPED_STORE_NAME), ownerId, name)
    const write = db.transaction(SCOPED_STORE_NAME, 'readwrite')
    const store = write.objectStore(SCOPED_STORE_NAME)
    for (const value of values) store.delete([ownerId, name, value.key])
    await completed(write)
    return undefined
  }
  const transaction = db.transaction(SCOPED_STORE_NAME, 'readonly')
  const values = await scopedEntries(transaction.objectStore(SCOPED_STORE_NAME), ownerId, name)
  const keys = values.map(value => value.key)
  if (request.operation === 'keys') return keys
  if (request.operation === 'length') return keys.length
  if (!Number.isSafeInteger(request.index) || Number(request.index) < 0) return null
  return keys[Number(request.index)] ?? null
}
