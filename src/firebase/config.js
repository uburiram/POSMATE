// src/firebase/config.js
// ค่าเหล่านี้ไม่ใช่ Secret Key (Firebase Web config เป็น public โดยธรรมชาติ
// ความปลอดภัยจริงอยู่ที่ Firestore Security Rules ไม่ใช่การซ่อนค่าพวกนี้)
// ให้แทนที่ด้วยค่าจากโปรเจกต์ posmate-4f87b ของคุณ:
// Firebase Console > Project Settings > General > Your apps > Web app > SDK setup

export const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "posmate-4f87b.firebaseapp.com",
  projectId: "posmate-4f87b",
  storageBucket: "posmate-4f87b.appspot.com",
  messagingSenderId: "REPLACE_WITH_SENDER_ID",
  appId: "REPLACE_WITH_APP_ID",
};

// shopId เริ่มต้นสำหรับ V1 (ร้านเดียว)
// โครงสร้าง DB ออกแบบให้รองรับหลายร้านในอนาคต แต่ V1 fix ค่าเดียวนี้
export const DEFAULT_SHOP_ID = "shop_main";
