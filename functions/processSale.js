// functions/processSale.js
// หัวใจของข้อ 36: ป้องกัน "ตัดเงินแล้ว Stock ไม่ลด" หรือกลับกัน
// ทุกการเขียน (sale, stock, payment, receipt) อยู่ใน Firestore Transaction เดียว
// Idempotency: client ส่ง clientTransactionId (UUID) มา — ถ้ามี sale ที่ใช้
// transactionId นี้แล้ว ให้คืนผลลัพธ์เดิม ไม่สร้างซ้ำ (กันกดปุ่มซ้ำ/retry หลัง
// network error ตามข้อ 14, 37)

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { writeAuditLog } = require("./auditLogTrigger");

const DEFAULT_SHOP_ID = "shop_main";

exports.processSale = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้อง Login ก่อนใช้งาน");
  }

  const {
    clientTransactionId,
    employeeId,
    items, // [{ productId, qty, unitPrice }]
    discountAmount = 0,
    discountType = null,
    discountBy = null,
    paymentMethod, // 'CASH' | 'PROMPTPAY'
    cashReceived = null,
  } = request.data || {};

  if (!clientTransactionId || !employeeId || !Array.isArray(items) || items.length === 0) {
    throw new HttpsError("invalid-argument", "ข้อมูลการขายไม่ครบ");
  }
  if (!["CASH", "PROMPTPAY"].includes(paymentMethod)) {
    throw new HttpsError("invalid-argument", "วิธีชำระเงินไม่ถูกต้อง");
  }

  const db = getFirestore();
  const shopId = DEFAULT_SHOP_ID;
  const shopRef = db.collection("shops").doc(shopId);

  // --- Idempotency check: ค้นหา sale ที่มี transactionId นี้อยู่แล้วหรือไม่ ---
  const existing = await shopRef
    .collection("sales")
    .where("transactionId", "==", clientTransactionId)
    .limit(1)
    .get();

  if (!existing.empty) {
    const doc = existing.docs[0];
    return { saleId: doc.id, receiptNo: doc.data().receiptNo, idempotent: true };
  }

  const result = await db.runTransaction(async (txn) => {
    // 1) อ่าน stock ปัจจุบันของทุกสินค้าใน cart (server-side re-check)
    const productRefs = items.map((i) =>
      shopRef.collection("products").doc(i.productId)
    );
    const productSnaps = await Promise.all(productRefs.map((ref) => txn.get(ref)));

    let subtotal = 0;
    const stockUpdates = [];
    const invTxnDocs = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const snap = productSnaps[idx];
      if (!snap.exists) {
        throw new HttpsError("not-found", `ไม่พบสินค้า: ${item.productId}`);
      }
      const product = snap.data();
      const before = product.stockQty;
      const after = before - item.qty;
      if (after < 0) {
        throw new HttpsError(
          "failed-precondition",
          `Stock ไม่พอ: ${product.name} (เหลือ ${before})`
        );
      }
      subtotal += item.unitPrice * item.qty;
      stockUpdates.push({ ref: productRefs[idx], after });
      invTxnDocs.push({
        productId: item.productId,
        qtyChange: -item.qty,
        qtyBefore: before,
        qtyAfter: after,
      });
    }

    if (discountAmount > subtotal) {
      throw new HttpsError("invalid-argument", "ส่วนลดมากกว่ายอดสินค้า");
    }
    const netTotal = subtotal - discountAmount;

    if (paymentMethod === "CASH" && (cashReceived === null || cashReceived < netTotal)) {
      throw new HttpsError("invalid-argument", "เงินไม่เพียงพอ");
    }

    // 2) เลขใบเสร็จ atomic (ใช้ counter เดียวกับ generateReceiptNo แต่ inline
    // ในทรานแซกชันนี้เพื่อรับประกัน atomicity ร่วมกับ stock/sale)
    const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const counterRef = shopRef.collection("settings").doc(`receiptCounter_${dateKey}`);
    const counterSnap = await txn.get(counterRef);
    const nextCount = (counterSnap.exists ? counterSnap.data().count : 0) + 1;
    const receiptNo = `INV-${dateKey}-${String(nextCount).padStart(4, "0")}`;

    // 3) เขียนทั้งหมด
    const saleRef = shopRef.collection("sales").doc();
    const paymentRef = shopRef.collection("payments").doc();
    const receiptRef = shopRef.collection("receipts").doc();

    const changeAmount =
      paymentMethod === "CASH" ? cashReceived - netTotal : 0;

    txn.set(saleRef, {
      transactionId: clientTransactionId,
      receiptNo,
      employeeId,
      items,
      subtotal,
      discountAmount,
      discountType,
      discountBy,
      netTotal,
      paymentMethod,
      paymentStatus: "PAID",
      cashReceived,
      changeAmount,
      status: "COMPLETED",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      syncStatus: "SYNCED",
    });

    txn.set(paymentRef, {
      saleId: saleRef.id,
      method: paymentMethod,
      status: "PAID",
      amount: netTotal,
      confirmedBy: employeeId,
      confirmedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });

    txn.set(receiptRef, {
      saleId: saleRef.id,
      receiptNo,
      snapshot: {
        items,
        subtotal,
        discountAmount,
        netTotal,
        paymentMethod,
        cashReceived,
        changeAmount,
        employeeId,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    txn.set(counterRef, { count: nextCount, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    for (const upd of stockUpdates) {
      txn.update(upd.ref, {
        stockQty: upd.after,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    for (const inv of invTxnDocs) {
      const invRef = shopRef.collection("inventoryTransactions").doc();
      txn.set(invRef, {
        productId: inv.productId,
        type: "SALE",
        qtyChange: inv.qtyChange,
        qtyBefore: inv.qtyBefore,
        qtyAfter: inv.qtyAfter,
        reason: "การขาย",
        performedBy: employeeId,
        relatedSaleId: saleRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    return { saleId: saleRef.id, receiptNo };
  });

  await writeAuditLog({
    userId: request.auth.uid,
    employeeId,
    action: "SALE_COMPLETED",
    module: "pos",
    targetId: result.saleId,
    newValue: { receiptNo: result.receiptNo },
  });

  return { ...result, idempotent: false };
});
