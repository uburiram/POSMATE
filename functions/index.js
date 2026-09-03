// functions/index.js
const { initializeApp } = require("firebase-admin/app");
initializeApp();

// Public callable functions (เรียกได้จาก client ผ่าน httpsCallable)
exports.verifyEmployeePin = require("./verifyEmployeePin").verifyEmployeePin;
exports.generateReceiptNo = require("./generateReceiptNo").generateReceiptNo;
exports.processSale = require("./processSale").processSale;
exports.closeShift = require("./shiftClose").closeShift;

// หมายเหตุ: writeAuditLog (./auditLogTrigger.js) ไม่ export เป็น public
// callable โดยตั้งใจ — เป็น internal helper ที่ processSale/closeShift ฯลฯ
// เรียกใช้ภายในเท่านั้น เพื่อไม่ให้ client เขียน Audit Log ปลอมได้ (ข้อ 33)

// Firestore triggers: บันทึก Audit Log อัตโนมัติสำหรับสิ่งที่ client เขียนตรง
// (products, categories, stockAdjustments) — ดู functions/auditTriggers.js
const auditTriggers = require("./auditTriggers");
exports.auditProductChanges = auditTriggers.auditProductChanges;
exports.auditCategoryChanges = auditTriggers.auditCategoryChanges;
exports.auditStockAdjustments = auditTriggers.auditStockAdjustments;
