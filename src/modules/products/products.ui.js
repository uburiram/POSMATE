// src/modules/products/products.ui.js
// หน้ารายการสินค้า: ค้นหา (Barcode/SKU/ชื่อ), Empty/Loading/Error state,
// ปุ่มเพิ่มสินค้าใหม่ (FAB), แตะรายการเพื่อไปหน้าแก้ไข (renderProductFormPage)

import { searchProducts } from "./products.js";
import { listCategories } from "./categories.js";
import { formatCurrency } from "../settings/shopSettings.js";

let debounceTimer = null;

export async function renderProductListPage(container, { onOpenProduct, onAddNew }) {
  container.innerHTML = `
    <div class="pm-page">
      <div class="pm-header"><h1>สินค้า</h1></div>
      <input id="prod-search" class="pm-input" placeholder="ค้นหา: ชื่อสินค้า / Barcode / SKU" />
      <select id="prod-filter-category" class="pm-select">
        <option value="">ทุกหมวดหมู่</option>
      </select>
      <div id="prod-list" class="pm-loading">กำลังโหลด...</div>
      <button class="pm-fab" id="prod-fab" title="เพิ่มสินค้า">+</button>
    </div>
  `;

  const searchInput = container.querySelector("#prod-search");
  const categorySelect = container.querySelector("#prod-filter-category");
  const listEl = container.querySelector("#prod-list");
  const fab = container.querySelector("#prod-fab");

  try {
    const categories = await listCategories();
    categories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      categorySelect.appendChild(opt);
    });
  } catch (err) {
    console.error("โหลดหมวดหมู่ไม่สำเร็จ", err);
  }

  async function refresh() {
    listEl.innerHTML = `<div class="pm-loading">กำลังโหลด...</div>`;
    try {
      const products = await searchProducts(searchInput.value, {
        categoryId: categorySelect.value || null,
        activeOnly: false,
      });
      if (products.length === 0) {
        listEl.innerHTML = `<div class="pm-empty">ไม่พบสินค้า ลองคำค้นหาอื่น หรือกด + เพื่อเพิ่มสินค้าใหม่</div>`;
        return;
      }
      listEl.innerHTML = "";
      products.forEach((p) => {
        const card = document.createElement("div");
        card.className = "pm-card";
        card.style.cursor = "pointer";
        const badge =
          p.status === "OUT_OF_STOCK"
            ? '<span class="pm-badge pm-badge--out">สินค้าหมด</span>'
            : p.stockQty <= p.lowStockThreshold
            ? '<span class="pm-badge pm-badge--low">ใกล้หมด</span>'
            : p.status === "INACTIVE"
            ? '<span class="pm-badge pm-badge--inactive">ปิดใช้งาน</span>'
            : '<span class="pm-badge pm-badge--active">ปกติ</span>';
        card.innerHTML = `
          <img src="${p.imageUrl || ""}" onerror="this.style.visibility='hidden'" />
          <div style="flex:1;">
            <div class="pm-card-title">${escapeHtml(p.name)}</div>
            <div class="pm-card-sub">${formatCurrency(p.sellPrice)} · คงเหลือ ${p.stockQty} ${p.unit || ""}</div>
            ${badge}
          </div>
        `;
        card.addEventListener("click", () => onOpenProduct(p.id));
        listEl.appendChild(card);
      });
    } catch (err) {
      listEl.innerHTML = `<div class="pm-error">ค้นหาไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
    }
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 300); // debounce ลดการยิง query ถี่เกินไป
  });
  categorySelect.addEventListener("change", refresh);
  fab.addEventListener("click", onAddNew);

  await refresh();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
