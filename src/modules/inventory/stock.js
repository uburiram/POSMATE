// src/modules/inventory/stock.js
// คลังสินค้า (ข้อ 20-22) — ทุกการเปลี่ยนแปลง Stock ต้องมี Stock Movement log
// รับสินค้าเข้า/ปรับ Stock ทำผ่าน Firestore Transaction ฝั่ง client ได้
// (rules อนุญาต MANAGER ขึ้นไปเขียน inventoryTransactions/stockAdjustments ตรง)
// ต่างจากตอนขาย (processSale) ที่ต้องผ่าน Cloud Function เพราะเกี่ยวพันเงิน+Stock
// พร้อมกันและต้องกัน race condition ข้ามอุปกรณ์แบบเข้มงวดกว่า

import {
  runTransaction,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit as fsLimit,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase/init.js";
import { shopCollection, shopDoc } from "../../firebase/firestore.js";

/**
 * รับสินค้าเข้าคลัง (ข้อ 21)
 * เพิ่ม stockQty + สร้าง inventoryTransactions(type: STOCK_IN) แบบ atomic
 */
export async function receiveStock({
  productId,
  qty,
  costPrice = null,
  supplier = "",
  docNumber = "",
  note = "",
  performedBy,
}) {
  if (!qty || qty <= 0) throw new Error("จำนวนรับเข้าต้องมากกว่า 0");
  if (!performedBy) throw new Error("ไม่พบผู้ดำเนินการ");

  const productRef = shopDoc("products", productId);

  return runTransaction(db, async (txn) => {
    const snap = await txn.get(productRef);
    if (!snap.exists()) throw new Error("ไม่พบสินค้านี้");
    const product = snap.data();
    const before = product.stockQty;
    const after = before + Number(qty);

    const updates = {
      stockQty: after,
      updatedAt: serverTimestamp(),
    };
    // ถ้าระบุราคาทุนใหม่ตอนรับเข้า ให้ปรับราคาทุนล่าสุดด้วย (weighted avg
    // แบบง่าย: ใช้ราคาทุนล่าสุดที่รับเข้าตรงๆ — ถ้าต้องการ weighted average
    // เต็มรูปแบบ ควรทำใน Phase QA/Optimization เพิ่มเติม)
    if (costPrice != null && costPrice >= 0) {
      updates.costPrice = Number(costPrice);
    }
    if (product.status === "OUT_OF_STOCK" && after > 0) {
      updates.status = "ACTIVE";
    }
    txn.update(productRef, updates);

    const invRef = doc(shopCollection("inventoryTransactions"));
    txn.set(invRef, {
      productId,
      type: "STOCK_IN",
      qtyChange: Number(qty),
      qtyBefore: before,
      qtyAfter: after,
      reason: `รับสินค้าเข้าคลัง${supplier ? ` (Supplier: ${supplier})` : ""}`,
      note: note || null,
      docNumber: docNumber || null,
      performedBy,
      relatedSaleId: null,
      createdAt: serverTimestamp(),
    });

    return { before, after };
  });
}

/**
 * ปรับ Stock (ข้อ 22) — บังคับระบุเหตุผลเสมอ
 */
export async function adjustStock({
  productId,
  newQty,
  reason,
  note = "",
  performedBy,
}) {
  if (!reason || !reason.trim()) throw new Error("กรุณาระบุเหตุผลในการปรับ Stock");
  if (newQty == null || newQty < 0) throw new Error("จำนวน Stock ใหม่ไม่ถูกต้อง");
  if (!performedBy) throw new Error("ไม่พบผู้ดำเนินการ");

  const productRef = shopDoc("products", productId);

  return runTransaction(db, async (txn) => {
    const snap = await txn.get(productRef);
    if (!snap.exists()) throw new Error("ไม่พบสินค้านี้");
    const product = snap.data();
    const before = product.stockQty;
    const after = Number(newQty);

    txn.update(productRef, {
      stockQty: after,
      status: after === 0 ? "OUT_OF_STOCK" : product.status === "OUT_OF_STOCK" ? "ACTIVE" : product.status,
      updatedAt: serverTimestamp(),
    });

    const adjustRef = doc(shopCollection("stockAdjustments"));
    txn.set(adjustRef, {
      productId,
      qtyBefore: before,
      qtyAfter: after,
      reason: reason.trim(),
      note: note || null,
      performedBy,
      createdAt: serverTimestamp(),
    });

    const invRef = doc(shopCollection("inventoryTransactions"));
    txn.set(invRef, {
      productId,
      type: "ADJUST",
      qtyChange: after - before,
      qtyBefore: before,
      qtyAfter: after,
      reason: reason.trim(),
      note: note || null,
      docNumber: null,
      performedBy,
      relatedSaleId: null,
      createdAt: serverTimestamp(),
    });

    return { before, after };
  });
}

export async function listStockMovements(productId, { max = 50 } = {}) {
  const q = query(
    shopCollection("inventoryTransactions"),
    where("productId", "==", productId),
    orderBy("createdAt", "desc"),
    fsLimit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
