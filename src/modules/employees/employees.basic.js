// src/modules/employees/employees.basic.js
// ฟังก์ชันพื้นฐานเท่าที่จำเป็นสำหรับหน้าเลือกพนักงาน + PIN switch (ข้อ 28)
// CRUD เต็มรูปแบบของพนักงาน (เพิ่ม/แก้ไข/กำหนดสิทธิ์) จะทำใน Phase 8 ตามแผน

import { getDocs, query, where } from "firebase/firestore";
import { shopCollection } from "../../firebase/firestore.js";

export async function listActiveEmployees() {
  const q = query(shopCollection("employees"), where("status", "==", "ACTIVE"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
