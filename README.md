# POSMATE

**ระบบ POS สำหรับร้านค้าขนาดเล็ก–ขนาดกลาง**  
ขายง่าย · สต๊อกครบ · จบในมือถือเครื่องเดียว

**Version:** 1.0.0  
**Firebase Project:** `posmate-4f87b`  
**Repo:** https://github.com/uburiram/POSMATE

---

## คุณสมบัติหลัก

- ขายด้วยสแกน Barcode (กล้องมือถือ) / ค้นหา
- ตะกร้า · ส่วนลด · เงินสด · PromptPay (Thai QR ตามยอด)
- ตัด Stock อัตโนมัติ + ประวัติ Movement
- ใบเสร็จ + พิมพ์ผ่าน Browser
- ยกเลิกบิล / คืนสินค้า
- พนักงาน + PIN + สิทธิ์ (ADMIN / MANAGER / CASHIER)
- Dashboard · รายงาน · เปิด/ปิดกะ
- Offline queue + Sync เมื่อเน็ตกลับ
- Audit Log

---

## โครงสร้างโปรเจกต์

```
POSMATE/
├── index.html
├── css/main.css
├── js/
│   ├── config.js
│   ├── auth.js
│   ├── db.js
│   ├── pos.js
│   ├── payment.js
│   ├── offline.js
│   ├── utils.js
│   └── app.js
├── firestore.rules
├── storage.rules
├── firestore.indexes.json
├── firebase.json
└── docs/
```

**เทคโนโลยี:** HTML5 + CSS3 + JavaScript (ES Modules) · Firebase Auth / Firestore / Storage

---

## ตั้งค่า Firebase (ครั้งแรก)

1. เปิด [Firebase Console](https://console.firebase.google.com/project/posmate-4f87b)
2. **Authentication** → Sign-in method → เปิด **Email/Password**
3. สร้าง User (Email/Password)
4. **Firestore** → สร้าง document `users/{uid}`:
   - role: `ADMIN`
   - shopId: `shop_main`
   - email, displayName, active: true
5. สร้าง `shops/shop_main` (name, currency THB, promptPayId, promptPayName)
6. Deploy `firestore.rules` + `storage.rules`
7. ถ้า Query แจ้ง missing index → สร้างตามลิงก์ใน error

ค่า config อยู่ใน `js/config.js` แล้ว

---

## วิธีรัน

```bash
cd POSMATE
python3 -m http.server 8080
# เปิด http://localhost:8080
```

หรือ Firebase Hosting:

```bash
npm install -g firebase-tools
firebase login
firebase use posmate-4f87b
firebase deploy --only hosting,firestore:rules,storage
```

---

## ลำดับใช้งานในร้าน

1. Login Admin
2. ตั้งค่า → ชื่อร้าน + PromptPay
3. เพิ่มหมวดหมู่ + สินค้า + รับของเข้าคลัง
4. เพิ่มพนักงาน + PIN
5. เปิดกะ → ขาย
6. ปิดกะ

---

## ข้อจำกัด V1

- Offline หลายเครื่องยังไม่ conflict-free 100%
- PromptPay ยืนยันโดยพนักงาน
- รายงานรวมยอดฝั่ง client
- กล้องสแกนต้อง HTTPS หรือ localhost

รายละเอียด: `docs/QA_REPORT.md`

## Phase 1–10 ครบ

Architecture · Auth · สินค้า/Stock · POS · Payment · ประวัติ · Dashboard · Offline · QA · Deploy
