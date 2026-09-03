// functions/auditLogTrigger.js
// เขียน Audit Log ได้จากฝั่ง server (Admin SDK) เท่านั้น ตามข้อ 33
// เปิดเป็น callable ให้ Cloud Functions อื่น (processSale, stockAdjust ฯลฯ)
// เรียกใช้ภายใน — ไม่ export เป็น public callable ให้ client เรียกตรง
// เพื่อกันไม่ให้ client ปลอมแปลง log

const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const DEFAULT_SHOP_ID = "shop_main";

/**
 * เรียกใช้จากภายใน Cloud Function อื่นๆ เท่านั้น เช่น:
 *   await writeAuditLog({ userId, employeeId, action: 'CREATE_PRODUCT', ... })
 */
async function writeAuditLog({
  userId,
  employeeId,
  action,
  module,
  targetId,
  oldValue = null,
  newValue = null,
  reason = null,
}) {
  const db = getFirestore();
  const ref = db
    .collection("shops")
    .doc(DEFAULT_SHOP_ID)
    .collection("auditLogs")
    .doc();

  await ref.set({
    userId,
    employeeId,
    action,
    module,
    targetId,
    oldValue,
    newValue,
    reason,
    timestamp: FieldValue.serverTimestamp(),
  });

  return ref.id;
}

module.exports = { writeAuditLog };
