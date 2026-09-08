/**
 * POSMATE — Products / Categories / Stock UI (v1.0.12)
 */
import {
  listCategories, saveCategory, getCategory, countProductsInCategory,
  listProducts, getProduct, getProductByBarcode, saveProduct, generateNextSku,
  uploadProductImage, stockIn, adjustStock, listInventoryTransactions,
  getLowStockProducts, writeAuditLog
} from './db.js';
import {
  getCurrentUser, getCurrentEmployee, getCurrentShopId, hasRole
} from './auth.js';
import {
  showToast, showLoading, hideLoading, escapeHtml, formatMoney, formatDateTime,
  generateId, compressImage, productStatusLabel, movementTypeLabel, debounce,
  firestoreErrorHtml, isFirestoreIndexError
} from './utils.js';
import { startScanner, stopScanner, normalizeBarcode } from './pos.js';
import { lookupProductByBarcode, sourceLabel } from './barcode-lookup.js';
import { getBarcodeCatalog, upsertBarcodeCatalog } from './db-catalog.js';
import * as ui from './app-state.js';
import { $, pageContent, navigate } from './app-state.js';

let productFilter = { search: '', status: 'ALL', categoryId: '' };

export async function renderProducts() {
  if (!hasRole('ADMIN', 'MANAGER')) {
    pageContent.innerHTML = '<div class="card"><p>เฉพาะ Admin / Manager เท่านั้น</p></div>';
    return;
  }
  showLoading('โหลดสินค้า...');
  const shopId = getCurrentShopId();
  let products = [];
  let categories = [];
  try {
    [products, categories] = await Promise.all([
      listProducts(shopId, {
        status: productFilter.status,
        categoryId: productFilter.categoryId || null,
        search: productFilter.search || null
      }),
      listCategories(shopId)
    ]);
  } catch (err) {
    hideLoading();
    console.error(err);
    pageContent.innerHTML = firestoreErrorHtml(err, { title: 'สินค้า', retryId: 'btn-retry-products' });
    $('#btn-retry-products')?.addEventListener('click', () => renderProducts());
    return;
  }
  hideLoading();
  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.15rem;">สินค้า</h2>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-outline btn-sm" id="btn-manage-cat">หมวดหมู่</button>
        <button class="btn btn-primary btn-sm" id="btn-add-product">+ เพิ่ม</button>
      </div>
    </div>
    <div class="card mb-2" style="padding:10px;">
      <input type="search" id="product-search" class="form-control" placeholder="ค้นหาชื่อ / barcode / SKU" value="${escapeHtml(productFilter.search)}" style="margin-bottom:8px;">
      <div style="display:flex;gap:8px;">
        <select id="product-status-filter" class="form-control" style="flex:1;">
          <option value="ALL" ${productFilter.status === 'ALL' ? 'selected' : ''}>ทุกสถานะ</option>
          <option value="ACTIVE" ${productFilter.status === 'ACTIVE' ? 'selected' : ''}>ใช้งาน</option>
          <option value="INACTIVE" ${productFilter.status === 'INACTIVE' ? 'selected' : ''}>ปิด</option>
          <option value="OUT_OF_STOCK" ${productFilter.status === 'OUT_OF_STOCK' ? 'selected' : ''}>หมดสต็อก</option>
        </select>
        <select id="product-cat-filter" class="form-control" style="flex:1;">
          <option value="">ทุกหมวด</option>
          ${categories.map(c => `<option value="${escapeHtml(c.id)}" ${productFilter.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="product-list">
      ${products.length === 0 ? `<div class="card text-center text-muted"><p>ยังไม่มีสินค้า</p><button class="btn btn-primary btn-sm mt-1" id="btn-add-empty">เพิ่มสินค้าแรก</button></div>` : products.map(p => {
        const stock = Number(p.stock) || 0;
        const low = stock > 0 && stock <= (Number(p.minStock) || 5);
        return `<div class="card" data-id="${escapeHtml(p.id)}" style="margin-bottom:8px;padding:12px;cursor:pointer;">
          <div class="flex-between"><div style="flex:1;min-width:0;"><strong style="display:block;">${escapeHtml(p.name)}</strong>
          <div class="text-muted" style="font-size:0.8rem;">${p.barcode ? escapeHtml(p.barcode) + ' · ' : ''}${escapeHtml(catMap[p.categoryId] || '-')}</div></div>
          <div style="text-align:right;"><div style="font-weight:700;color:var(--primary);">฿${formatMoney(p.sellPrice)}</div>
          <div style="font-size:0.8rem;color:${stock <= 0 ? 'var(--danger)' : low ? '#b45309' : 'inherit'};">คงเหลือ ${stock}</div></div></div></div>`;
      }).join('')}
    </div>`;
  $('#btn-add-product')?.addEventListener('click', () => openProductForm(null));
  $('#btn-add-empty')?.addEventListener('click', () => openProductForm(null));
  $('#btn-manage-cat')?.addEventListener('click', () => renderCategories());
  const apply = debounce(() => {
    productFilter.search = $('#product-search')?.value.trim() || '';
    productFilter.status = $('#product-status-filter')?.value || 'ALL';
    productFilter.categoryId = $('#product-cat-filter')?.value || '';
    renderProducts();
  }, 400);
  $('#product-search')?.addEventListener('input', apply);
  $('#product-status-filter')?.addEventListener('change', apply);
  $('#product-cat-filter')?.addEventListener('change', apply);
  pageContent.querySelectorAll('.card[data-id]').forEach(card => {
    card.addEventListener('click', () => openProductDetail(card.dataset.id));
  });
}

export async function openProductDetail(productId) {
  showLoading();
  const product = await getProduct(productId);
  hideLoading();
  if (!product) { showToast('ไม่พบสินค้า', 'error'); return renderProducts(); }
  const stock = Number(product.stock) || 0;
  pageContent.innerHTML = `
    <div class="flex-between mb-2"><h2 style="font-size:1.1rem;">${escapeHtml(product.name)}</h2>
      <button class="btn btn-outline btn-sm" id="btn-back-products">กลับ</button></div>
    <div class="card mb-2">
      <p class="text-muted" style="font-size:0.85rem;">SKU: ${escapeHtml(product.sku || '-')}<br>Barcode: ${escapeHtml(product.barcode || '-')}<br>
        หน่วย: ${escapeHtml(product.unit || 'ชิ้น')}<br>สถานะ: ${productStatusLabel(product.status)}</p>
      <div class="grid-2" style="gap:8px;margin-top:10px;">
        <div class="stat-box"><div class="stat-label">ราคาทุน</div><div class="stat-value">฿${formatMoney(product.costPrice)}</div></div>
        <div class="stat-box"><div class="stat-label">ราคาขาย</div><div class="stat-value" style="color:var(--primary);">฿${formatMoney(product.sellPrice)}</div></div>
        <div class="stat-box"><div class="stat-label">คงเหลือ</div><div class="stat-value">${stock}</div></div>
        <div class="stat-box"><div class="stat-label">แจ้งเตือนเมื่อ</div><div class="stat-value">≤ ${product.minStock != null ? product.minStock : 5}</div></div>
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="btn-edit-product">แก้ไขสินค้า</button>
    <button class="btn btn-outline btn-block mt-1" id="btn-stock-in">รับสินค้าเข้า</button>
    <button class="btn btn-outline btn-block mt-1" id="btn-adjust-stock">ปรับ Stock</button>
    <button class="btn btn-outline btn-block mt-1" id="btn-stock-hist">ประวัติ Stock</button>`;
  $('#btn-back-products')?.addEventListener('click', () => renderProducts());
  $('#btn-edit-product')?.addEventListener('click', () => openProductForm(productId));
  $('#btn-stock-in')?.addEventListener('click', () => openStockInForm(productId));
  $('#btn-adjust-stock')?.addEventListener('click', () => openAdjustStockForm(productId));
  $('#btn-stock-hist')?.addEventListener('click', () => openStockHistory(productId));
}

export async function openProductForm(productId) {
  showLoading();
  const [product, categories] = await Promise.all([
    productId ? getProduct(productId) : null,
    listCategories(getCurrentShopId())
  ]);
  hideLoading();
  ui.setProductScannerOpen(false);

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:16px;">${product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h2>
      <form id="product-form">
        <div class="form-group">
          <label>Barcode</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="p-barcode" class="form-control" value="${escapeHtml(product?.barcode || '')}" placeholder="สแกนหรือพิมพ์" style="flex:1;" inputmode="numeric">
            <button type="button" class="btn btn-primary" id="btn-scan-product-bc" style="white-space:nowrap;min-width:96px;">📷 สแกน</button>
          </div>
          <small class="text-muted">กดสแกนเพื่อเปิดกล้อง หรือพิมพ์แล้วกดออกจากช่องเพื่อดึงชื่ออัตโนมัติ</small>
        </div>
        <div id="product-scan-box" class="hidden" style="margin-bottom:12px;">
          <div id="product-scanner-region" class="scanner-region" style="min-height:180px;"></div>
          <button type="button" class="btn btn-outline btn-block mt-1" id="btn-close-product-scan">ปิดกล้อง</button>
        </div>
        <div class="form-group">
          <label>ชื่อสินค้า *</label>
          <input type="text" id="p-name" class="form-control" value="${escapeHtml(product?.name || '')}" required>
        </div>
        <div class="form-group">
          <label>หมวดหมู่ *</label>
          <select id="p-category" class="form-control">
            <option value="">— เลือกหมวดหมู่ —</option>
            ${categories.filter(c => c.status !== 'INACTIVE').map(c => `<option value="${escapeHtml(c.id)}" ${product?.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>รายละเอียด</label>
          <textarea id="p-desc" class="form-control" rows="2">${escapeHtml(product?.description || '')}</textarea>
        </div>
        <div class="grid-2" style="gap:10px;">
          <div class="form-group"><label>ราคาทุน (บาท) *</label>
            <input type="number" id="p-cost" class="form-control" value="${product?.costPrice != null ? product.costPrice : ''}" min="0" step="0.01" required></div>
          <div class="form-group"><label>ราคาขาย (บาท) *</label>
            <input type="number" id="p-sell" class="form-control" value="${product?.sellPrice != null ? product.sellPrice : ''}" min="0" step="0.01" required></div>
        </div>
        <div class="grid-2" style="gap:10px;">
          <div class="form-group"><label>จำนวน Stock เริ่มต้น</label>
            <input type="number" id="p-stock" class="form-control" value="${product ? (product.stock != null ? product.stock : 0) : 0}" min="0" step="1" ${product ? 'readonly' : ''}></div>
          <div class="form-group"><label>หน่วยนับ</label>
            <input type="text" id="p-unit" class="form-control" value="${escapeHtml(product?.unit || 'ชิ้น')}" placeholder="ชิ้น"></div>
        </div>
        <div class="form-group"><label>จุดแจ้งเตือน Stock ต่ำ</label>
          <input type="number" id="p-min" class="form-control" value="${product?.minStock != null ? product.minStock : 5}" min="0" step="1"></div>
        <div class="form-group"><label>สถานะ</label>
          <select id="p-status" class="form-control">
            <option value="ACTIVE" ${!product || product.status === 'ACTIVE' ? 'selected' : ''}>ใช้งาน</option>
            <option value="INACTIVE" ${product?.status === 'INACTIVE' ? 'selected' : ''}>ปิดการใช้งาน</option>
            <option value="OUT_OF_STOCK" ${product?.status === 'OUT_OF_STOCK' ? 'selected' : ''}>หมดสต็อก</option>
          </select></div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">บันทึก</button>
        <button type="button" class="btn btn-outline btn-block mt-1" id="btn-cancel-product">ยกเลิก</button>
      </form>
    </div>`;

  async function applyBarcodeLookup(code) {
    if (!code) return;
    showLoading('ค้นหาบาร์โค้ด...');
    try {
      const info = await lookupProductByBarcode(code, { getCatalog: getBarcodeCatalog });
      hideLoading();
      if (!info || !info.name) {
        showToast('ไม่พบข้อมูลบาร์โค้ด — กรอกชื่อเองได้', 'info');
        return;
      }
      if (!$('#p-name')?.value.trim()) $('#p-name').value = info.name || '';
      if (info.brand && !$('#p-desc')?.value.trim()) {
        $('#p-desc').value = [info.brand, info.quantity].filter(Boolean).join(' · ');
      }
      showToast('ดึงข้อมูล: ' + (info.name || '') + (info.source ? ' (' + sourceLabel(info.source) + ')' : ''), 'success');
      try { await upsertBarcodeCatalog(code, info); } catch (e) {}
    } catch (err) {
      hideLoading();
      console.warn(err);
      showToast('ค้นหาบาร์โค้ดไม่สำเร็จ', 'error');
    }
  }

  async function openProductScanner() {
    if (ui.productScannerOpen) return;
    ui.setProductScannerOpen(true);
    const box = document.getElementById('product-scan-box');
    box?.classList.remove('hidden');
    try {
      await startScanner('product-scanner-region', async (code) => {
        const bc = normalizeBarcode(code);
        if (!bc) return;
        const el = document.getElementById('p-barcode');
        if (el) el.value = bc;
        await stopScanner().catch(() => {});
        ui.setProductScannerOpen(false);
        box?.classList.add('hidden');
        await applyBarcodeLookup(bc);
      }, { qrbox: { width: 280, height: 160 } });
    } catch (e) {
      ui.setProductScannerOpen(false);
      box?.classList.add('hidden');
      showToast(e.message || 'เปิดกล้องไม่สำเร็จ — อนุญาตกล้องในเบราว์เซอร์แล้วลองใหม่', 'error');
    }
  }

  $('#btn-cancel-product')?.addEventListener('click', () => productId ? openProductDetail(productId) : renderProducts());
  $('#product-form')?.addEventListener('submit', async (e) => { e.preventDefault(); await saveProductForm(productId); });
  $('#btn-scan-product-bc')?.addEventListener('click', openProductScanner);
  $('#btn-close-product-scan')?.addEventListener('click', async () => {
    await stopScanner().catch(() => {});
    ui.setProductScannerOpen(false);
    document.getElementById('product-scan-box')?.classList.add('hidden');
  });
  $('#p-barcode')?.addEventListener('change', async () => {
    const bc = normalizeBarcode($('#p-barcode')?.value || '');
    if (bc) await applyBarcodeLookup(bc);
  });
}

export async function saveProductForm(productId) {
  const name = $('#p-name')?.value.trim();
  const categoryId = $('#p-category')?.value;
  const costPrice = parseFloat($('#p-cost')?.value);
  const sellPrice = parseFloat($('#p-sell')?.value);
  if (!name) { showToast('กรุณาระบุชื่อสินค้า', 'error'); return; }
  if (!categoryId) { showToast('กรุณาเลือกหมวดหมู่', 'error'); return; }
  if (isNaN(costPrice) || isNaN(sellPrice)) { showToast('กรุณาระบุราคา', 'error'); return; }
  const data = {
    shopId: getCurrentShopId(),
    name,
    categoryId,
    barcode: $('#p-barcode')?.value.trim() || null,
    description: $('#p-desc')?.value.trim() || '',
    costPrice,
    sellPrice,
    unit: $('#p-unit')?.value.trim() || 'ชิ้น',
    minStock: parseInt($('#p-min')?.value, 10) || 5,
    status: $('#p-status')?.value || 'ACTIVE',
    stock: productId ? undefined : (parseInt($('#p-stock')?.value, 10) || 0)
  };
  showLoading('กำลังบันทึก...');
  try {
    const id = await saveProduct(productId, data);
    hideLoading();
    showToast('บันทึกสินค้าสำเร็จ', 'success');
    openProductDetail(id || productId);
  } catch (err) {
    hideLoading();
    showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
  }
}

export async function openStockInForm(productId) {
  const product = await getProduct(productId);
  if (!product) return;
  pageContent.innerHTML = `<div class="card"><h2 style="font-size:1.1rem;">รับสินค้าเข้า</h2>
    <p class="text-muted">${escapeHtml(product.name)} · คงเหลือ ${product.stock || 0}</p>
    <div class="form-group"><label>จำนวน *</label><input type="number" id="si-qty" class="form-control" min="1" step="1" value="1" inputmode="numeric"></div>
    <div class="form-group"><label>ราคาทุนต่อหน่วย</label><input type="number" id="si-cost" class="form-control" min="0" step="0.01" value="${product.costPrice != null ? product.costPrice : ''}"></div>
    <div class="form-group"><label>หมายเหตุ</label><input type="text" id="si-note" class="form-control"></div>
    <button class="btn btn-primary btn-block" id="btn-si-save">บันทึกรับเข้า</button>
    <button class="btn btn-outline btn-block mt-1" id="btn-si-back">กลับ</button></div>`;
  $('#btn-si-back')?.addEventListener('click', () => openProductDetail(productId));
  $('#btn-si-save')?.addEventListener('click', async () => {
    const qty = parseInt($('#si-qty')?.value, 10);
    if (!qty || qty <= 0) { showToast('ระบุจำนวน', 'error'); return; }
    showLoading();
    try {
      await stockIn({ shopId: getCurrentShopId(), productId, quantity: qty, costPrice: parseFloat($('#si-cost')?.value) || product.costPrice, note: $('#si-note')?.value.trim() || '', employeeId: getCurrentEmployee()?.id, userId: getCurrentUser()?.uid });
      hideLoading(); showToast('รับเข้าสำเร็จ', 'success'); openProductDetail(productId);
    } catch (err) { hideLoading(); showToast(err.message || 'ไม่สำเร็จ', 'error'); }
  });
}

export async function openAdjustStockForm(productId) {
  const product = await getProduct(productId);
  if (!product) return;
  pageContent.innerHTML = `<div class="card"><h2 style="font-size:1.1rem;">ปรับ Stock</h2>
    <p class="text-muted">${escapeHtml(product.name)} · คงเหลือปัจจุบัน ${product.stock || 0}</p>
    <div class="form-group"><label>จำนวนใหม่ *</label><input type="number" id="adj-stock" class="form-control" min="0" step="1" value="${product.stock || 0}" inputmode="numeric"></div>
    <div class="form-group"><label>เหตุผล *</label><input type="text" id="adj-reason" class="form-control" placeholder="เช่น นับสต็อก / ของเสีย"></div>
    <button class="btn btn-primary btn-block" id="btn-adj-save">บันทึก</button>
    <button class="btn btn-outline btn-block mt-1" id="btn-adj-back">กลับ</button></div>`;
  $('#btn-adj-back')?.addEventListener('click', () => openProductDetail(productId));
  $('#btn-adj-save')?.addEventListener('click', async () => {
    const newStock = parseInt($('#adj-stock')?.value, 10);
    const reason = $('#adj-reason')?.value.trim();
    if (isNaN(newStock) || newStock < 0) { showToast('ระบุจำนวนให้ถูกต้อง', 'error'); return; }
    if (!reason) { showToast('ระบุเหตุผล', 'error'); return; }
    if (!confirm('ยืนยันปรับ Stock จาก ' + (product.stock || 0) + ' เป็น ' + newStock + '?')) return;
    showLoading();
    try {
      await adjustStock({ shopId: getCurrentShopId(), productId, newStock, reason, employeeId: getCurrentEmployee()?.id, userId: getCurrentUser()?.uid });
      hideLoading(); showToast('ปรับ Stock สำเร็จ', 'success'); openProductDetail(productId);
    } catch (err) { hideLoading(); showToast(err.message || 'ไม่สำเร็จ', 'error'); }
  });
}

export async function openStockHistory(productId) {
  showLoading();
  const [product, moves] = await Promise.all([getProduct(productId), listInventoryTransactions(getCurrentShopId(), productId, 50)]);
  hideLoading();
  pageContent.innerHTML = `<div class="flex-between mb-2"><h2 style="font-size:1.1rem;">ประวัติ Stock</h2>
    <button class="btn btn-outline btn-sm" id="btn-sh-back">กลับ</button></div>
    <p class="text-muted mb-2">${escapeHtml(product?.name || '')}</p>
    ${!moves.length ? '<div class="card text-muted text-center">ยังไม่มีรายการ</div>' : moves.map(m => {
      const diff = (m.afterStock != null ? m.afterStock : 0) - (m.beforeStock != null ? m.beforeStock : 0);
      return `<div class="card" style="margin-bottom:8px;padding:10px;"><div class="flex-between"><strong>${movementTypeLabel(m.type)}</strong><span>${diff >= 0 ? '+' : ''}${diff}</span></div>
        <div class="text-muted" style="font-size:0.8rem;">${formatDateTime(m.createdAt)} · ${m.beforeStock != null ? m.beforeStock : '-'} → ${m.afterStock != null ? m.afterStock : '-'}</div>
        ${m.note ? `<div style="font-size:0.85rem;">${escapeHtml(m.note)}</div>` : ''}</div>`;
    }).join('')}`;
  $('#btn-sh-back')?.addEventListener('click', () => openProductDetail(productId));
}

export async function renderCategories() {
  showLoading();
  let categories = [];
  try { categories = await listCategories(getCurrentShopId()); } catch (e) { console.error(e); }
  hideLoading();
  pageContent.innerHTML = `<div class="flex-between mb-2"><h2 style="font-size:1.15rem;">หมวดหมู่</h2>
    <div style="display:flex;gap:6px;"><button class="btn btn-outline btn-sm" id="btn-cat-back">สินค้า</button>
    <button class="btn btn-primary btn-sm" id="btn-cat-add">+ เพิ่ม</button></div></div>
    ${!categories.length ? '<div class="card text-center text-muted">ยังไม่มีหมวดหมู่</div>' : categories.map(c => `<div class="card" style="margin-bottom:8px;padding:12px;cursor:pointer;" data-cid="${escapeHtml(c.id)}">
      <strong>${escapeHtml(c.name)}</strong><div class="text-muted" style="font-size:0.8rem;">${c.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด'} · ลำดับ ${c.sortOrder != null ? c.sortOrder : 0}</div></div>`).join('')}`;
  $('#btn-cat-back')?.addEventListener('click', () => renderProducts());
  $('#btn-cat-add')?.addEventListener('click', () => openCategoryForm(null));
  pageContent.querySelectorAll('[data-cid]').forEach(el => el.addEventListener('click', () => openCategoryForm(el.dataset.cid)));
}

export async function openCategoryForm(categoryId) {
  const cat = categoryId ? await getCategory(categoryId) : null;
  pageContent.innerHTML = `<div class="card"><h2 style="font-size:1.1rem;">${cat ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่'}</h2>
    <div class="form-group"><label>ชื่อ *</label><input type="text" id="c-name" class="form-control" value="${escapeHtml(cat?.name || '')}"></div>
    <div class="form-group"><label>ลำดับ</label><input type="number" id="c-sort" class="form-control" value="${cat?.sortOrder != null ? cat.sortOrder : 0}" step="1"></div>
    <div class="form-group"><label>สถานะ</label><select id="c-status" class="form-control">
      <option value="ACTIVE" ${!cat || cat.status === 'ACTIVE' ? 'selected' : ''}>ใช้งาน</option>
      <option value="INACTIVE" ${cat?.status === 'INACTIVE' ? 'selected' : ''}>ปิด</option></select></div>
    <button class="btn btn-primary btn-block" id="btn-c-save">บันทึก</button>
    <button class="btn btn-outline btn-block mt-1" id="btn-c-back">กลับ</button></div>`;
  $('#btn-c-back')?.addEventListener('click', () => renderCategories());
  $('#btn-c-save')?.addEventListener('click', async () => {
    const name = $('#c-name')?.value.trim();
    if (!name) { showToast('ระบุชื่อหมวดหมู่', 'error'); return; }
    showLoading();
    try {
      await saveCategory(categoryId, { shopId: getCurrentShopId(), name, sortOrder: parseInt($('#c-sort')?.value, 10) || 0, status: $('#c-status')?.value || 'ACTIVE' });
      hideLoading(); showToast('บันทึกหมวดหมู่สำเร็จ', 'success'); renderCategories();
    } catch (err) { hideLoading(); showToast(err.message || 'บันทึกไม่สำเร็จ', 'error'); }
  });
}
