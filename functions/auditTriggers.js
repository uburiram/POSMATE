// functions/auditTriggers.js
// เนื่องจาก products/categories/stockAdjustments เขียนได้ตรงจาก client
// (MANAGER ขึ้นไป, ผ่าน Firestore Rules) จึงใช้ Firestore Trigger ฝั่ง server
// จับการเปลี่ยนแปลงแล้วเขียน Audit Log อัตโนมัติ แทนการพึ่งให้ client
// เรียก callable function เอง (ซึ่งอาจถูกข้ามได้ถ้ามี bug ฝั่ง UI)
// วิธีนี้การันตีว่า "ทุกกิจกรรมสำคัญต้องถูกบันทึก" ตามข้อ 33 จริง

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

async function logChange({ shopId, module, targetId, before, after, actorField = "updatedAt" }) {
  const db = getFirestore();
  const action = !before ? "CREATE" : !after ? "DELETE" : "UPDATE";

  // employeeId/userId ที่แท้จริงของผู้กระทำไม่สามารถอ่านได้จาก trigger context
  // โดยตรง (trigger ไม่มี request.auth) — ฝั่ง client ควรเก็บ field
  // "lastModifiedBy" ไว้ในเอกสารเองเพื่อให้ trigger นี้ดึงมาบันทึกได้แม่นยำ
  const performerId = (after || before)?.lastModifiedBy || "unknown";

  await db
    .collection("shops")
    .doc(shopId)
    .collection("auditLogs")
    .add({
      userId: performerId,
      employeeId: performerId,
      action: `${action}_${module.toUpperCase()}`,
      module,
      targetId,
      oldValue: before || null,
      newValue: after || null,
      reason: null,
      timestamp: FieldValue.serverTimestamp(),
    });
}

exports.auditProductChanges = onDocumentWritten(
  "shops/{shopId}/products/{productId}",
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    await logChange({
      shopId: event.params.shopId,
      module: "products",
      targetId: event.params.productId,
      before,
      after,
    });
  }
);

exports.auditCategoryChanges = onDocumentWritten(
  "shops/{shopId}/categories/{categoryId}",
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    await logChange({
      shopId: event.params.shopId,
      module: "categories",
      targetId: event.params.categoryId,
      before,
      after,
    });
  }
);

exports.auditStockAdjustments = onDocumentWritten(
  "shops/{shopId}/stockAdjustments/{adjustId}",
  async (event) => {
    const after = event.data.after.exists ? event.data.after.data() : null;
    if (!after) return; // ปรับ Stock ไม่มีการแก้ไข/ลบย้อนหลัง ไม่ต้อง log DELETE
    const db = getFirestore();
    await db
      .collection("shops")
      .doc(event.params.shopId)
      .collection("auditLogs")
      .add({
        userId: after.performedBy,
        employeeId: after.performedBy,
        action: "STOCK_ADJUSTED",
        module: "inventory",
        targetId: after.productId,
        oldValue: { qty: after.qtyBefore },
        newValue: { qty: after.qtyAfter },
        reason: after.reason,
        timestamp: FieldValue.serverTimestamp(),
      });
  }
);
