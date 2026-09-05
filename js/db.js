/**
 * POSMATE — Firestore Database Layer
 * Phase 2 + Phase 3 (Categories, Products, Inventory)
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  runTransaction,
  onSnapshot,
  startAt,
  endAt
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { firebaseConfig, DEFAULT_SHOP_ID } from './config.js';
import { generateId } from './utils.js';

let app = null;
let db = null;
let storage = null;

export function initFirebase() {
  if (app) return { app, db, storage };
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  storage = getStorage(app);
  return { app, db, storage };
}

export function getDb() {
  if (!db) initFirebase();
  return db;
}

export function getStorageInstance() {
  if (!storage) initFirebase();
  return storage;
}

export { serverTimestamp, writeBatch, runTransaction, onSnapshot, collection, doc, query, where, orderBy, limit };

// ---------- Shop ----------
export async function getShop(shopId = DEFAULT_SHOP_ID) {
  const snap = await getDoc(doc(getDb(), 'shops', shopId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveShop(shopId, data) {
  const refDoc = doc(getDb(), 'shops', shopId);
  await setDoc(refDoc, {
    ...data,
    shopId,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// ---------- Users ----------
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(getDb(), 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveUserProfile(uid, data) {
  await setDoc(doc(getDb(), 'users', uid), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// ---------- Employees ----------
export async function listEmployees(shopId = DEFAULT_SHOP_ID) {
  const q = query(
    collection(getDb(), 'employees'),
    where('shopId', '==', shopId),
    orderBy('code')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getEmployee(employeeId) {
  const snap = await getDoc(doc(getDb(), 'employees', employeeId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getEmployeeByCode(shopId, code) {
  const q = query(
    collection(getDb(), 'employees'),
    where('shopId', '==', shopId),
    where('code', '==', code),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function saveEmployee(employeeId, data) {
  const refDoc = doc(getDb(), 'employees', employeeId || generateId('emp'));
  const payload = {
    ...data,
    updatedAt: serverTimestamp()
  };
  if (!employeeId) {
    payload.createdAt = serverTimestamp();
  }
  await setDoc(refDoc, payload, { merge: true });
  return refDoc.id;
}

// ---------- Audit Log ----------
export async function writeAuditLog({
  shopId = DEFAULT_SHOP_ID,
  userId,
  employeeId,
  action,
  module,
  targetId = null,
  oldValue = null,
  newValue = null,
  reason = null
}) {
  const logId = generateId('log');
  await setDoc(doc(getDb(), 'auditLogs', logId), {
    logId,
    shopId,
    userId: userId || null,
    employeeId: employeeId || null,
    action,
    module,
    targetId,
    oldValue,
    newValue,
    reason,
    createdAt: serverTimestamp()
  });
  return logId;
}

// ---------- Counter (Receipt Number) ----------
export async function nextReceiptNumber(shopId = DEFAULT_SHOP_ID, prefix = 'INV') {
  const counterRef = doc(getDb(), 'counters', shopId);
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  return runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(counterRef);
    let data = snap.exists() ? snap.data() : { lastDate: '', seq: 0 };

    if (data.lastDate !== dateStr) {
      data = { lastDate: dateStr, seq: 0 };
    }
    data.seq += 1;

    tx.set(counterRef, data, { merge: true });

    const seqStr = String(data.seq).padStart(4, '0');
    return `${prefix}-${dateStr}-${seqStr}`;
  });
}

// =====================================================
// Phase 3 — Categories
// =====================================================

export async function listCategories(shopId = DEFAULT_SHOP_ID) {
  const q = query(
    collection(getDb(), 'categories'),
    where('shopId', '==', shopId),
    orderBy('sortOrder'),
    orderBy('name')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // fallback ถ้ายังไม่มี composite index
    const q2 = query(
      collection(getDb(), 'categories'),
      where('shopId', '==', shopId)
    );
    const snap = await getDocs(q2);
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (a.name || '').localeCompare(b.name || ''));
    return list;
  }
}

export async function getCategory(categoryId) {
  const snap = await getDoc(doc(getDb(), 'categories', categoryId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveCategory(categoryId, data) {
  const id = categoryId || generateId('cat');
  const refDoc = doc(getDb(), 'categories', id);
  const payload = {
    ...data,
    categoryId: id,
    updatedAt: serverTimestamp()
  };
  if (!categoryId) {
    payload.createdAt = serverTimestamp();
    payload.status = data.status || 'ACTIVE';
    payload.sortOrder = data.sortOrder ?? 0;
  }
  await setDoc(refDoc, payload, { merge: true });
  return id;
}

export async function countProductsInCategory(shopId, categoryId) {
  const q = query(
    collection(getDb(), 'products'),
    where('shopId', '==', shopId),
    where('categoryId', '==', categoryId),
    limit(1)
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

// =====================================================
// Phase 3 — Products
// =====================================================

export async function listProducts(shopId = DEFAULT_SHOP_ID, options = {}) {
  const { status, categoryId, search, limitCount = 200 } = options;
  let q;

  if (status && status !== 'ALL') {
    q = query(
      collection(getDb(), 'products'),
      where('shopId', '==', shopId),
      where('status', '==', status),
      orderBy('name'),
      limit(limitCount)
    );
  } else {
    q = query(
      collection(getDb(), 'products'),
      where('shopId', '==', shopId),
      orderBy('name'),
      limit(limitCount)
    );
  }

  try {
    const snap = await getDocs(q);
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (categoryId) {
      list = list.filter(p => p.categoryId === categoryId);
    }
    if (search) {
      const s = search.toLowerCase().trim();
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(s) ||
        (p.barcode || '').toLowerCase().includes(s) ||
        (p.sku || '').toLowerCase().includes(s)
      );
    }
    return list;
  } catch (e) {
    // fallback without orderBy if index missing
    const q2 = query(
      collection(getDb(), 'products'),
      where('shopId', '==', shopId),
      limit(limitCount)
    );
    const snap = await getDocs(q2);
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (status && status !== 'ALL') list = list.filter(p => p.status === status);
    if (categoryId) list = list.filter(p => p.categoryId === categoryId);
    if (search) {
      const s = search.toLowerCase().trim();
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(s) ||
        (p.barcode || '').toLowerCase().includes(s) ||
        (p.sku || '').toLowerCase().includes(s)
      );
    }
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return list;
  }
}

export async function getProduct(productId) {
  const snap = await getDoc(doc(getDb(), 'products', productId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getProductByBarcode(shopId, barcode) {
  if (!barcode) return null;
  const q = query(
    collection(getDb(), 'products'),
    where('shopId', '==', shopId),
    where('barcode', '==', String(barcode).trim()),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function saveProduct(productId, data) {
  const id = productId || generateId('prd');
  const refDoc = doc(getDb(), 'products', id);
  const payload = {
    ...data,
    productId: id,
    updatedAt: serverTimestamp()
  };
  if (!productId) {
    payload.createdAt = serverTimestamp();
  }
  // อัปเดตสถานะ OUT_OF_STOCK อัตโนมัติ
  if (typeof payload.stock === 'number') {
    if (payload.stock <= 0 && payload.status === 'ACTIVE') {
      payload.status = 'OUT_OF_STOCK';
    } else if (payload.stock > 0 && payload.status === 'OUT_OF_STOCK') {
      payload.status = 'ACTIVE';
    }
  }
  await setDoc(refDoc, payload, { merge: true });
  return id;
}

/**
 * อัปโหลดรูปสินค้า (ลดขนาดฝั่ง client ก่อน)
 * @param {string} shopId
 * @param {string} productId
 * @param {Blob|File} file
 * @returns {Promise<string>} download URL
 */
export async function uploadProductImage(shopId, productId, file) {
  const storageRef = ref(getStorageInstance(), `shops/${shopId}/products/${productId}.jpg`);
  await uploadBytes(storageRef, file, { contentType: 'image/jpeg' });
  return getDownloadURL(storageRef);
}

export async function deleteProductImage(shopId, productId) {
  try {
    const storageRef = ref(getStorageInstance(), `shops/${shopId}/products/${productId}.jpg`);
    await deleteObject(storageRef);
  } catch (e) {
    // ignore if not exists
  }
}

// =====================================================
// Phase 3 — Inventory / Stock Movement
// =====================================================

/**
 * รับสินค้าเข้าคลัง (Stock In)
 * ใช้ Transaction เพื่อความถูกต้องของ stock
 */
export async function stockIn({
  shopId,
  productId,
  quantity,
  unitCost = null,
  supplier = null,
  docNo = null,
  note = null,
  employeeId,
  userId
}) {
  if (!quantity || quantity <= 0) throw new Error('จำนวนต้องมากกว่า 0');

  const productRef = doc(getDb(), 'products', productId);
  const txId = generateId('inv');

  await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists()) throw new Error('ไม่พบสินค้า');
    const product = snap.data();
    if (product.shopId !== shopId) throw new Error('สินค้าไม่ใช่ของร้านนี้');

    const before = Number(product.stock) || 0;
    const after = before + Number(quantity);

    tx.update(productRef, {
      stock: after,
      status: after > 0 ? (product.status === 'OUT_OF_STOCK' ? 'ACTIVE' : product.status) : product.status,
      updatedAt: serverTimestamp()
    });

    const invRef = doc(getDb(), 'inventoryTransactions', txId);
    tx.set(invRef, {
      txId,
      shopId,
      productId,
      type: 'IN',
      quantity: Number(quantity),
      beforeStock: before,
      afterStock: after,
      unitCost: unitCost != null ? Number(unitCost) : (product.costPrice || null),
      reason: 'รับสินค้าเข้าคลัง',
      note: note || null,
      supplier: supplier || null,
      docNo: docNo || null,
      refType: 'STOCK_IN',
      refId: txId,
      employeeId: employeeId || null,
      createdAt: serverTimestamp()
    });
  });

  await writeAuditLog({
    shopId,
    userId,
    employeeId,
    action: 'STOCK_IN',
    module: 'INVENTORY',
    targetId: productId,
    newValue: { quantity, note }
  });

  return txId;
}

/**
 * ปรับ Stock (นับใหม่ / เสีย / หาย / ใช้ภายใน ฯลฯ)
 */
export async function adjustStock({
  shopId,
  productId,
  newStock,
  reason,
  note = null,
  employeeId,
  userId
}) {
  if (newStock == null || newStock < 0) throw new Error('จำนวนสต็อกไม่ถูกต้อง');
  if (!reason) throw new Error('ต้องระบุเหตุผล');

  const productRef = doc(getDb(), 'products', productId);
  const txId = generateId('inv');
  const adjustId = generateId('adj');

  let before = 0;
  let after = Number(newStock);

  await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists()) throw new Error('ไม่พบสินค้า');
    const product = snap.data();
    if (product.shopId !== shopId) throw new Error('สินค้าไม่ใช่ของร้านนี้');

    before = Number(product.stock) || 0;
    after = Number(newStock);
    const diff = after - before;

    let newStatus = product.status;
    if (after <= 0 && product.status === 'ACTIVE') newStatus = 'OUT_OF_STOCK';
    else if (after > 0 && product.status === 'OUT_OF_STOCK') newStatus = 'ACTIVE';

    tx.update(productRef, {
      stock: after,
      status: newStatus,
      updatedAt: serverTimestamp()
    });

    const invRef = doc(getDb(), 'inventoryTransactions', txId);
    tx.set(invRef, {
      txId,
      shopId,
      productId,
      type: 'ADJUST',
      quantity: Math.abs(diff),
      beforeStock: before,
      afterStock: after,
      reason,
      note: note || null,
      refType: 'ADJUST',
      refId: adjustId,
      employeeId: employeeId || null,
      createdAt: serverTimestamp()
    });

    const adjRef = doc(getDb(), 'stockAdjustments', adjustId);
    tx.set(adjRef, {
      adjustId,
      shopId,
      productId,
      beforeStock: before,
      afterStock: after,
      difference: diff,
      reason,
      note: note || null,
      employeeId: employeeId || null,
      createdAt: serverTimestamp()
    });
  });

  await writeAuditLog({
    shopId,
    userId,
    employeeId,
    action: 'ADJUST_STOCK',
    module: 'INVENTORY',
    targetId: productId,
    oldValue: { stock: before },
    newValue: { stock: after, reason },
    reason
  });

  return { txId, adjustId, before, after };
}

/**
 * ดึงประวัติ Stock Movement ของสินค้า
 */
export async function listInventoryTransactions(shopId, productId, limitCount = 50) {
  const q = query(
    collection(getDb(), 'inventoryTransactions'),
    where('shopId', '==', shopId),
    where('productId', '==', productId),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    const q2 = query(
      collection(getDb(), 'inventoryTransactions'),
      where('shopId', '==', shopId),
      where('productId', '==', productId),
      limit(limitCount)
    );
    const snap = await getDocs(q2);
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toMillis?.() || 0;
      return tb - ta;
    });
    return list;
  }
}

/**
 * สินค้าใกล้หมด / หมด
 */
export async function getLowStockProducts(shopId = DEFAULT_SHOP_ID) {
  const products = await listProducts(shopId, { status: 'ALL', limitCount: 500 });
  const low = [];
  const out = [];
  for (const p of products) {
    if (p.status === 'INACTIVE') continue;
    const stock = Number(p.stock) || 0;
    const min = Number(p.minStock) || 0;
    if (stock <= 0) out.push(p);
    else if (min > 0 && stock <= min) low.push(p);
  }
  return { low, out };
}

// =====================================================
// Phase 6 — Sales History / Cancel / Refund
// =====================================================


/**
 * รายการขาย (ล่าสุดก่อน)
 * options: { status, paymentMethod, fromDate, toDate, receiptNo, limitCount }
 */
export async function listSales(shopId = DEFAULT_SHOP_ID, options = {}) {
  const { status, paymentMethod, limitCount = 50 } = options;
  let q;

  if (status && status !== 'ALL') {
    q = query(
      collection(getDb(), 'sales'),
      where('shopId', '==', shopId),
      where('status', '==', status),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
  } else {
    q = query(
      collection(getDb(), 'sales'),
      where('shopId', '==', shopId),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
  }

  try {
    const snap = await getDocs(q);
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (paymentMethod && paymentMethod !== 'ALL') {
      list = list.filter(s => s.paymentMethod === paymentMethod);
    }
    if (options.receiptNo) {
      const r = options.receiptNo.trim().toUpperCase();
      list = list.filter(s => (s.receiptNo || '').toUpperCase().includes(r));
    }
    if (options.employeeId) {
      list = list.filter(s => s.employeeId === options.employeeId);
    }
    return list;
  } catch (e) {
    // fallback ไม่มี index
    const q2 = query(
      collection(getDb(), 'sales'),
      where('shopId', '==', shopId),
      limit(limitCount)
    );
    const snap = await getDocs(q2);
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (status && status !== 'ALL') list = list.filter(s => s.status === status);
    if (paymentMethod && paymentMethod !== 'ALL') list = list.filter(s => s.paymentMethod === paymentMethod);
    if (options.receiptNo) {
      const r = options.receiptNo.trim().toUpperCase();
      list = list.filter(s => (s.receiptNo || '').toUpperCase().includes(r));
    }
    list.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toMillis?.() || 0;
      return tb - ta;
    });
    return list;
  }
}

export async function getSale(saleId) {
  const snap = await getDoc(doc(getDb(), 'sales', saleId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * ยกเลิกบิลทั้งใบ — คืน Stock ทั้งหมด (เฉพาะที่ยังไม่คืน)
 */
export async function cancelSale({
  saleId,
  reason,
  employeeId,
  userId
}) {
  if (!reason) throw new Error('ต้องระบุเหตุผลการยกเลิก');

  const saleRef = doc(getDb(), 'sales', saleId);

  await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(saleRef);
    if (!snap.exists()) throw new Error('ไม่พบรายการขาย');
    const sale = snap.data();

    if (sale.status === 'CANCELLED') throw new Error('บิลนี้ถูกยกเลิกแล้ว');
    if (sale.status === 'REFUNDED') throw new Error('บิลนี้คืนเงินแล้ว ไม่สามารถยกเลิกได้');
    if (sale.status !== 'COMPLETED') throw new Error('สถานะบิลไม่สามารถยกเลิกได้');

    // คืน stock แต่ละรายการ (หัก returnedQty ที่มีแล้ว)
    for (const item of (sale.items || [])) {
      const alreadyReturned = Number(item.returnedQty) || 0;
      const restoreQty = Number(item.quantity) - alreadyReturned;
      if (restoreQty <= 0) continue;

      const pref = doc(getDb(), 'products', item.productId);
      const ps = await tx.get(pref);
      if (!ps.exists()) continue;
      const pdata = ps.data();
      const before = Number(pdata.stock) || 0;
      const after = before + restoreQty;
      let status = pdata.status;
      if (after > 0 && status === 'OUT_OF_STOCK') status = 'ACTIVE';

      tx.update(pref, {
        stock: after,
        status,
        updatedAt: serverTimestamp()
      });

      const txId = generateId('inv');
      tx.set(doc(getDb(), 'inventoryTransactions', txId), {
        txId,
        shopId: sale.shopId,
        productId: item.productId,
        type: 'CANCEL',
        quantity: restoreQty,
        beforeStock: before,
        afterStock: after,
        reason: reason || 'ยกเลิกบิล',
        note: sale.receiptNo,
        refType: 'SALE',
        refId: saleId,
        employeeId: employeeId || null,
        createdAt: serverTimestamp()
      });
    }

    // อัปเดต items returnedQty = quantity
    const newItems = (sale.items || []).map(i => ({
      ...i,
      returnedQty: Number(i.quantity) || 0
    }));

    tx.update(saleRef, {
      status: 'CANCELLED',
      paymentStatus: 'CANCELLED',
      items: newItems,
      cancelledAt: serverTimestamp(),
      cancelledBy: employeeId || null,
      cancelReason: reason,
      updatedAt: serverTimestamp()
    });

    if (sale.paymentId) {
      const payRef = doc(getDb(), 'payments', sale.paymentId);
      const paySnap = await tx.get(payRef);
      if (paySnap.exists()) {
        tx.update(payRef, {
          status: 'CANCELLED',
          updatedAt: serverTimestamp()
        });
      }
    }
  });

  await writeAuditLog({
    shopId: (await getSale(saleId))?.shopId || DEFAULT_SHOP_ID,
    userId,
    employeeId,
    action: 'CANCEL_SALE',
    module: 'SALE',
    targetId: saleId,
    reason
  });

  return getSale(saleId);
}

/**
 * คืนสินค้า (บางรายการหรือทั้งบิล)
 * items: [{ productId, quantity }]
 */
export async function refundSale({
  saleId,
  items, // [{ productId, quantity }]
  reason,
  employeeId,
  userId
}) {
  if (!reason) throw new Error('ต้องระบุเหตุผลการคืน');
  if (!items || !items.length) throw new Error('ไม่มีรายการคืน');

  const saleRef = doc(getDb(), 'sales', saleId);
  const refundId = generateId('ref');
  let totalRefund = 0;
  let shopId = DEFAULT_SHOP_ID;

  await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(saleRef);
    if (!snap.exists()) throw new Error('ไม่พบรายการขาย');
    const sale = snap.data();
    shopId = sale.shopId;

    if (sale.status === 'CANCELLED') throw new Error('บิลถูกยกเลิกแล้ว');
    if (sale.status !== 'COMPLETED' && sale.status !== 'REFUNDED') {
      throw new Error('สถานะบิลไม่สามารถคืนสินค้าได้');
    }

    const saleItems = [...(sale.items || [])];
    const refundLines = [];

    for (const req of items) {
      const idx = saleItems.findIndex(i => i.productId === req.productId);
      if (idx < 0) throw new Error('ไม่พบสินค้าในบิล');
      const line = saleItems[idx];
      const sold = Number(line.quantity) || 0;
      const already = Number(line.returnedQty) || 0;
      const canReturn = sold - already;
      const qty = Math.floor(Number(req.quantity) || 0);
      if (qty <= 0) throw new Error('จำนวนคืนต้องมากกว่า 0');
      if (qty > canReturn) {
        throw new Error(`คืนเกินจำนวน: ${line.name} (คืนได้สูงสุด ${canReturn})`);
      }

      const unitRefund = Number(line.unitPrice) || 0;
      const lineRefund = Math.round(unitRefund * qty * 100) / 100;
      totalRefund += lineRefund;

      line.returnedQty = already + qty;
      saleItems[idx] = line;

      refundLines.push({
        productId: line.productId,
        name: line.name,
        quantity: qty,
        unitPrice: unitRefund,
        amount: lineRefund
      });

      // คืน stock
      const pref = doc(getDb(), 'products', line.productId);
      const ps = await tx.get(pref);
      if (ps.exists()) {
        const pdata = ps.data();
        const before = Number(pdata.stock) || 0;
        const after = before + qty;
        let status = pdata.status;
        if (after > 0 && status === 'OUT_OF_STOCK') status = 'ACTIVE';
        tx.update(pref, {
          stock: after,
          status,
          updatedAt: serverTimestamp()
        });

        const txId = generateId('inv');
        tx.set(doc(getDb(), 'inventoryTransactions', txId), {
          txId,
          shopId: sale.shopId,
          productId: line.productId,
          type: 'RETURN',
          quantity: qty,
          beforeStock: before,
          afterStock: after,
          reason: reason || 'คืนสินค้า',
          note: sale.receiptNo,
          refType: 'REFUND',
          refId: refundId,
          employeeId: employeeId || null,
          createdAt: serverTimestamp()
        });
      }
    }

    totalRefund = Math.round(totalRefund * 100) / 100;

    // ถ้าคืนครบทุกชิ้น → REFUNDED, ไม่ครบยัง COMPLETED แต่มี returnedQty
    const allReturned = saleItems.every(i => (Number(i.returnedQty) || 0) >= (Number(i.quantity) || 0));
    const newStatus = allReturned ? 'REFUNDED' : 'COMPLETED';

    tx.update(saleRef, {
      items: saleItems,
      status: newStatus,
      paymentStatus: allReturned ? 'REFUNDED' : sale.paymentStatus,
      updatedAt: serverTimestamp()
    });

    tx.set(doc(getDb(), 'refunds', refundId), {
      refundId,
      shopId: sale.shopId,
      saleId,
      receiptNo: sale.receiptNo,
      items: refundLines,
      totalRefund,
      reason,
      employeeId: employeeId || null,
      createdAt: serverTimestamp()
    });
  });

  await writeAuditLog({
    shopId,
    userId,
    employeeId,
    action: 'REFUND',
    module: 'SALE',
    targetId: saleId,
    newValue: { refundId, totalRefund, items },
    reason
  });

  return { refundId, totalRefund, sale: await getSale(saleId) };
}

// =====================================================
// Phase 7 — Dashboard / Reports / Shifts
// =====================================================

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * ดึงยอดขายในช่วงวัน (client-side filter จาก list ล่าสุด)
 * สำหรับร้านเล็ก–กลางเพียงพอใน V1
 */
export async function getSalesInRange(shopId, fromDate, toDate, limitCount = 500) {
  const sales = await listSales(shopId, { status: 'ALL', limitCount });
  const from = fromDate ? startOfDay(fromDate).getTime() : 0;
  const to = toDate ? endOfDay(toDate).getTime() : Date.now();

  return sales.filter(s => {
    const t = s.createdAt?.toMillis?.() || s.createdAt?.seconds * 1000 || 0;
    return t >= from && t <= to;
  });
}

/**
 * สรุป Dashboard / รายงาน
 */
export async function getDashboardStats(shopId = DEFAULT_SHOP_ID, fromDate = null, toDate = null) {
  const from = fromDate || startOfDay();
  const to = toDate || endOfDay();
  const sales = await getSalesInRange(shopId, from, to, 500);

  let totalSales = 0;
  let totalDiscount = 0;
  let cashSales = 0;
  let promptPaySales = 0;
  let billCount = 0;
  let cancelledCount = 0;
  let refundedCount = 0;
  let itemCount = 0;
  let totalCost = 0;
  const productMap = {}; // productId -> { name, qty, revenue, cost }

  for (const s of sales) {
    if (s.status === 'CANCELLED') {
      cancelledCount++;
      continue;
    }
    if (s.status === 'REFUNDED') {
      refundedCount++;
      // นับเฉพาะส่วนที่ยังไม่คืนเต็ม — ใช้ total เดิมหักคร่าว ๆ ไม่ซับซ้อนเกิน
    }

    if (s.status !== 'COMPLETED' && s.status !== 'REFUNDED') continue;

    billCount++;
    const total = Number(s.total) || 0;
    const discount = Number(s.discountAmount) || 0;
    totalSales += total;
    totalDiscount += discount;

    if (s.paymentMethod === 'PROMPTPAY') promptPaySales += total;
    else cashSales += total;

    for (const item of (s.items || [])) {
      const sold = Number(item.quantity) || 0;
      const returned = Number(item.returnedQty) || 0;
      const qty = Math.max(0, sold - returned);
      if (qty <= 0) continue;
      itemCount += qty;
      const revenue = (Number(item.unitPrice) || 0) * qty;
      const cost = (Number(item.costPrice) || 0) * qty;
      totalCost += cost;

      const pid = item.productId || item.name;
      if (!productMap[pid]) {
        productMap[pid] = { productId: item.productId, name: item.name, qty: 0, revenue: 0, cost: 0 };
      }
      productMap[pid].qty += qty;
      productMap[pid].revenue += revenue;
      productMap[pid].cost += cost;
    }
  }

  const grossProfit = Math.round((totalSales - totalCost) * 100) / 100;
  const topProducts = Object.values(productMap)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  return {
    from,
    to,
    totalSales: Math.round(totalSales * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    cashSales: Math.round(cashSales * 100) / 100,
    promptPaySales: Math.round(promptPaySales * 100) / 100,
    billCount,
    cancelledCount,
    refundedCount,
    itemCount,
    totalCost: Math.round(totalCost * 100) / 100,
    grossProfit,
    topProducts,
    sales
  };
}

/**
 * กะที่เปิดอยู่ของร้าน
 */
export async function getOpenShift(shopId = DEFAULT_SHOP_ID) {
  const q = query(
    collection(getDb(), 'shifts'),
    where('shopId', '==', shopId),
    where('status', '==', 'OPEN'),
    limit(5)
  );
  try {
    const snap = await getDocs(q);
    if (snap.empty) return null;
    // เอาอันล่าสุด
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => {
      const ta = a.openedAt?.toMillis?.() || 0;
      const tb = b.openedAt?.toMillis?.() || 0;
      return tb - ta;
    });
    return list[0];
  } catch (e) {
    const q2 = query(
      collection(getDb(), 'shifts'),
      where('shopId', '==', shopId),
      limit(20)
    );
    const snap = await getDocs(q2);
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.status === 'OPEN');
    return list[0] || null;
  }
}

export async function openShift({ shopId, employeeId, userId, openingCash = 0 }) {
  const existing = await getOpenShift(shopId);
  if (existing) throw new Error('มีกะที่ยังไม่ปิดอยู่แล้ว');

  const shiftId = generateId('shf');
  await setDoc(doc(getDb(), 'shifts', shiftId), {
    shiftId,
    shopId,
    employeeId: employeeId || null,
    status: 'OPEN',
    openingCash: Number(openingCash) || 0,
    openedAt: serverTimestamp(),
    closedAt: null,
    createdAt: serverTimestamp()
  });

  await writeAuditLog({
    shopId,
    userId,
    employeeId,
    action: 'OPEN_SHIFT',
    module: 'SHIFT',
    targetId: shiftId
  });

  return shiftId;
}

export async function closeShift({
  shopId,
  shiftId,
  employeeId,
  userId,
  countedCash,
  note = null
}) {
  const shiftRef = doc(getDb(), 'shifts', shiftId);
  const snap = await getDoc(shiftRef);
  if (!snap.exists()) throw new Error('ไม่พบกะ');
  const shift = snap.data();
  if (shift.status !== 'OPEN') throw new Error('กะนี้ปิดแล้ว');

  // สรุปยอดตั้งแต่นาทีเปิดกะ
  const openedAt = shift.openedAt?.toDate?.() || new Date();
  const stats = await getDashboardStats(shopId, openedAt, new Date());

  const expectedCash = (Number(shift.openingCash) || 0) + stats.cashSales;
  const counted = Number(countedCash);
  if (isNaN(counted) || counted < 0) throw new Error('จำนวนเงินสดที่นับได้ไม่ถูกต้อง');
  const difference = Math.round((counted - expectedCash) * 100) / 100;

  await updateDoc(shiftRef, {
    status: 'CLOSED',
    closedAt: serverTimestamp(),
    closedBy: employeeId || null,
    expectedCash: Math.round(expectedCash * 100) / 100,
    countedCash: counted,
    difference,
    totalSales: stats.totalSales,
    cashSales: stats.cashSales,
    promptPaySales: stats.promptPaySales,
    billCount: stats.billCount,
    note: note || null,
    updatedAt: serverTimestamp()
  });

  await writeAuditLog({
    shopId,
    userId,
    employeeId,
    action: 'CLOSE_SHIFT',
    module: 'SHIFT',
    targetId: shiftId,
    newValue: { expectedCash, countedCash: counted, difference, totalSales: stats.totalSales }
  });

  return {
    shiftId,
    expectedCash,
    countedCash: counted,
    difference,
    stats
  };
}

export async function listShifts(shopId = DEFAULT_SHOP_ID, limitCount = 20) {
  const q = query(
    collection(getDb(), 'shifts'),
    where('shopId', '==', shopId),
    limit(limitCount)
  );
  try {
    const snap = await getDocs(q);
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => {
      const ta = a.openedAt?.toMillis?.() || 0;
      const tb = b.openedAt?.toMillis?.() || 0;
      return tb - ta;
    });
    return list;
  } catch (e) {
    return [];
  }
}
