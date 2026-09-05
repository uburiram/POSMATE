/**
 * POSMATE — Offline Queue & Sync (Phase 8)
 *
 * V1 ขอบเขต:
 * - Cache สินค้าใน IndexedDB เพื่อค้นหา/สแกนตอน offline
 * - คิวการขาย (PENDING_SYNC) เมื่อเน็ตหลุดตอนกดยืนยันชำระ
 * - Sync อัตโนมัติเมื่อ online กลับ + กัน transactionId ซ้ำ
 * - แสดงสถานะ online/offline บน UI
 *
 * ข้อจำกัด V1:
 * - ยังไม่รองรับ multi-device concurrent offline แบบ conflict-free 100%
 * - การตัด stock เกิดตอน sync (อาจ stock ไม่พอถ้าขาย offline หลายเครื่อง)
 * - ยังไม่ cache พนักงาน/settings แบบเต็ม
 */

const DB_NAME = 'posmate_offline';
const DB_VERSION = 1;
const STORE_PRODUCTS = 'products';
const STORE_PENDING = 'pendingSales';
const STORE_META = 'meta';

let dbPromise = null;
let syncing = false;
let onlineListeners = [];

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        const ps = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
        ps.createIndex('barcode', 'barcode', { unique: false });
        ps.createIndex('shopId', 'shopId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        const pend = db.createObjectStore(STORE_PENDING, { keyPath: 'transactionId' });
        pend.createIndex('syncStatus', 'syncStatus', { unique: false });
        pend.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
  });
  return dbPromise;
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export function onConnectivityChange(fn) {
  onlineListeners.push(fn);
  return () => {
    onlineListeners = onlineListeners.filter(f => f !== fn);
  };
}

function notifyConnectivity() {
  const online = isOnline();
  onlineListeners.forEach(fn => {
    try { fn(online); } catch (e) { /* ignore */ }
  });
}

export function initOfflineListeners() {
  window.addEventListener('online', () => {
    notifyConnectivity();
    syncPendingSales().catch(console.warn);
  });
  window.addEventListener('offline', () => notifyConnectivity());
}

export async function cacheProducts(products) {
  if (!products?.length) return;
  const db = await openDb();
  const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
  const store = tx.objectStore(STORE_PRODUCTS);
  for (const p of products) {
    store.put({
      id: p.id,
      shopId: p.shopId,
      barcode: p.barcode || null,
      sku: p.sku || null,
      name: p.name,
      sellPrice: p.sellPrice,
      costPrice: p.costPrice,
      stock: p.stock,
      unit: p.unit,
      status: p.status,
      categoryId: p.categoryId || null,
      imageUrl: p.imageUrl || null,
      minStock: p.minStock,
      cachedAt: Date.now()
    });
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  const db2 = await openDb();
  const metaTx = db2.transaction(STORE_META, 'readwrite');
  metaTx.objectStore(STORE_META).put({ key: 'productsCachedAt', value: Date.now() });
}

export async function getCachedProducts(shopId) {
  const db = await openDb();
  const tx = db.transaction(STORE_PRODUCTS, 'readonly');
  const store = tx.objectStore(STORE_PRODUCTS);
  const all = await idbReq(store.getAll());
  return (all || []).filter(p => !shopId || p.shopId === shopId);
}

export async function getCachedProductByBarcode(shopId, barcode) {
  const list = await getCachedProducts(shopId);
  const code = String(barcode).trim();
  return list.find(p => p.barcode && String(p.barcode) === code) || null;
}

export async function searchCachedProducts(shopId, keyword) {
  const list = await getCachedProducts(shopId);
  if (!keyword) return list.filter(p => p.status === 'ACTIVE' || p.status === 'OUT_OF_STOCK');
  const s = keyword.toLowerCase().trim();
  return list.filter(p =>
    (p.status !== 'INACTIVE') &&
    ((p.name || '').toLowerCase().includes(s) ||
      (p.barcode || '').toLowerCase().includes(s) ||
      (p.sku || '').toLowerCase().includes(s))
  );
}

export async function refreshProductCache(shopId, listProductsFn) {
  if (!isOnline()) return { cached: 0, offline: true };
  try {
    const products = await listProductsFn(shopId, { status: 'ALL', limitCount: 500 });
    await cacheProducts(products);
    return { cached: products.length, offline: false };
  } catch (e) {
    console.warn('cache refresh failed', e);
    return { cached: 0, error: e.message };
  }
}

export async function enqueuePendingSale(record) {
  const db = await openDb();
  const item = {
    transactionId: record.transactionId,
    shopId: record.shopId,
    payload: record.payload,
    paymentMethod: record.paymentMethod,
    amountReceived: record.amountReceived,
    changeAmount: record.changeAmount,
    syncStatus: 'PENDING_SYNC',
    createdAt: Date.now(),
    attempts: 0,
    lastError: null
  };
  const tx = db.transaction(STORE_PENDING, 'readwrite');
  tx.objectStore(STORE_PENDING).put(item);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return item;
}

export async function listPendingSales() {
  const db = await openDb();
  const tx = db.transaction(STORE_PENDING, 'readonly');
  const all = await idbReq(tx.objectStore(STORE_PENDING).getAll());
  return (all || []).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getPendingCount() {
  const list = await listPendingSales();
  return list.filter(x => x.syncStatus === 'PENDING_SYNC' || x.syncStatus === 'SYNC_ERROR').length;
}

export async function markPendingSynced(transactionId) {
  const db = await openDb();
  const tx = db.transaction(STORE_PENDING, 'readwrite');
  const store = tx.objectStore(STORE_PENDING);
  const item = await idbReq(store.get(transactionId));
  if (item) {
    item.syncStatus = 'SYNCED';
    item.syncedAt = Date.now();
    store.put(item);
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function markPendingError(transactionId, errorMsg) {
  const db = await openDb();
  const tx = db.transaction(STORE_PENDING, 'readwrite');
  const store = tx.objectStore(STORE_PENDING);
  const item = await idbReq(store.get(transactionId));
  if (item) {
    item.syncStatus = 'SYNC_ERROR';
    item.attempts = (item.attempts || 0) + 1;
    item.lastError = errorMsg;
    store.put(item);
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeSyncedPending(olderThanMs = 7 * 24 * 3600 * 1000) {
  const list = await listPendingSales();
  const db = await openDb();
  const tx = db.transaction(STORE_PENDING, 'readwrite');
  const store = tx.objectStore(STORE_PENDING);
  const now = Date.now();
  for (const item of list) {
    if (item.syncStatus === 'SYNCED' && item.syncedAt && (now - item.syncedAt > olderThanMs)) {
      store.delete(item.transactionId);
    }
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function syncPendingSales(completeSaleFn) {
  if (!isOnline() || syncing) return { synced: 0, failed: 0, skipped: true };
  if (!completeSaleFn) return { synced: 0, failed: 0, error: 'no completeSaleFn' };

  syncing = true;
  let synced = 0;
  let failed = 0;

  try {
    const pending = (await listPendingSales()).filter(
      x => x.syncStatus === 'PENDING_SYNC' || x.syncStatus === 'SYNC_ERROR'
    );

    for (const item of pending) {
      try {
        await completeSaleFn({
          payload: item.payload,
          paymentMethod: item.paymentMethod,
          amountReceived: item.amountReceived,
          changeAmount: item.changeAmount
        });
        await markPendingSynced(item.transactionId);
        synced++;
      } catch (err) {
        const msg = err.message || String(err);
        if (msg.includes('ป้องกันซ้ำ') || msg.includes('ถูกบันทึก')) {
          await markPendingSynced(item.transactionId);
          synced++;
        } else {
          await markPendingError(item.transactionId, msg);
          failed++;
        }
      }
    }

    await removeSyncedPending();
  } finally {
    syncing = false;
  }

  return { synced, failed };
}

export function isSyncing() {
  return syncing;
}
