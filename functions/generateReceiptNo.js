// functions/generateReceiptNo.js
// ออกเลขใบเสร็จแบบ atomic กันเลขซ้ำ แม้กดพร้อมกันหลายเครื่อง (ข้อ 14, 15)
// รูปแบบ: INV-YYYYMMDD-XXXX (รีเซ็ตรันนิ่งนัมเบอร์ทุกวัน)

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const DEFAULT_SHOP_ID = "shop_main";

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

exports.generateReceiptNo = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้อง Login ก่อนใช้งาน");
  }

  const db = getFirestore();
  const shopId = DEFAULT_SHOP_ID;
  const dateKey = todayKey();
  const counterRef = db
    .collection("shops")
    .doc(shopId)
    .collection("settings")
    .doc(`receiptCounter_${dateKey}`);

  const receiptNo = await db.runTransaction(async (txn) => {
    const snap = await txn.get(counterRef);
    const current = snap.exists ? snap.data().count : 0;
    const next = current + 1;
    txn.set(
      counterRef,
      { count: next, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    const padded = String(next).padStart(4, "0");
    return `INV-${dateKey}-${padded}`;
  });

  return { receiptNo };
});
