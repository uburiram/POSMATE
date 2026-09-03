// src/modules/products/productForm.ui.js
// ฟอร์มเพิ่ม/แก้ไขสินค้า — แยกราคาทุน/ราคาขายชัดเจน, อัปโหลดรูปพร้อม Preview

import {
  getProduct,
  createProduct,
  updateProduct,
  uploadProductImage,
} from "./products.js";
import { listCategories } from "./categories.js";
import { showToast, withLoading } from "../../shared/toast.js";
import { getActiveEmployee } from "../../firebase/auth.js";

export async function renderProductFormPage(container, { productId, onDone, onCancel }) {
  const isEdit = !!productId;
  container.innerHTML = `
    <div class="pm-page">
      <div class="pm-header">
        <h1>${isEdit ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</h1>
        <button id="pf-cancel" class="pm-btn pm-btn--secondary" style="width:auto; padding:0 16px; min-height:40px;">ยกเลิก</button>
      </div>

      <div style="text-align:center; margin-bottom:14px;">
        <img id="pf-preview" src="" style="width:100px; height:100px; border-radius:12px; object-fit:cover; background:#eee; display:none;" />
        <input type="file" id="pf-image" accept="image/*" capture="environment" class="pm-input" />
      </div>

      <label class="pm-label">ชื่อสินค้า *</label>
      <input id="pf-name" class="pm-input" placeholder="เช่น น้ำดื่ม 600ml" />

      <label class="pm-label">Barcode</label>
      <input id="pf-barcode" class="pm-input" placeholder="สแกนหรือพิมพ์ Barcode" />

      <label class="pm-label">SKU / รหัสร้าน</label>
      <input id="pf-sku" class="pm-input" placeholder="รหัสสินค้าของร้าน (ถ้ามี)" />

      <label class="pm-label">หมวดหมู่</label>
      <select id="pf-category" class="pm-select"><option value="">-- เลือกหมวดหมู่ --</option></select>

      <div style="display:flex; gap:10px;">
        <div style="flex:1;">
          <label class="pm-label">ราคาทุน (บาท) *</label>
          <input id="pf-cost" type="number" step="0.01" min="0" class="pm-input" />
        </div>
        <div style="flex:1;">
          <label class="pm-label">ราคาขาย (บาท) *</label>
          <input id="pf-sell" type="number" step="0.01" min="0" class="pm-input" />
        </div>
      </div>

      <div style="display:flex; gap:10px;">
        <div style="flex:1;">
          <label class="pm-label">จำนวน Stock ${isEdit ? "(แก้ผ่านหน้ารับสินค้า/ปรับ Stock)" : "เริ่มต้น"} *</label>
          <input id="pf-stock" type="number" min="0" class="pm-input" ${isEdit ? "disabled" : ""} />
        </div>
        <div style="flex:1;">
          <label class="pm-label">หน่วยนับ</label>
          <input id="pf-unit" class="pm-input" placeholder="ชิ้น / ขวด / กล่อง" />
        </div>
      </div>

      <label class="pm-label">แจ้งเตือนเมื่อ Stock เหลือน้อยกว่า</label>
      <input id="pf-threshold" type="number" min="0" class="pm-input" value="5" />

      <label class="pm-label">รายละเอียด</label>
      <textarea id="pf-desc" class="pm-textarea" rows="3"></textarea>

      <button id="pf-save" class="pm-btn">บันทึกสินค้า</button>
    </div>
  `;

  const els = {
    preview: container.querySelector("#pf-preview"),
    image: container.querySelector("#pf-image"),
    name: container.querySelector("#pf-name"),
    barcode: container.querySelector("#pf-barcode"),
    sku: container.querySelector("#pf-sku"),
    category: container.querySelector("#pf-category"),
    cost: container.querySelector("#pf-cost"),
    sell: container.querySelector("#pf-sell"),
    stock: container.querySelector("#pf-stock"),
    unit: container.querySelector("#pf-unit"),
    threshold: container.querySelector("#pf-threshold"),
    desc: container.querySelector("#pf-desc"),
    save: container.querySelector("#pf-save"),
    cancel: container.querySelector("#pf-cancel"),
  };

  let selectedFile = null;
  let currentImageUrl = null;

  const categories = await listCategories();
  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    els.category.appendChild(opt);
  });

  if (isEdit) {
    const product = await getProduct(productId);
    els.name.value = product.name || "";
    els.barcode.value = product.barcode || "";
    els.sku.value = product.sku || "";
    els.category.value = product.categoryId || "";
    els.cost.value = product.costPrice ?? "";
    els.sell.value = product.sellPrice ?? "";
    els.stock.value = product.stockQty ?? 0;
    els.unit.value = product.unit || "ชิ้น";
    els.threshold.value = product.lowStockThreshold ?? 5;
    els.desc.value = product.description || "";
    currentImageUrl = product.imageUrl || null;
    if (currentImageUrl) {
      els.preview.src = currentImageUrl;
      els.preview.style.display = "inline-block";
    }
  } else {
    els.unit.value = "ชิ้น";
  }

  els.image.addEventListener("change", () => {
    const file = els.image.files[0];
    if (!file) return;
    selectedFile = file;
    els.preview.src = URL.createObjectURL(file);
    els.preview.style.display = "inline-block";
  });

  els.cancel.addEventListener("click", onCancel);

  els.save.addEventListener("click", () => {
    withLoading(els.save, async () => {
      const emp = getActiveEmployee();
      const performedBy = emp?.employeeId || "unknown";

      const data = {
        name: els.name.value,
        barcode: els.barcode.value,
        sku: els.sku.value,
        categoryId: els.category.value || null,
        costPrice: parseFloat(els.cost.value),
        sellPrice: parseFloat(els.sell.value),
        stockQty: isEdit ? undefined : parseInt(els.stock.value || "0", 10),
        unit: els.unit.value,
        lowStockThreshold: parseInt(els.threshold.value || "5", 10),
        description: els.desc.value,
      };

      let id = productId;
      if (isEdit) {
        // stockQty ไม่ส่งตอน edit (แก้ผ่านหน้ารับสินค้า/ปรับ Stock เท่านั้น
        // เพื่อให้ Stock Movement ถูกบันทึกเสมอ ไม่มีทางแก้ตัวเลขลอยๆ)
        const existing = await getProduct(productId);
        await updateProduct(productId, { ...data, stockQty: existing.stockQty }, performedBy);
      } else {
        if (data.stockQty < 0 || isNaN(data.stockQty)) {
          throw new Error("กรุณากรอกจำนวน Stock เริ่มต้น");
        }
        id = await createProduct(data, performedBy);
      }

      if (selectedFile) {
        await uploadProductImage(id, selectedFile, currentImageUrl, performedBy);
      }

      showToast(isEdit ? "แก้ไขสินค้าสำเร็จ" : "เพิ่มสินค้าสำเร็จ");
      onDone(id);
    });
  });
}
