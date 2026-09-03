// src/firebase/firestore.js
// Helper กลางสำหรับอ้างอิง collection ที่ผูกกับ shopId ปัจจุบันเสมอ
// ทุก module (products, categories, inventory, ...) ควร import จากที่นี่
// แทนการเขียน collection path ตรงๆ กระจายหลายที่ (ลด Duplicate ตามข้อ 52)

import { collection, doc } from "firebase/firestore";
import { db } from "./init.js";
import { DEFAULT_SHOP_ID } from "./config.js";

export function shopDocRef() {
  return doc(db, "shops", DEFAULT_SHOP_ID);
}

export function shopCollection(name) {
  return collection(db, "shops", DEFAULT_SHOP_ID, name);
}

export function shopDoc(collectionName, docId) {
  return doc(db, "shops", DEFAULT_SHOP_ID, collectionName, docId);
}
