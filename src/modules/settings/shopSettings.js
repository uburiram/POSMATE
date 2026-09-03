// src/modules/settings/shopSettings.js
// ข้อมูลร้านค้า (ข้อ 6) — ต้องถูกใช้ในใบเสร็จและหน้าระบบโดยอัตโนมัติ
// เป็น single source of truth ที่ทุก module (receipt, POS header) ดึงไปใช้ร่วมกัน

import { getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { shopDocRef } from "../../firebase/firestore.js";

const REQUIRED_FIELDS = ["name", "currency"];

export async function getShopSettings() {
  const snap = await getDoc(shopDocRef());
  if (!snap.exists()) {
    throw new Error("ไม่พบข้อมูลร้านค้า กรุณาตั้งค่าร้านก่อนใช้งาน");
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * อัปเดตข้อมูลร้าน — เฉพาะ ADMIN (บังคับผ่าน Firestore Rules อยู่แล้ว
 * แต่ validate ฝั่ง client ก่อนส่งเพื่อ UX ที่ดีและลด round-trip ที่ผิดพลาด)
 */
export async function updateShopSettings(fields) {
  for (const key of REQUIRED_FIELDS) {
    if (fields[key] !== undefined && !String(fields[key]).trim()) {
      throw new Error(`กรุณากรอก ${key}`);
    }
  }
  await updateDoc(shopDocRef(), {
    ...fields,
    updatedAt: serverTimestamp(),
  });
}

/**
 * แปลงรูปแบบเลขใบเสร็จ + ยอดเงิน ให้เป็นข้อความมาตรฐานสำหรับแสดงในใบเสร็จ/POS
 * ใช้ currency จาก shop settings เสมอ ไม่ hardcode "บาท" ตรงๆ ในหลายที่ (ข้อ 46)
 */
export function formatCurrency(amount, currency = "THB") {
  const symbol = currency === "THB" ? "฿" : currency;
  return `${symbol}${Number(amount).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
