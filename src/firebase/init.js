// src/firebase/init.js
// จุดเดียวที่ initialize Firebase App — ไฟล์อื่นทั้งหมด import จากที่นี่
// ใช้ Firebase v10 modular SDK (bundle เล็ก เหมาะกับมือถือ/เน็ตไม่เสถียร)

import { initializeApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { firebaseConfig } from "./config.js";

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// เก็บ session ไว้แม้ปิดแท็บ/ปิดแอป — จำเป็นเพราะเป็นมือถือเครื่องเดียวที่ใช้ทั้งวัน
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Auth persistence error:", err);
});

// เปิด Firestore offline persistence (พื้นฐานของ Offline Mode ข้อ 34)
// persistentSingleTabManager เหมาะกับการใช้แอปแท็บเดียวบนมือถือ
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentSingleTabManager({}),
  }),
});

export const storage = getStorage(app);
