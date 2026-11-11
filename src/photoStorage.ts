interface StoredPhoto {
  key: string;
  bikeId: string;
  photoId: string;
  blob: Blob;
}

const DATABASE_NAME = 'muhelygarazs_photo_library';
const DATABASE_VERSION = 1;
const PHOTO_STORE = 'photos';

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Ez a böngésző nem támogatja a helyi képtárolást.'));
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PHOTO_STORE)) {
        const store = database.createObjectStore(PHOTO_STORE, { keyPath: 'key' });
        store.createIndex('bikeId', 'bikeId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error('A helyi képtárat nem sikerült megnyitni.'));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error('A helyi képtár frissítése blokkolva van. Zárd be az alkalmazás másik megnyitott lapját, majd próbáld újra.'));
    };
  });
  return databasePromise;
}

function photoKey(bikeId: string, photoId: string) {
  return `${bikeId}:${photoId}`;
}

export async function saveBikePhoto(bikeId: string, photoId: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, 'readwrite');
    transaction.objectStore(PHOTO_STORE).put({ key: photoKey(bikeId, photoId), bikeId, photoId, blob } satisfies StoredPhoto);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('A fotó mentése nem sikerült.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('A fotó mentése megszakadt.'));
  });
}

export async function getBikePhoto(bikeId: string, photoId: string): Promise<Blob | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, 'readonly');
    const request = transaction.objectStore(PHOTO_STORE).get(photoKey(bikeId, photoId));
    request.onsuccess = () => {
      const record = request.result as StoredPhoto | undefined;
      resolve(record?.blob ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error('A fotót nem sikerült beolvasni.'));
  });
}

export async function deleteBikePhoto(bikeId: string, photoId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, 'readwrite');
    transaction.objectStore(PHOTO_STORE).delete(photoKey(bikeId, photoId));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('A fotó törlése nem sikerült.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('A fotó törlése megszakadt.'));
  });
}

export async function replaceAllBikePhotos(photos: StoredPhoto[]): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, 'readwrite');
    const store = transaction.objectStore(PHOTO_STORE);
    store.clear();
    photos.forEach((photo) => store.put(photo));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('A képtár cseréje nem sikerült.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('A képtár cseréje megszakadt.'));
  });
}

export function makeStoredPhoto(bikeId: string, photoId: string, blob: Blob): StoredPhoto {
  return { key: photoKey(bikeId, photoId), bikeId, photoId, blob };
}
