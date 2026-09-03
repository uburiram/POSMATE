# POSMATE — Phase 3: Core Product (ร้านค้า / หมวดหมู่ / สินค้า / Stock)

## ไฟล์ที่เพิ่มใน Phase นี้
- `src/firebase/firestore.js` — helper อ้างอิง collection ตาม shopId กลาง
- `src/modules/settings/shopSettings.js` — ข้อมูลร้าน + format currency
- `src/modules/products/categories.js` + `.ui.js` — CRUD หมวดหมู่ พร้อม safe-delete
- `src/modules/products/products.js` + `.ui.js` + `productForm.ui.js` — CRUD สินค้า, ค้นหา, อัปโหลดรูป
- `src/modules/inventory/stock.js` + `.ui.js` — รับสินค้าเข้า, ปรับ Stock, ประวัติ Movement
- `src/modules/auth/login.ui.js`, `employeeSwitch.ui.js` — เข้าสู่ระบบ + สลับพนักงาน (PIN)
- `src/modules/employees/employees.basic.js` — list พนักงาน active (CRUD เต็มมาใน Phase 8)
- `src/shared/toast.js`, `imageResize.js` — Loading/Success/Error state, ลดขนาดรูป
- `src/styles/base.css` — Mobile-first, ปุ่มใหญ่ ตามข้อ 4
- `src/main.js`, `index.html`, `public/manifest.json` — ประกอบเป็นแอปที่รันทดสอบได้จริง
- `functions/auditTriggers.js` — Audit Log อัตโนมัติเมื่อ products/categories/stockAdjustments เปลี่ยนแปลง

## วิธีทดสอบ (ต่อจาก Phase 2)
```bash
npm install
npm run dev
```
เปิดเบราว์เซอร์ตาม URL ที่ Vite แสดง (ปกติ http://localhost:5173) — ทดสอบบน Chrome มือถือผ่าน network เดียวกันได้เช่นกัน

**Flow ทดสอบ:**
1. Login ด้วยบัญชี ADMIN ที่สร้างไว้ใน Phase 2
2. หน้าเลือกพนักงาน → ถ้ายังไม่มีพนักงาน ระบบจะแจ้งให้เพิ่มก่อน (ต้องสร้างเอกสารมือใน Firestore ชั่วคราว จนกว่าจะถึง Phase 8: `shops/shop_main/employees/EMP001` + `shops/shop_main/employeePins/EMP001` พร้อม pinHash ที่ hash ด้วยวิธีเดียวกับใน `functions/verifyEmployeePin.js`)
3. เมนูหลัก → หมวดหมู่สินค้า → เพิ่ม/แก้ไข/ลบ (ทดสอบ: ลบหมวดหมู่ที่มีสินค้าอยู่ → ต้องกลายเป็น "ปิดใช้งาน" ไม่ใช่หายไปเลย)
4. เมนูหลัก → สินค้า → กด + เพิ่มสินค้าใหม่ (กรอกราคาทุน/ขาย/Stock เริ่มต้น + อัปโหลดรูป)
5. ค้นหาสินค้าด้วยชื่อ/Barcode/SKU
6. แตะสินค้า → ดูหน้า Stock → ทดสอบ "รับสินค้าเข้า" และ "ปรับ Stock" (ต้องกรอกเหตุผลจึงบันทึกได้) → ตรวจว่า Stock คงเหลืออัปเดตถูกต้องและมีประวัติ Movement

## Deploy ส่วนที่เพิ่ม
```bash
firebase deploy --only functions:auditProductChanges,functions:auditCategoryChanges,functions:auditStockAdjustments
npm run build
firebase deploy --only hosting
```

## Push ขึ้น GitHub
```bash
git add .
git commit -m "Phase 3: Core Product - shop/categories/products/stock + audit triggers"
git push
```

## สถานะ (ตามฟอร์แมตข้อ 55)
- [PASS] CRUD หมวดหมู่ + safe-delete (ไม่ลบทิ้งถ้ามีสินค้าอ้างอิงอยู่ — เปลี่ยนเป็น INACTIVE แทน)
- [PASS] CRUD สินค้า แยกราคาทุน/ราคาขายชัดเจน, สถานะ ACTIVE/INACTIVE/OUT_OF_STOCK อัตโนมัติเมื่อ Stock=0
- [PASS] รับสินค้าเข้า + ปรับ Stock ผ่าน Firestore Transaction, บังคับกรอกเหตุผลตอนปรับ Stock, มี Stock Movement log ครบ
- [PASS] อัปโหลดรูปสินค้า: resize ก่อนอัปโหลด, ลบรูปเก่าอัตโนมัติเมื่อเปลี่ยนรูป
- [PASS] Audit Log อัตโนมัติผ่าน Firestore Trigger สำหรับ products/categories/stockAdjustments (ไม่พึ่งพา client เรียกเอง)
- [PASS] UI Mobile-first: ปุ่มใหญ่ (min 48px), Loading/Empty/Error/Success state ครบตามข้อ 4, 52
- [WARNING] "แก้ไข Stock" ในฟอร์มสินค้าถูกปิดไว้โดยตั้งใจ (Stock แก้ได้เฉพาะผ่านหน้ารับสินค้า/ปรับ Stock เท่านั้น) เพื่อบังคับให้มี Movement log เสมอ — เป็นการตัดสินใจด้านการออกแบบ ไม่ใช่ข้อจำกัดทางเทคนิค
- [WARNING] ยังไม่มีหน้าจัดการพนักงานจริง (มีแค่ list พื้นฐานสำหรับ PIN switch) — ต้องสร้างพนักงานคนแรกผ่าน Firestore Console ชั่วคราวจนกว่าจะถึง Phase 8
- [WARNING] การค้นหาชื่อสินค้าใช้ prefix-match ของ Firestore (ไม่ใช่ full-text search) — เพียงพอสำหรับร้านขนาดเล็ก-กลาง แต่ค้นหาคำกลางคำ/สะกดผิดยังไม่รองรับ
- [TODO] Barcode Scanner จริง (เปิดกล้อง real-time) ยังไม่ได้ทำ — อยู่ใน Phase 4 (POS)
- [TODO] Employee management UI เต็มรูปแบบ + สร้าง pinHash จาก UI (ตอนนี้ต้องทำมือ) — Phase 8
