// src/firebase/functions.js
// Wrapper เรียก Cloud Functions (httpsCallable) จากฝั่ง client
// ทุกฟังก์ชันในไฟล์นี้ต้อง login ก่อนเรียก (ตรวจใน Cloud Function อีกชั้น)

import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./init.js";

const functions = getFunctions(app, "asia-southeast1"); // เลือก region ใกล้ไทย

export async function verifyEmployeePin({ employeeId, pin }) {
  const fn = httpsCallable(functions, "verifyEmployeePin");
  const { data } = await fn({ employeeId, pin });
  return data;
}

export async function generateReceiptNo() {
  const fn = httpsCallable(functions, "generateReceiptNo");
  const { data } = await fn({});
  return data.receiptNo;
}

/**
 * ส่งการขายทั้งบิลไปประมวลผลแบบ atomic ฝั่ง server
 * clientTransactionId ต้องเป็น UUID ที่สร้างครั้งเดียวตอนกดปุ่ม "ชำระเงิน"
 * แล้วใช้ค่าเดิมซ้ำหากต้อง retry (network error) เพื่อกันขายซ้ำ
 */
export async function processSale(saleData) {
  const fn = httpsCallable(functions, "processSale");
  const { data } = await fn(saleData);
  return data;
}

export async function closeShift({ employeeId, startAt, actualCash }) {
  const fn = httpsCallable(functions, "closeShift");
  const { data } = await fn({ employeeId, startAt, actualCash });
  return data;
}
