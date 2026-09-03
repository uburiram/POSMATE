// functions/verifyEmployeePin.js
// ตรวจสอบ PIN พนักงานฝั่ง server เท่านั้น — client ไม่มีสิทธิ์อ่าน pinHash เลย
// (ดู firestore.rules: employeePins/{employeeId} allow read, write: if false)

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("crypto");

const DEFAULT_SHOP_ID = "shop_main";

function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(pin, salt, 100000, 32, "sha256").toString("hex");
}

exports.verifyEmployeePin = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ต้อง Login ก่อนใช้งาน");
  }

  const { employeeId, pin } = request.data || {};
  if (!employeeId || !pin) {
    throw new HttpsError("invalid-argument", "ข้อมูลไม่ครบ");
  }

  const db = getFirestore();
  const shopId = DEFAULT_SHOP_ID;

  const pinDocRef = db
    .collection("shops")
    .doc(shopId)
    .collection("employeePins")
    .doc(employeeId);
  const pinSnap = await pinDocRef.get();

  if (!pinSnap.exists) {
    return { valid: false };
  }

  const { salt, hash, failedAttempts = 0, lockedUntil } = pinSnap.data();

  if (lockedUntil && lockedUntil.toMillis() > Date.now()) {
    throw new HttpsError(
      "resource-exhausted",
      "ใส่ PIN ผิดหลายครั้งเกินไป กรุณารอสักครู่"
    );
  }

  const computed = hashPin(pin, salt);
  const valid = crypto.timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(hash, "hex")
  );

  if (!valid) {
    const attempts = failedAttempts + 1;
    const update = { failedAttempts: attempts };
    if (attempts >= 5) {
      update.lockedUntil = new Date(Date.now() + 5 * 60 * 1000); // ล็อก 5 นาที
      update.failedAttempts = 0;
    }
    await pinDocRef.update(update);
    return { valid: false };
  }

  await pinDocRef.update({ failedAttempts: 0 });

  const employeeSnap = await db
    .collection("shops")
    .doc(shopId)
    .collection("employees")
    .doc(employeeId)
    .get();

  if (!employeeSnap.exists || employeeSnap.data().status !== "ACTIVE") {
    return { valid: false };
  }

  const emp = employeeSnap.data();
  return {
    valid: true,
    employeeId,
    name: `${emp.firstName} ${emp.lastName}`,
    role: emp.role,
  };
});
