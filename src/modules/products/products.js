// src/modules/products/products.js
// ระบบสินค้า (ข้อ 7) — ต้องแยกราคาทุน/ราคาขายชัดเจน, สถานะ ACTIVE/INACTIVE/OUT_OF_STOCK
// การค้นหาต้องรองรับ Barcode / SKU / ชื่อ / หมวดหมู่ (ข้อ 40)

import {
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  limit as fsLimit,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { shopCollection, shopDoc } from "../../firebase/firestore.js";
import { storage } from "../../firebase/init.js";
import { DEFAULT_SHOP_ID } from "../../firebase/config.js";
import { resizeImageFile } from "../../shared/imageResize.js";

const PRODUCT_STATUS = ["ACTIVE", "INACTIVE", "OUT_OF_STOCK"];

function validateProduct(p) {
  if (!p.name || !p.name.trim()) throw new Error("กรุณากรอกชื่อสินค้า");
  if (p.costPrice == null || p.costPrice < 0) throw new Error("ราคาทุนไม่ถูกต้อง");
  if (p.sellPrice == null || p.sellPrice < 0) throw new Error("ราคาขายไม่ถูกต้อง");
  if (p.sellPrice < p.costPrice) {
    // ไม่ block เด็ดขาด (บางร้านอาจตั้งใจขายขาดทุนช่วงโปรโมชั่น) แต่ผู้เรียกใช้
    // ควรแสดง warning ให้ผู้ใช้ยืนยันก่อน — คืนค่า flag ไว้ให้ UI ใช้
  }
  if (p.stockQty == null || p.stockQty < 0) throw new Error("จำนวน Stock ไม่ถูกต้อง");
}

export async function findProductByBarcode(barcode) {
  const q = query(
    shopCollection("products"),
    where("barcode", "==", barcode.trim()),
    fsLimit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

/**
 * ค้นหาสินค้าแบบง่ายด้วย Barcode / SKU ตรงตัว หรือค้นชื่อแบบ prefix match
 * หมายเหตุ: Firestore ไม่มี full-text search ในตัว — สำหรับค้นชื่อแบบ substring
 * เต็มรูปแบบในอนาคตควรพิจารณา Algolia/Typesense หากจำนวนสินค้ามาก
 * V1 ใช้ prefix match (>= term, <= term + '\uf8ff') ซึ่งพอเพียงกับร้านขนาดเล็ก-กลาง
 */
export async function searchProducts(term, { categoryId = null, activeOnly = true } = {}) {
  const trimmed = term.trim();
  let baseQuery = shopCollection("products");
  const clauses = [];
  if (categoryId) clauses.push(where("categoryId", "==", categoryId));

  if (!trimmed) {
    const snap = await getDocs(query(baseQuery, ...clauses));
    let results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (activeOnly) results = results.filter((p) => p.status === "ACTIVE");
    return results;
  }

  // ลองจับคู่ barcode/sku ตรงตัวก่อน (เร็วที่สุด ใช้บ่อยสุดตอนสแกน)
  const exactMatch = await findProductByBarcode(trimmed);
  if (exactMatch) return [exactMatch];

  const nameQuery = query(
    baseQuery,
    ...clauses,
    where("name", ">=", trimmed),
    where("name", "<=", trimmed + "\uf8ff"),
    fsLimit(30)
  );
  const snap = await getDocs(nameQuery);
  let results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (activeOnly) results = results.filter((p) => p.status === "ACTIVE");
  return results;
}

export async function getProduct(productId) {
  const snap = await getDoc(shopDoc("products", productId));
  if (!snap.exists()) throw new Error("ไม่พบสินค้านี้");
  return { id: snap.id, ...snap.data() };
}

// performedBy = employeeId ของผู้ทำรายการ — เก็บไว้ใน lastModifiedBy เพื่อให้
// Cloud Function trigger (auditTriggers.js) ใช้บันทึก Audit Log ได้ถูกคน
export async function createProduct(data, performedBy) {
  validateProduct(data);
  if (!performedBy) throw new Error("ไม่พบผู้ดำเนินการ");
  const status = data.stockQty === 0 ? "OUT_OF_STOCK" : data.status || "ACTIVE";
  const docRef = await addDoc(shopCollection("products"), {
    barcode: data.barcode?.trim() || null,
    sku: data.sku?.trim() || null,
    name: data.name.trim(),
    description: data.description?.trim() || "",
    imageUrl: data.imageUrl || null,
    categoryId: data.categoryId || null,
    costPrice: Number(data.costPrice),
    sellPrice: Number(data.sellPrice),
    stockQty: Number(data.stockQty),
    unit: data.unit?.trim() || "ชิ้น",
    lowStockThreshold: Number(data.lowStockThreshold ?? 5),
    status,
    lastModifiedBy: performedBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateProduct(productId, data, performedBy) {
  validateProduct(data);
  if (!performedBy) throw new Error("ไม่พบผู้ดำเนินการ");
  const status =
    data.stockQty === 0 && data.status !== "INACTIVE" ? "OUT_OF_STOCK" : data.status;
  await updateDoc(shopDoc("products", productId), {
    barcode: data.barcode?.trim() || null,
    sku: data.sku?.trim() || null,
    name: data.name.trim(),
    description: data.description?.trim() || "",
    categoryId: data.categoryId || null,
    costPrice: Number(data.costPrice),
    sellPrice: Number(data.sellPrice),
    unit: data.unit?.trim() || "ชิ้น",
    lowStockThreshold: Number(data.lowStockThreshold ?? 5),
    status: PRODUCT_STATUS.includes(status) ? status : "ACTIVE",
    lastModifiedBy: performedBy,
    updatedAt: serverTimestamp(),
  });
}

export async function setProductStatus(productId, status, performedBy) {
  if (!PRODUCT_STATUS.includes(status)) throw new Error("สถานะไม่ถูกต้อง");
  if (!performedBy) throw new Error("ไม่พบผู้ดำเนินการ");
  await updateDoc(shopDoc("products", productId), {
    status,
    lastModifiedBy: performedBy,
    updatedAt: serverTimestamp(),
  });
}

/**
 * อัปโหลดรูปสินค้า: resize ก่อนเสมอ (ข้อ 41), ลบรูปเก่าถ้ามีการเปลี่ยนรูป
 */
export async function uploadProductImage(productId, file, previousImageUrl = null, performedBy = null) {
  const resizedBlob = await resizeImageFile(file);
  const fileName = `${Date.now()}.jpg`;
  const path = `shops/${DEFAULT_SHOP_ID}/products/${productId}/${fileName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, resizedBlob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(storageRef);

  await updateDoc(shopDoc("products", productId), {
    imageUrl: url,
    ...(performedBy ? { lastModifiedBy: performedBy } : {}),
    updatedAt: serverTimestamp(),
  });

  if (previousImageUrl) {
    try {
      const oldRef = ref(storage, previousImageUrl);
      await deleteObject(oldRef);
    } catch (err) {
      // ไม่ block การทำงานหลักถ้าลบรูปเก่าไม่สำเร็จ (เช่นถูกลบไปแล้ว)
      console.warn("ลบรูปเก่าไม่สำเร็จ:", err.message);
    }
  }

  return url;
}

export async function listLowStockProducts() {
  const snap = await getDocs(
    query(shopCollection("products"), where("status", "!=", "INACTIVE"))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.stockQty <= p.lowStockThreshold);
}
