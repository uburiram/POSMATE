// src/modules/products/categories.ui.js
// หน้าจัดการหมวดหมู่สินค้า — list + เพิ่ม/แก้ไข/ลบแบบปลอดภัย

import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategorySafely,
} from "./categories.js";
import { showToast, withLoading } from "../../shared/toast.js";
import { getActiveEmployee } from "../../firebase/auth.js";

export async function renderCategoriesPage(container) {
  container.innerHTML = `
    <div class="pm-page">
      <div class="pm-header"><h1>หมวดหมู่สินค้า</h1></div>
      <div id="cat-add-row" style="display:flex; gap:8px; margin-bottom:14px;">
        <input id="cat-new-name" class="pm-input" style="margin-bottom:0" placeholder="ชื่อหมวดหมู่ใหม่" />
        <button id="cat-add-btn" class="pm-btn" style="width:auto; padding:0 20px;">เพิ่ม</button>
      </div>
      <div id="cat-list" class="pm-loading">กำลังโหลด...</div>
    </div>
  `;

  const listEl = container.querySelector("#cat-list");
  const addBtn = container.querySelector("#cat-add-btn");
  const nameInput = container.querySelector("#cat-new-name");

  async function refresh() {
    listEl.innerHTML = `<div class="pm-loading">กำลังโหลด...</div>`;
    try {
      const categories = await listCategories({ includeInactive: true });
      if (categories.length === 0) {
        listEl.innerHTML = `<div class="pm-empty">ยังไม่มีหมวดหมู่ — เพิ่มหมวดหมู่แรกของคุณด้านบน</div>`;
        return;
      }
      listEl.innerHTML = "";
      categories.forEach((cat) => {
        const row = document.createElement("div");
        row.className = "pm-card";
        row.innerHTML = `
          <div style="flex:1;">
            <div class="pm-card-title">${escapeHtml(cat.name)}</div>
            <span class="pm-badge ${cat.status === "ACTIVE" ? "pm-badge--active" : "pm-badge--inactive"}">
              ${cat.status === "ACTIVE" ? "ใช้งานอยู่" : "ปิดใช้งาน"}
            </span>
          </div>
          <button class="pm-btn pm-btn--secondary pm-btn--icon" data-action="edit" title="แก้ไข">✏️</button>
          <button class="pm-btn pm-btn--danger pm-btn--icon" data-action="delete" title="ลบ">🗑️</button>
        `;
        row.querySelector('[data-action="edit"]').addEventListener("click", async () => {
          const newName = prompt("แก้ไขชื่อหมวดหมู่", cat.name);
          if (newName === null) return;
          const emp = getActiveEmployee();
          try {
            await updateCategory(cat.id, newName, emp?.employeeId || "unknown");
            showToast("แก้ไขหมวดหมู่สำเร็จ");
            refresh();
          } catch (err) {
            showToast(err.message, "error");
          }
        });
        row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
          if (!confirm(`ต้องการลบหมวดหมู่ "${cat.name}" ใช่หรือไม่?`)) return;
          const emp = getActiveEmployee();
          try {
            const result = await deleteCategorySafely(cat.id, emp?.employeeId || "unknown");
            showToast(
              result.deleted
                ? "ลบหมวดหมู่สำเร็จ"
                : "หมวดหมู่นี้มีสินค้าอยู่ จึงเปลี่ยนเป็นปิดใช้งานแทนการลบ"
            );
            refresh();
          } catch (err) {
            showToast(err.message, "error");
          }
        });
        listEl.appendChild(row);
      });
    } catch (err) {
      listEl.innerHTML = `<div class="pm-error">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
    }
  }

  addBtn.addEventListener("click", () => {
    withLoading(addBtn, async () => {
      const emp = getActiveEmployee();
      await createCategory(nameInput.value, emp?.employeeId || "unknown");
      nameInput.value = "";
      showToast("เพิ่มหมวดหมู่สำเร็จ");
      await refresh();
    }, { loadingText: "กำลังเพิ่ม..." });
  });

  await refresh();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
