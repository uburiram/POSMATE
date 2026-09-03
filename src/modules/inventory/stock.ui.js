// src/modules/inventory/stock.ui.js
// หน้ารับสินค้าเข้าคลัง / ปรับ Stock / ดูประวัติ Stock Movement ของสินค้าหนึ่งชิ้น

import { receiveStock, adjustStock, listStockMovements } from "./stock.js";
import { getProduct } from "../products/products.js";
import { showToast, withLoading } from "../../shared/toast.js";
import { getActiveEmployee } from "../../firebase/auth.js";

const MOVEMENT_LABEL = {
  STOCK_IN: "รับสินค้าเข้า",
  SALE: "ขายสินค้า",
  ADJUST: "ปรับ Stock",
  RETURN: "คืนสินค้า",
};

export async function renderStockDetailPage(container, { productId, onBack }) {
  const product = await getProduct(productId);

  container.innerHTML = `
    <div class="pm-page">
      <div class="pm-header">
        <h1>${escapeHtml(product.name)}</h1>
        <button id="sk-back" class="pm-btn pm-btn--secondary" style="width:auto; padding:0 16px; min-height:40px;">กลับ</button>
      </div>

      <div class="pm-card" style="justify-content:space-between;">
        <div>
          <div class="pm-card-sub">Stock คงเหลือ</div>
          <div style="font-size:28px; font-weight:700;">${product.stockQty} ${product.unit || ""}</div>
        </div>
      </div>

      <div style="display:flex; gap:10px; margin: 14px 0;">
        <button id="sk-tab-in" class="pm-btn">รับสินค้าเข้า</button>
        <button id="sk-tab-adjust" class="pm-btn pm-btn--secondary">ปรับ Stock</button>
      </div>

      <div id="sk-form-area"></div>

      <h2 style="font-size:16px; margin-top:20px;">ประวัติ Stock Movement</h2>
      <div id="sk-movements" class="pm-loading">กำลังโหลด...</div>
    </div>
  `;

  container.querySelector("#sk-back").addEventListener("click", onBack);

  const formArea = container.querySelector("#sk-form-area");
  const tabIn = container.querySelector("#sk-tab-in");
  const tabAdjust = container.querySelector("#sk-tab-adjust");

  function showStockInForm() {
    tabIn.className = "pm-btn";
    tabAdjust.className = "pm-btn pm-btn--secondary";
    formArea.innerHTML = `
      <label class="pm-label">จำนวนที่รับเข้า *</label>
      <input id="in-qty" type="number" min="1" class="pm-input" />
      <label class="pm-label">ราคาทุนใหม่ (ถ้ามีการเปลี่ยนแปลง)</label>
      <input id="in-cost" type="number" step="0.01" min="0" class="pm-input" placeholder="${product.costPrice}" />
      <label class="pm-label">Supplier</label>
      <input id="in-supplier" class="pm-input" />
      <label class="pm-label">เลขเอกสาร</label>
      <input id="in-doc" class="pm-input" />
      <label class="pm-label">หมายเหตุ</label>
      <textarea id="in-note" class="pm-textarea" rows="2"></textarea>
      <button id="in-submit" class="pm-btn">บันทึกรับสินค้าเข้า</button>
    `;
    formArea.querySelector("#in-submit").addEventListener("click", () => {
      const btn = formArea.querySelector("#in-submit");
      withLoading(btn, async () => {
        const qty = parseInt(formArea.querySelector("#in-qty").value, 10);
        const emp = getActiveEmployee();
        await receiveStock({
          productId,
          qty,
          costPrice: formArea.querySelector("#in-cost").value
            ? parseFloat(formArea.querySelector("#in-cost").value)
            : null,
          supplier: formArea.querySelector("#in-supplier").value,
          docNumber: formArea.querySelector("#in-doc").value,
          note: formArea.querySelector("#in-note").value,
          performedBy: emp?.employeeId || "unknown",
        });
        showToast("รับสินค้าเข้าคลังสำเร็จ");
        await renderStockDetailPage(container, { productId, onBack });
      });
    });
  }

  function showAdjustForm() {
    tabAdjust.className = "pm-btn";
    tabIn.className = "pm-btn pm-btn--secondary";
    formArea.innerHTML = `
      <label class="pm-label">Stock ปัจจุบัน: ${product.stockQty}</label>
      <label class="pm-label">ปรับ Stock เป็นจำนวน *</label>
      <input id="adj-qty" type="number" min="0" class="pm-input" value="${product.stockQty}" />
      <label class="pm-label">เหตุผล * (บังคับกรอก)</label>
      <select id="adj-reason" class="pm-select">
        <option value="">-- เลือกเหตุผล --</option>
        <option value="สินค้าเสีย">สินค้าเสีย</option>
        <option value="สินค้าหาย">สินค้าหาย</option>
        <option value="นับ Stock ใหม่">นับ Stock ใหม่</option>
        <option value="ใช้ภายในร้าน">ใช้ภายในร้าน</option>
        <option value="แก้ไขจำนวนผิด">แก้ไขจำนวนผิด</option>
        <option value="อื่นๆ">อื่นๆ</option>
      </select>
      <label class="pm-label">หมายเหตุเพิ่มเติม</label>
      <textarea id="adj-note" class="pm-textarea" rows="2"></textarea>
      <button id="adj-submit" class="pm-btn pm-btn--danger">บันทึกการปรับ Stock</button>
    `;
    formArea.querySelector("#adj-submit").addEventListener("click", () => {
      const btn = formArea.querySelector("#adj-submit");
      withLoading(btn, async () => {
        const newQty = parseInt(formArea.querySelector("#adj-qty").value, 10);
        const reason = formArea.querySelector("#adj-reason").value;
        if (!reason) throw new Error("กรุณาเลือกเหตุผลในการปรับ Stock");
        const emp = getActiveEmployee();
        await adjustStock({
          productId,
          newQty,
          reason,
          note: formArea.querySelector("#adj-note").value,
          performedBy: emp?.employeeId || "unknown",
        });
        showToast("ปรับ Stock สำเร็จ");
        await renderStockDetailPage(container, { productId, onBack });
      });
    });
  }

  tabIn.addEventListener("click", showStockInForm);
  tabAdjust.addEventListener("click", showAdjustForm);
  showStockInForm();

  const movementsEl = container.querySelector("#sk-movements");
  try {
    const movements = await listStockMovements(productId);
    if (movements.length === 0) {
      movementsEl.innerHTML = `<div class="pm-empty">ยังไม่มีประวัติการเคลื่อนไหว Stock</div>`;
    } else {
      movementsEl.innerHTML = "";
      movements.forEach((m) => {
        const row = document.createElement("div");
        row.className = "pm-card";
        const sign = m.qtyChange > 0 ? "+" : "";
        const date = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString("th-TH") : "-";
        row.innerHTML = `
          <div style="flex:1;">
            <div class="pm-card-title">${MOVEMENT_LABEL[m.type] || m.type} ${sign}${m.qtyChange}</div>
            <div class="pm-card-sub">${m.qtyBefore} → ${m.qtyAfter} · ${escapeHtml(m.reason || "")}</div>
            <div class="pm-card-sub">${date}</div>
          </div>
        `;
        movementsEl.appendChild(row);
      });
    }
  } catch (err) {
    movementsEl.innerHTML = `<div class="pm-error">โหลดประวัติไม่สำเร็จ: ${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
