import type { CofreIdbMeta } from './protocol'

const DB_NAME = 'el-cofre'
const DB_VERSION = 1
const CHUNKS = 'chunks'
const META = 'meta'
const META_KEY = 'session'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(CHUNKS)) {
        db.createObjectStore(CHUNKS, { keyPath: 'seq' })
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export async function clearCaptureStore(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([CHUNKS, META], 'readwrite')
    tx.objectStore(CHUNKS).clear()
    tx.objectStore(META).clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'))
    })
  } finally {
    db.close()
  }
}

export async function putChunk(seq: number, blob: Blob): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(CHUNKS, 'readwrite')
    tx.objectStore(CHUNKS).put({ seq, blob })
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put chunk failed'))
    })
  } finally {
    db.close()
  }
}

export async function putMeta(meta: CofreIdbMeta): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(META, 'readwrite')
    tx.objectStore(META).put(meta, META_KEY)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put meta failed'))
    })
  } finally {
    db.close()
  }
}

export async function getAllChunks(): Promise<Blob[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(CHUNKS, 'readonly')
    const rows = await reqToPromise(
      tx.objectStore(CHUNKS).getAll() as IDBRequest<Array<{ seq: number; blob: Blob }>>,
    )
    rows.sort((a, b) => a.seq - b.seq)
    return rows.map((r) => r.blob)
  } finally {
    db.close()
  }
}

export async function getMeta(): Promise<CofreIdbMeta | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(META, 'readonly')
    const value = await reqToPromise(
      tx.objectStore(META).get(META_KEY) as IDBRequest<CofreIdbMeta | undefined>,
    )
    return value ?? null
  } finally {
    db.close()
  }
}
