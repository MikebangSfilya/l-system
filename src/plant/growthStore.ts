import type { GrowthCheckpointV1, GrowthTime, PlantAppearance, PlantMorphology } from './types.ts'

const DATABASE = 'procedural-tree-growth'
const STORE = 'trees'
const ACTIVE_TREE = 'active'

export type StoredGrowth = {
  id: typeof ACTIVE_TREE
  morphology: PlantMorphology
  appearance: PlantAppearance
  time: GrowthTime
  checkpoint?: GrowthCheckpointV1
}

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function loadGrowth() {
  const db = await database()
  return new Promise<StoredGrowth | undefined>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(ACTIVE_TREE)
    request.onsuccess = () => resolve(request.result as StoredGrowth | undefined)
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
}

export async function saveGrowth(record: Omit<StoredGrowth, 'id'>) {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put({ id: ACTIVE_TREE, ...record } satisfies StoredGrowth)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  }).finally(() => db.close())
}

export async function clearGrowth() {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(ACTIVE_TREE)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  }).finally(() => db.close())
}
