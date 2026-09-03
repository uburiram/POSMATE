# POSMATE - Web POS System

> ระบบ POS สำหรับร้านค้าขนาดเล็กและขนาดกลาง ใช้งานบนมือถือ Android เครื่องเดียว

## 📋 Features

✅ **Authentication** - Firebase Auth + PIN สำหรับพนักงาน
✅ **Product Management** - เพิ่ม/แก้ไข/ลบสินค้า พร้อมรูปภาพ
✅ **Barcode Scanner** - สแกน Barcode ด้วยกล้องมือถือ
✅ **POS System** - ขายสินค้า คำนวณยอด รับชำระเงิน
✅ **Payment Methods** - เงินสด + PromptPay QR Code
✅ **Receipt** - ออกใบเสร็จทันที พิมพ์ได้
✅ **Stock Management** - รับสินค้า ปรับ Stock คืนสินค้า
✅ **Employee Management** - จัดการพนักงาน สิทธิ์การใช้งาน
✅ **Dashboard** - สรุปยอดขายแบบ Real-time
✅ **Reports** - ยอดขาย Stock กำไร
✅ **Audit Log** - บันทึกกิจกรรมทั้งหมด

---

## 🏗️ Architecture

```
Frontend:         HTML5 + CSS3 + JavaScript (Vanilla)
Authentication:   Firebase Auth
Database:         Firestore (NoSQL)
Storage:          Firebase Storage
Hosting:          Firebase Hosting
Version Control:  GitHub
```

---

## 📁 Project Structure

```
posmate/
├── index.html                    # Main Entry Point
├── README.md                     # Documentation
├── SCHEMA.md                     # Database Schema
├── firebase.json                 # Firebase Config
├── .firebaserc                   # Firebase Project
├── firestore.rules              # Security Rules
│
├── assets/
│   ├── css/
│   │   ├── base.css
│   │   ├── mobile.css
│   │   ├── components.css
│   │   ├── animations.css
│   │   └── print.css
│   │
│   ├── js/
│   │   ├── config/firebase-config.js
│   │   ├── auth/
│   │   ├── db/
│   │   ├── modules/
│   │   ├── utils/
│   │   ├── services/
│   │   └── app.js
│   │
│   └── img/
│
└── views/
    ├── login.html
    ├── dashboard.html
    ├── pos.html
    ├── products.html
    ├── inventory.html
    ├── employees.html
    ├── reports.html
    ├── audit-log.html
    └── settings.html
```

---

## 🚀 Quick Start

### Setup Firebase
1. Go to https://console.firebase.google.com/
2. Create project: `posmate-4f87b`
3. Copy Firebase Config to `assets/js/config/firebase-config.js`
4. Setup Firestore Database
5. Create Storage bucket
6. Apply Security Rules from `firestore.rules`

### Deploy
```bash
firebase deploy
```

### Access
```
https://posmate-4f87b.web.app
```

---

## 📱 Browser Support

✅ Chrome (Android)
✅ Firefox (Android)
✅ Samsung Internet

---

## 🔐 Security

- Firebase Authentication
- Firestore Security Rules (Role-based)
- Audit Logging
- No sensitive data in frontend

---

## 📊 Development Phases

1. **Phase 1**: Foundation & Firebase Setup
2. **Phase 2**: Core POS (Products, Barcode, Cart)
3. **Phase 3**: Payment & Receipt
4. **Phase 4**: Inventory Management
5. **Phase 5**: Employees & Permissions
6. **Phase 6**: Reports & Dashboard
7. **Phase 7**: Offline Mode & Sync
8. **Phase 8**: QA & Optimization

---

**Version:** 0.1.0
**Last Updated:** 2026-09-03
