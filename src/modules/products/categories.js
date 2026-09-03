// src/modules/products/categories.js
// ระบบหมวดหมู่สินค้า (ข้อ 24) — ต้องป้องกันการลบหมวดหมู่ที่มีสินค้าอยู่
// โดยไม่ทำให้ข้อมูลสินค้าเสียหาย (ไม่ set categoryId เป็น dangling reference)

import {
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { shopCollection, shopDoc } from "../../firebase/firestore.js";

export async function listCategories({ includeInactive = false } = {}) {
  const snap = await getDocs(shopCollection("categories"));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return includeInactive ? all : all.filter((c) => c.status !== "INACTIVE");
}

export async function createCategory(name, performedBy) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("กรุณากรอกชื่อหมวดหมู่");
  if (!performedBy) throw new Error("ไม่พบผู้ดำเนินการ");
  return addDoc(shopCollection("categories"), {
    name: trimmed,
    status: "ACTIVE",
    lastModifiedBy: performedBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateCategory(categoryId, name, performedBy) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("กรุณากรอกชื่อหมวดหมู่");
  if (!performedBy) throw new Error("ไม่พบผู้ดำเนินการ");
  await updateDoc(shopDoc("categories", categoryId), {
    name: trimmed,
    lastModifiedBy: performedBy,
    updatedAt: serverTimestamp(),
  });
}

/**
 * "ลบ" หมวดหมู่แบบปลอดภัย:
 * - ถ้ามีสินค้าผูกอยู่ → ไม่ลบจริง แค่เปลี่ยนสถานะเป็น INACTIVE
 *   (สินค้าเก่ายังอ้างอิง categoryId เดิมได้ แต่จะไม่ปรากฏในตัวเลือกหมวดหมู่ใหม่)
 * - ถ้าไม่มีสินค้าผูกอยู่เลย → ลบ document ได้จริงอย่างปลอดภัย
 */
export async function deleteCategorySafely(categoryId, performedBy) {
  if (!performedBy) throw new Error("ไม่พบผู้ดำเนินการ");
  const productsQ = query(
    shopCollection("products"),
    where("categoryId", "==", categoryId),
    limit(1)
  );
  const productsSnap = await getDocs(productsQ);

  if (!productsSnap.empty) {
    await updateDoc(shopDoc("categories", categoryId), {
      status: "INACTIVE",
      lastModifiedBy: performedBy,
      updatedAt: serverTimestamp(),
    });
    return { deleted: false, deactivated: true };
  }

  await deleteDoc(shopDoc("categories", categoryId));
  return { deleted: true, deactivated: false };
}
