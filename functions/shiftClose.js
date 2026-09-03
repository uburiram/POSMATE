// functions/shiftClose.js
// คำนวณสรุปปิดกะฝั่ง server จากข้อมูล sales จริง ป้องกันพนักงานแก้ยอดคาดการณ์เอง (ข้อ 32)

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { writeAuditLog } = require("./auditLogTrigger");

const DEFAULT_SHOP_ID = "shop_main";

exports.closeShift = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้อง Login ก่อนใช้งาน");
  }

  const { employeeId, startAt, actualCash } = request.data || {};
  if (!employeeId || !startAt || actualCash === undefined) {
    throw new HttpsError("invalid-argument", "ข้อมูลปิดกะไม่ครบ");
  }

  const db = getFirestore();
  const shopRef = db.collection("shops").doc(DEFAULT_SHOP_ID);
  const startTs = Timestamp.fromMillis(new Date(startAt).getTime());
  const now = Timestamp.now();

  const salesSnap = await shopRef
    .collection("sales")
    .where("employeeId", "==", employeeId)
    .where("createdAt", ">=", startTs)
    .where("createdAt", "<=", now)
    .where("status", "==", "COMPLETED")
    .get();

  let totalSales = 0;
  let totalCash = 0;
  let totalPromptpay = 0;
  let billCount = 0;

  salesSnap.forEach((doc) => {
    const s = doc.data();
    totalSales += s.netTotal;
    billCount += 1;
    if (s.paymentMethod === "CASH") totalCash += s.netTotal;
    if (s.paymentMethod === "PROMPTPAY") totalPromptpay += s.netTotal;
  });

  const expectedCash = totalCash; // ขยายรวมเงินตั้งต้นในลิ้นชักได้ในอนาคตถ้าต้องการ
  const cashDifference = actualCash - expectedCash;

  const shiftRef = shopRef.collection("shifts").doc();
  await shiftRef.set({
    employeeId,
    startAt: startTs,
    endAt: now,
    expectedCash,
    actualCash,
    cashDifference,
    totalSales,
    totalCash,
    totalPromptpay,
    billCount,
    createdAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    userId: request.auth.uid,
    employeeId,
    action: "SHIFT_CLOSED",
    module: "shifts",
    targetId: shiftRef.id,
    newValue: { totalSales, cashDifference },
  });

  return {
    shiftId: shiftRef.id,
    expectedCash,
    actualCash,
    cashDifference,
    totalSales,
    totalCash,
    totalPromptpay,
    billCount,
  };
});
