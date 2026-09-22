/**
 * A small key–value store on IndexedDB, for the snapshots that make the app
 * paint before the network answers (lib/snapshots.ts).
 *
 * Why IndexedDB and not localStorage: a thread's log is 40–150 KB of JSON and
 * we keep dozens of them; localStorage is ~5 MB, synchronous, and blocks the
 * main thread on every write. IndexedDB is async and has room.
 *
 * Every call is best-effort and never throws. Private mode, blocked site
 * data, a quota error, or a browser without IndexedDB all mean the same
 * thing to the callers: "no cache" (get → undefined, set → nothing kept).
 * The page must render correctly without it.
 */

const DB_NAME = 'sasonica-chat'
const STORE = 'kv'
/**
 * The cache's shape version. Bump it when what is stored changes shape: the
 * upgrade drops the whole store and starts it empty, so old entries never
 * have to be read by new code. (v2, 22 Sep 2026: threads keyed by session
 * alone — the v1 entries carried an ABS item. v3, 22 Sep 2026: a thread is
 * its §6.2.2 messages, not its lines.)
 */
const CACHE_VERSION = 3

let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, CACHE_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        try {
          // Everything is a cache: drop the old shape, start empty.
          if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE)
          db.createObjectStore(STORE)
        } catch {
          // An upgrade that fails aborts the open → onerror → no cache.
        }
      }
      req.onsuccess = () => {
        const db = req.result
        // Another tab upgrading us: step aside rather than block it.
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
      // Blocked or denied (Firefox private mode, cleared site data mid-open).
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined)
        try {
          const tx = db.transaction(STORE, mode)
          const req = fn(tx.objectStore(STORE))
          tx.oncomplete = () => resolve(req ? (req.result as T) : undefined)
          tx.onerror = () => resolve(undefined)
          tx.onabort = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      })
  )
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return run<T>('readonly', (s) => s.get(key))
}

export function idbSet(key: string, value: unknown): Promise<void> {
  return run<void>('readwrite', (s) => void s.put(value, key)).then(() => undefined)
}

export function idbDel(key: string): Promise<void> {
  return run<void>('readwrite', (s) => void s.delete(key)).then(() => undefined)
}
