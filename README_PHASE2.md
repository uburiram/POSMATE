# POSMATE — Phase 2 Setup Guide (Firebase Config / Auth / Firestore / Security Rules)

## สิ่งที่อยู่ใน Phase นี้
- `src/firebase/config.js`, `init.js` — เชื่อมต่อ Firebase App, Auth, Firestore (offline persistence), Storage
- `src/firebase/auth.js` — Login, โหลด Role, Route Guard, PIN-switch พนักงาน
- `src/firebase/functions.js` — client wrapper เรียก Cloud Functions
- `firestore.rules` — Security Rules ตาม Role + Shop scope
- `firestore.indexes.json` — Composite indexes ที่ต้องใช้
- `storage.rules` — จำกัดขนาด/ชนิดไฟล์รูปสินค้า
- `functions/` — Cloud Functions: `verifyEmployeePin`, `generateReceiptNo`, `processSale`, `closeShift`

## 1) ติดตั้งเครื่องมือ (ทำครั้งเดียวบนมือถือ/เครื่องที่ใช้ dev)
```bash
npm install -g firebase-tools
firebase login
```

## 2) ตั้งค่าโปรเจกต์ให้ตรงกับ Firebase Console จริง
1. เปิด https://console.firebase.google.com/u/0/project/posmate-4f87b/settings/general
2. คัดลอกค่า Web App config (apiKey, appId, messagingSenderId)
3. วางแทนที่ใน `src/firebase/config.js`

## 3) เปิดใช้งาน Firebase Products ที่ต้องใช้ (ถ้ายังไม่เปิด)
- Authentication → Sign-in method → Email/Password → Enable
- Firestore Database → Create database (production mode)
- Storage → Get started
- Functions → ต้องอัปเกรดเป็น **Blaze plan** (จำเป็นสำหรับ Cloud Functions v2 + outbound network)

## 4) ผูก Firebase CLI กับโปรเจกต์นี้
```bash
cd posmate
firebase use --add
# เลือก posmate-4f87b แล้วตั้ง alias เป็น "default"
```

## 5) ติดตั้ง Dependencies
```bash
npm install
cd functions && npm install && cd ..
```

## 6) รันทดสอบด้วย Firebase Emulator ก่อน deploy จริง (แนะนำ)
```bash
npm run emulators
```
เปิดอีก terminal (หรือแท็บ) แล้ว:
```bash
npm run dev
```

## 7) สร้าง user ADMIN คนแรก (ต้องทำก่อนใช้งานจริง)
เนื่องจากยังไม่มี UI สร้าง Admin คนแรก (จะทำใน Phase 8) ให้สร้างด้วยมือใน Firebase Console:
1. Authentication → Add user → ใส่ email/password
2. Firestore → สร้างเอกสารตาม path:
   - `shops/shop_main` (name, currency: "THB", createdAt, ...)
   - `shops/shop_main/users/{uid ที่ได้จากขั้นตอน 1}` → `{ role: "ADMIN", employeeId: "EMP001", status: "ACTIVE" }`
   - `shops/shop_main/employees/EMP001` → ข้อมูลพนักงานตาม schema

## 8) Deploy ขึ้น Firebase จริง
```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase deploy --only functions
npm run build
firebase deploy --only hosting
```
หรือ deploy ทั้งหมดทีเดียว: `npm run deploy`

## 9) Push ขึ้น GitHub (uburiram/POSMATE)
```bash
cd posmate
git init                     # ถ้ายังไม่เคย init
git remote add origin https://github.com/uburiram/POSMATE.git
git add .
git commit -m "Phase 2: Firebase config, Auth, Firestore rules, Cloud Functions"
git branch -M main
git push -u origin main
```
> หมายเหตุ: ผมไม่สามารถรันคำสั่งเหล่านี้แทนคุณได้เพราะไม่มีอินเทอร์เน็ตในสภาพแวดล้อมนี้ — คัดลอกไฟล์ทั้งหมด (หรือ .zip ที่แนบมา) ไปรันบนมือถือ/เครื่องที่มี Git + เน็ตของคุณ

## ตรวจสอบก่อนไป Phase 3 (ตามข้อ 55)
- [PASS] โครงสร้าง Firebase config + Auth + PIN-switch เขียนเสร็จ ครบตาม Requirement ข้อ 27-28
- [PASS] Firestore Rules ครอบคลุมทุก collection ตาม Schema ข้อ 43, ไม่มี `allow read, write: if true`
- [PASS] Cloud Functions หลักที่ป้องกัน Stock/Payment/Audit Log ถูกยึดฝั่ง server (processSale, verifyEmployeePin, closeShift)
- [WARNING] ยังไม่มี UI จริงให้ทดสอบ End-to-end — ต้องรอ Phase 3-4 (Product + POS) ก่อนจึงทดสอบ flow เต็มได้
- [WARNING] ค่า `firebaseConfig` ใน `config.js` ยังเป็น placeholder ต้องแทนที่ด้วยค่าจริงก่อนรัน
- [TODO] UI สำหรับสร้าง Admin คนแรก (ตอนนี้ต้องสร้างมือผ่าน Console ตามข้อ 7 ด้านบน) — จะทำใน Phase 8
- [TODO] อัปเกรดโปรเจกต์เป็น Blaze plan ก่อน deploy Functions จริง
