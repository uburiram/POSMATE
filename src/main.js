// src/main.js
// จุดเริ่มต้นแอป — ตอนนี้ (Phase 3) เดินสาย: Login → เลือกพนักงาน (PIN) →
// เมนูหลัก (หมวดหมู่ / สินค้า) เท่านั้น ส่วน POS/Payment/Receipt ฯลฯ จะเพิ่มใน
// Phase ถัดไปตามแผน (Development Plan ใน Phase 1 doc)

import { watchAuthState, getActiveEmployee, logout, clearActiveEmployee } from "./firebase/auth.js";
import { renderLoginPage } from "./modules/auth/login.ui.js";
import { renderEmployeeSwitchPage } from "./modules/auth/employeeSwitch.ui.js";
import { renderCategoriesPage } from "./modules/products/categories.ui.js";
import { renderProductListPage } from "./modules/products/products.ui.js";
import { renderProductFormPage } from "./modules/products/productForm.ui.js";
import { renderStockDetailPage } from "./modules/inventory/stock.ui.js";

const app = document.getElementById("app");
let authedUser = null;

function renderMainMenu() {
  const emp = getActiveEmployee();
  app.innerHTML = `
    <div class="pm-page">
      <div class="pm-header">
        <h1>POSMATE</h1>
        <button id="menu-switch" class="pm-btn pm-btn--secondary" style="width:auto; padding:0 14px; min-height:40px;">
          ${emp ? emp.name : "สลับพนักงาน"}
        </button>
      </div>
      <button class="pm-btn" id="menu-products" style="margin-bottom:10px;">📦 สินค้า</button>
      <button class="pm-btn pm-btn--secondary" id="menu-categories" style="margin-bottom:10px;">🗂️ หมวดหมู่สินค้า</button>
      <button class="pm-btn pm-btn--secondary" id="menu-logout">ออกจากระบบ</button>
      <p style="color:#6b7280; font-size:13px; margin-top:20px;">
        Phase 3 (Core Product) — ฟังก์ชัน POS/ขาย/ชำระเงินจะมาใน Phase ถัดไป
      </p>
    </div>
  `;

  document.getElementById("menu-products").addEventListener("click", showProductList);
  document.getElementById("menu-categories").addEventListener("click", () =>
    renderCategoriesPage(app)
  );
  document.getElementById("menu-switch").addEventListener("click", () => {
    clearActiveEmployee();
    renderEmployeeSwitchPage(app, { onSuccess: renderMainMenu });
  });
  document.getElementById("menu-logout").addEventListener("click", async () => {
    await logout();
  });
}

function showProductList() {
  renderProductListPage(app, {
    onOpenProduct: (productId) => showStockDetail(productId),
    onAddNew: () => showProductForm(null),
  });
}

function showProductForm(productId) {
  renderProductFormPage(app, {
    productId,
    onDone: () => showProductList(),
    onCancel: () => showProductList(),
  });
}

function showStockDetail(productId) {
  renderStockDetailPage(app, {
    productId,
    onBack: () => showProductList(),
  });
}

watchAuthState(({ user, role, error }) => {
  if (error) {
    app.innerHTML = `<div class="pm-page"><div class="pm-error">${error}</div></div>`;
    return;
  }
  authedUser = user;
  if (!user) {
    renderLoginPage(app, { onSuccess: () => {} });
    return;
  }
  const emp = getActiveEmployee();
  if (!emp) {
    renderEmployeeSwitchPage(app, { onSuccess: renderMainMenu });
    return;
  }
  renderMainMenu();
});
