/**
 * POSMATE — Products / Categories / Stock UI
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

  const catMap = {};
  categories.forEach(c => { catMap[c.id] = c.name; });

  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.15rem;">สินค้า</h2>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-outline btn-sm" id="btn-manage-cat">หมวดหมู่</button>
        <button class="btn btn-primary btn-sm" id="btn-add-product">+ เพิ่ม</button>
      </div>
    </div>

    <div class="card mb-2" style="padding:10px;">
      <input type="search" id="product-search" class="form-control" placeholder="ค้นหา ชื่อ / barcode / SKU"
        value="${escapeHtml(productFilter.search)}" style="margin-bottom:8px;">
      <div style="display:flex;gap:8px;">
        <select id="product-status-filter" class="form-control" style="flex:1;">
          <option value="ALL" ${productFilter.status === 'ALL' ? 'selected' : ''}>ทุกสถานะ</option>
          <option value="ACTIVE" ${productFilter.status === 'ACTIVE' ? 'selected' : ''}>ใช้งาน</option>
          <option value="OUT_OF_STOCK" ${productFilter.status === 'OUT_OF_STOCK' ? 'selected' : ''}>หมด</option>
          <option value="INACTIVE" ${productFilter.status === 'INACTIVE' ? 'selected' : ''}>ปิด</option>
        </select>
        <select id="product-cat-filter" class="form-control" style="flex:1;">
          <option value="">ทุกหมวด</option>
          ${categories.map(c => `
            <option value="${escapeHtml(c.id)}" ${productFilter.categoryId === c.id ? 'selected' : ''}>
              ${escapeHtml(c.name)}
            </option>
          `).join('')}
        </select>
      </div>
    </div>

    <div id="product-list">
      ${products.length === 0 ? `
        <div class="card text-center text-muted">
          <p>ยังไม่มีสินค้า</p>
          <p style="font-size:0.85rem;">กด "+ เพิ่ม" เพื่อสร้างสินค้าชิ้นแรก</p>
        </div>
      ` : products.map(p => {
        const stock = Number(p.stock) || 0;
        const min = Number(p.minStock) || 0;
        const stockClass = stock <= 0 ? 'text-danger' : (min > 0 && stock <= min ? 'text-warning' : '');
        return `
          <div class="card product-card" data-id="${escapeHtml(p.id)}" style="margin-bottom:10px;cursor:pointer;">
            <div style="display:flex;gap:12px;align-items:center;">
              <div class="product-thumb">
                ${p.imageUrl
                  ? `<img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy">`
                  : `<span style="font-size:1.6rem;">📦</span>`}
              </div>
              <div style="flex:1;min-width:0;">
                <strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${escapeHtml(p.name)}
                </strong>
                <div class="text-muted" style="font-size:0.78rem;">
                  ${p.barcode ? `BC: ${escapeHtml(p.barcode)} · ` : ''}
                  ${catMap[p.categoryId] ? escapeHtml(catMap[p.categoryId]) + ' · ' : ''}
                  ${productStatusLabel(p.status)}
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:0.9rem;">
                  <span>฿${formatMoney(p.sellPrice)}</span>
                  <span class="${stockClass}">คงเหลือ ${stock} ${escapeHtml(p.unit || 'ชิ้น')}</span>
                </div>
              </div>
              <span style="font-size:1.2rem;color:var(--text-muted);">›</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  $('#btn-add-product')?.addEventListener('click', () => openProductForm(null));
  $('#btn-manage-cat')?.addEventListener('click', () => renderCategories());
  pageContent.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => openProductDetail(card.dataset.id));
  });

  const applyFilter = debounce(() => {
    productFilter.search = $('#product-search')?.value.trim() || '';
    productFilter.status = $('#product-status-filter')?.value || 'ALL';
    productFilter.categoryId = $('#product-cat-filter')?.value || '';
    renderProducts();
  }, 350);

  $('#product-search')?.addEventListener('input', applyFilter);
  $('#product-status-filter')?.addEventListener('change', applyFilter);
  $('#product-cat-filter')?.addEventListener('change', applyFilter);
}

export async function openProductDetail(productId) {
  showLoading();
  const product = await getProduct(productId);
  hideLoading();
  if (!product) {
    showToast('ไม่พบสินค้า', 'error');
    return renderProducts();
  }

  const stock = Number(product.stock) || 0;
  const min = Number(product.minStock) || 0;

  pageContent.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:14px;margin-bottom:14px;">
        <div class="product-thumb large">
          ${product.imageUrl
            ? `<img src="${escapeHtml(product.imageUrl)}" alt="">`
            : `<span style="font-size:2.2rem;">📦</span>`}
        </div>
        <div style="flex:1;">
          <h2 style="font-size:1.15rem;margin-bottom:4px;">${escapeHtml(product.name)}</h2>
          <p class="text-muted" style="font-size:0.85rem;">
            ${product.barcode ? `Barcode: ${escapeHtml(product.barcode)}` : 'ไม่มี barcode'}
            ${product.sku ? ` · SKU: ${escapeHtml(product.sku)}` : ''}
          </p>
          <p style="margin-top:6px;">
            <span class="badge ${product.status === 'ACTIVE' ? 'badge-success' : product.status === 'OUT_OF_STOCK' ? 'badge-danger' : 'badge-muted'}">
              ${productStatusLabel(product.status)}
            </span>
          </p>
        </div>
      </div>

      <div class="grid-2" style="gap:8px;margin-bottom:14px;">
        <div class="stat-box">
          <div class="stat-label">ราคาขาย</div>
          <div class="stat-value">฿${formatMoney(product.sellPrice)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">ราคาทุน</div>
          <div class="stat-value">฿${formatMoney(product.costPrice)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">คงเหลือ</div>
          <div class="stat-value ${stock <= 0 ? 'text-danger' : (min > 0 && stock <= min ? 'text-warning' : '')}">
            ${stock} ${escapeHtml(product.unit || 'ชิ้น')}
          </div>
        </div>
        <div class="stat-box">
          <div class="stat-label">จุดแจ้งเตือน</div>
          <div class="stat-value">${min}</div>
        </div>
      </div>

      ${product.description ? `<p class="text-muted" style="font-size:0.85rem;margin-bottom:12px;">${escapeHtml(product.description)}</p>` : ''}

      <button class="btn btn-primary btn-block" id="btn-edit-product">แก้ไขสินค้า</button>
      <div class="grid-2 mt-1" style="gap:8px;">
        <button class="btn btn-outline btn-block" id="btn-stock-in">รับเข้าคลัง</button>
        <button class="btn btn-outline btn-block" id="btn-adjust-stock">ปรับ Stock</button>
      </div>
      <button class="btn btn-outline btn-block mt-1" id="btn-stock-history">ประวัติ Stock</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-back-products">กลับรายการ</button>
    </div>
  `;

  $('#btn-edit-product').addEventListener('click', () => openProductForm(productId));
  $('#btn-stock-in').addEventListener('click', () => openStockInForm(productId));
  $('#btn-adjust-stock').addEventListener('click', () => openAdjustStockForm(productId));
  $('#btn-stock-history').addEventListener('click', () => openStockHistory(productId));
  $('#btn-back-products').addEventListener('click', () => renderProducts());
}

export async function openProductForm(productId) {
  showLoading();
  const [product, categories] = await Promise.all([
    productId ? getProduct(productId) : null,
    listCategories(getCurrentShopId())
  ]);
  hideLoading();

  let ui.productScannerOpen = false;

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
          <small class="text-muted">สแกนแล้วระบบดึงชื่อ/รายละเอียดอัตโนมัติ (ถ้ามีในฐานข้อมูลสินค้าสากล)</small>
        </div>
        <div id="product-scan-box" class="hidden" style="margin-bottom:12px;">
          <div id="product-scanner-region" class="scanner-region"></div>
          <button type="button" class="btn btn-outline btn-block mt-1" id="btn-close-product-scan">ปิดกล้อง</button>
        </div>
        <div class="form-group">
          <label>ชื่อสินค้า *</label>
          <input type="text" id="p-name" class="form-control" value="${escapeHtml(product?.name || '')}" required>
        </div>
        <div class="form-group">
          <label>SKU / รหัสร้าน</label>
          <div style="display:flex;gap:8px;">
            <input type="text" id="p-sku" class="form-control" value="${escapeHtml(product?.sku || '')}" placeholder="สร้างอัตโนมัติ" style="flex:1;" ${product ? '' : 'readonly'}>
            <button type="button" class="btn btn-outline" id="btn-gen-sku" style="white-space:nowrap;">สร้างใหม่</button>
          </div>
          <small class="text-muted">รูปแบบ: หมวด-เลขรัน หรือ หมวด-ท้ายบาร์โค้ด</small>
        </div>
        <div class="form-group">
          <label>หมวดหมู่ *</label>
          <select id="p-category" class="form-control">
            <option value="">— เลือกหมวดหมู่ —</option>
            ${categories.filter(c => c.status !== 'INACTIVE').map(c => `
              <option value="${escapeHtml(c.id)}" ${product?.categoryId === c.id ? 'selected' : ''}>
                ${escapeHtml(c.name)}
              </option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>รายละเอียด</label>
          <textarea id="p-desc" class="form-control" rows="2">${escapeHtml(product?.description || '')}</textarea>
        </div>
        <div class="grid-2" style="gap:10px;">
          <div class="form-group">
            <label>ราคาทุน (บาท) *</label>
            <input type="number" id="p-cost" class="form-control" value="${product?.costPrice ?? ''}" min="0" step="0.01" required>
          </div>
          <div class="form-group">
            <label>ราคาขาย (บาท) *</label>
            <input type="number" id="p-sell" class="form-control" value="${product?.sellPrice ?? ''}" min="0" step="0.01" required>
          </div>
        </div>
        <div class="grid-2" style="gap:10px;">
          <div class="form-group">
            <label>จำนวน Stock เริ่มต้น</label>
            <input type="number" id="p-stock" class="form-control" value="${product ? (product.stock ?? 0) : 0}" min="0" step="1" ${product ? 'readonly' : ''}>
            ${product ? '<small class="text-muted">ใช้ปุ่มรับเข้า/ปรับ Stock เพื่อเปลี่ยนจำนวน</small>' : ''}
          </div>
          <div class="form-group">
            <label>หน่วยนับ</label>
            <input type="text" id="p-unit" class="form-control" value="${escapeHtml(product?.unit || 'ชิ้น')}" placeholder="ชิ้น">
          </div>
        </div>
        <div class="form-group">
          <label>จุดแจ้งเตือน Stock ต่ำ</label>
          <input type="number" id="p-min" class="form-control" value="${product?.minStock ?? 5}" min="0" step="1">
        </div>
        <div class="form-group">
          <label>สถานะ</label>
          <select id="p-status" class="form-control">
            <option value="ACTIVE" ${!product || product.status === 'ACTIVE' ? 'selected' : ''}>ใช้งาน</option>
            <option value="INACTIVE" ${product?.status === 'INACTIVE' ? 'selected' : ''}>ปิดการใช้งาน</option>
            <option value="OUT_OF_STOCK" ${product?.status === 'OUT_OF_STOCK' ? 'selected' : ''}>หมดสต็อก</option>
          </select>
        </div>
        <div class="form-group">
          <label>รูปสินค้า</label>
          <input type="file" id="p-image" class="form-control" accept="image/*" capture="environment">
          <div id="p-image-preview" style="margin-top:8px;">
            ${product?.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" style="max-width:120px;border-radius:8px;">` : ''}
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">บันทึก</button>
        <button type="button" class="btn btn-outline btn-block mt-1" id="btn-cancel-product">ยกเลิก</button>
      </form>
    </div>
  `;

  async function selectedCategoryName() {
    const id = $('#p-category')?.value;
    if (!id) return '';
    const c = categories.find(x => x.id === id);
    return c?.name || '';
  }

  async function fillAutoSku() {
    if (productId && $('#p-sku')?.value.trim()) return; // แก้ไขของเดิมไม่บังคับทับ
    const barcode = normalizeBarcode($('#p-barcode')?.value || '');
    const catName = await selectedCategoryName();
    try {
      const sku = await generateNextSku(getCurrentShopId(), {
        categoryName: catName,
        barcode
      });
      $('#p-sku').value = sku;
    } catch (e) {
      console.warn(e);
    }
  }

  // สินค้าใหม่: สร้าง SKU เริ่มต้น
  if (!productId) {
    fillAutoSku();
  }

  $('#p-category')?.addEventListener('change', () => {
    if (!productId || !$('#p-sku').value.trim()) fillAutoSku();
    else if (!productId) fillAutoSku();
  });

  $('#btn-gen-sku')?.addEventListener('click', async () => {
    $('#p-sku').readOnly = false;
    await fillAutoSku();
    showToast('สร้าง SKU แล้ว', 'success', 1200);
  });

  $('#p-barcode')?.addEventListener('change', async () => {
    const code = normalizeBarcode($('#p-barcode').value);
    if (!code) return;
    await applyBarcodeLookup(code);
    await fillAutoSku();
  });

  async function applyBarcodeLookup(code) {
    showLoading('กำลังค้นหาชื่อสินค้า (ภาษาไทย)...');
    try {
      const existing = await getProductByBarcode(getCurrentShopId(), code);
      if (existing && existing.id !== productId) {
        showToast('บาร์โค้ดนี้มีในร้านแล้ว: ' + (existing.name || ''), 'error');
        hideLoading();
        return;
      }
      const info = await lookupProductByBarcode(code, { getCatalog: getBarcodeCatalog });
      if (info && info.name) {
        if (!productId || !$('#p-name').value.trim()) {
          $('#p-name').value = info.name;
        }
        const descParts = [];
        if (info.brand) descParts.push(info.brand);
        if (info.quantity) descParts.push(info.quantity);
        if (descParts.length && !$('#p-desc').value.trim()) {
          $('#p-desc').value = descParts.join(' · ');
        }
        if (info.imageUrl && $('#p-image-preview')) {
          $('#p-image-preview').innerHTML = `<img src="${escapeHtml(info.imageUrl)}" style="max-width:120px;border-radius:8px;" alt="">`;
        }
        showToast(`ดึงชื่อสินค้าแล้ว (${sourceLabel(info.source)})`, 'success', 2200);
        if ($('#p-name').value.trim()) $('#p-sell')?.focus();
      } else {
        showToast('ยังไม่มีชื่อในฐานข้อมูล — กรอกชื่อภาษาไทยแล้วระบบจะจำบาร์โค้ดนี้', 'info', 3500);
        $('#p-name')?.focus();
      }
    } catch (e) {
      console.warn(e);
      showToast('ค้นหาไม่สำเร็จ — กรอกชื่อภาษาไทยเองได้', 'info');
      $('#p-name')?.focus();
    } finally {
      hideLoading();
    }
  }

  async function openProductScanner() {
    if (ui.productScannerOpen) return;
    ui.setProductScannerOpen(true);
    $('#product-scan-box')?.classList.remove('hidden');
    try {
      await startScanner('product-scanner-region', async (code) => {
        const bc = normalizeBarcode(code);
        if (!bc) return;
        $('#p-barcode').value = bc;
        await stopScanner().catch(() => {});
        ui.setProductScannerOpen(false);
        $('#product-scan-box')?.classList.add('hidden');
        await applyBarcodeLookup(bc);
        await fillAutoSku();
      }, { qrbox: { width: 280, height: 160 } });
    } catch (e) {
      ui.setProductScannerOpen(false);
      $('#product-scan-box')?.classList.add('hidden');
      showToast(e.message || 'เปิดกล้องไม่สำเร็จ', 'error');
    }
  }

  $('#btn-scan-product-bc')?.addEventListener('click', openProductScanner);
  $('#btn-close-product-scan')?.addEventListener('click', async () => {
    await stopScanner().catch(() => {});
    ui.setProductScannerOpen(false);
    $('#product-scan-box')?.classList.add('hidden');
  });

  $('#p-image')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    $('#p-image-preview').innerHTML = `<img src="${url}" style="max-width:120px;border-radius:8px;">`;
  });

  $('#btn-cancel-product').addEventListener('click', async () => {
    await stopScanner().catch(() => {});
    if (productId) openProductDetail(productId);
    else renderProducts();
  });

  $('#product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await stopScanner().catch(() => {});
    await saveProductForm(productId, product);
  });
}

export async function saveProductForm(productId, oldProduct) {
  const name = $('#p-name').value.trim();
  const barcode = $('#p-barcode').value.trim();
  const sku = $('#p-sku').value.trim();
  const categoryId = $('#p-category').value || null;
  const description = $('#p-desc').value.trim();
  const costPrice = parseFloat($('#p-cost').value);
  const sellPrice = parseFloat($('#p-sell').value);
  const unit = $('#p-unit').value.trim() || 'ชิ้น';
  const minStock = parseInt($('#p-min').value, 10) || 0;
  const status = $('#p-status').value;
  const imageFile = $('#p-image').files?.[0];

  if (!name) {
    showToast('กรุณากรอกชื่อสินค้า', 'error');
    return;
  }
  if (!productId && !categoryId) {
    showToast('กรุณาเลือกหมวดหมู่', 'error');
    return;
  }
  if (isNaN(costPrice) || costPrice < 0 || isNaN(sellPrice) || sellPrice < 0) {
    showToast('ราคาไม่ถูกต้อง', 'error');
    return;
  }

  // SKU ว่าง → สร้างอัตโนมัติ
  let finalSku = sku;
  if (!finalSku) {
    const cat = categoryId ? await getCategory(categoryId).catch(() => null) : null;
    finalSku = await generateNextSku(getCurrentShopId(), {
      categoryName: cat?.name || '',
      barcode
    });
  }

  // ตรวจ barcode ซ้ำ
  if (barcode) {
    const existing = await getProductByBarcode(getCurrentShopId(), barcode);
    if (existing && existing.id !== productId) {
      showToast('Barcode นี้มีสินค้าอื่นใช้อยู่แล้ว', 'error');
      return;
    }
  }

  showLoading('กำลังบันทึก...');
  try {
    const shopId = getCurrentShopId();
    const data = {
      shopId,
      name,
      barcode: barcode || null,
      sku: finalSku || null,
      categoryId,
      description: description || null,
      costPrice,
      sellPrice,
      unit,
      minStock,
      status,
      updatedBy: getCurrentUser()?.uid || null
    };

    if (!productId) {
      data.stock = parseInt($('#p-stock').value, 10) || 0;
      data.createdBy = getCurrentUser()?.uid || null;
      if (data.stock <= 0) data.status = 'OUT_OF_STOCK';
    }

    const id = await saveProduct(productId, data);

    if (barcode && name) {
      upsertBarcodeCatalog(barcode, {
        name,
        brand: null,
        quantity: description || null,
        unit,
        imageUrl: null,
        source: 'shop'
      }).catch(() => {});
    }

    // อัปโหลดรูป
    if (imageFile) {
      try {
        const blob = await compressImage(imageFile, 800, 0.75);
        const url = await uploadProductImage(shopId, id, blob);
        await saveProduct(id, { imageUrl: url });
      } catch (imgErr) {
        console.warn('Image upload failed', imgErr);
        showToast('บันทึกสินค้าแล้ว แต่รูปอัปโหลดไม่สำเร็จ', 'warning');
      }
    }

    // สินค้าใหม่ที่มี stock เริ่มต้น → ตั้ง 0 แล้ว stockIn เพื่อให้มี movement ถูกต้อง
    if (!productId && data.stock > 0) {
      try {
        await saveProduct(id, { stock: 0 });
        await stockIn({
          shopId,
          productId: id,
          quantity: data.stock,
          unitCost: costPrice,
          note: 'สต็อกเริ่มต้น',
          employeeId: getCurrentEmployee()?.id,
          userId: getCurrentUser()?.uid
        });
      } catch (e) {
        console.warn('Initial stock movement failed', e);
        await saveProduct(id, { stock: data.stock });
      }
    }

    await writeAuditLog({
      shopId,
      userId: getCurrentUser()?.uid,
      employeeId: getCurrentEmployee()?.id,
      action: productId ? 'UPDATE_PRODUCT' : 'CREATE_PRODUCT',
      module: 'PRODUCT',
      targetId: id,
      oldValue: oldProduct ? { name: oldProduct.name, sellPrice: oldProduct.sellPrice, costPrice: oldProduct.costPrice } : null,
      newValue: { name, sellPrice, costPrice, status }
    });

    hideLoading();
    showToast('บันทึกสินค้าสำเร็จ', 'success');
    openProductDetail(id);
  } catch (err) {
    hideLoading();
    console.error(err);
    showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
  }
}

export async function openStockInForm(productId) {
  const product = await getProduct(productId);
  if (!product) return;

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:8px;">รับสินค้าเข้าคลัง</h2>
      <p class="text-muted" style="font-size:0.9rem;margin-bottom:14px;">
        ${escapeHtml(product.name)} · คงเหลือปัจจุบัน: <strong>${product.stock || 0}</strong> ${escapeHtml(product.unit || 'ชิ้น')}
      </p>
      <form id="stock-in-form">
        <div class="form-group">
          <label>จำนวนที่รับเข้า *</label>
          <input type="number" id="si-qty" class="form-control" min="1" step="1" required inputmode="numeric">
        </div>
        <div class="form-group">
          <label>ราคาทุนต่อหน่วย (ถ้าเปลี่ยน)</label>
          <input type="number" id="si-cost" class="form-control" min="0" step="0.01" value="${product.costPrice ?? ''}">
        </div>
        <div class="form-group">
          <label>ผู้จำหน่าย / Supplier</label>
          <input type="text" id="si-supplier" class="form-control">
        </div>
        <div class="form-group">
          <label>เลขเอกสาร</label>
          <input type="text" id="si-doc" class="form-control">
        </div>
        <div class="form-group">
          <label>หมายเหตุ</label>
          <textarea id="si-note" class="form-control" rows="2"></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">ยืนยันรับเข้า</button>
        <button type="button" class="btn btn-outline btn-block mt-1" id="btn-cancel-si">ยกเลิก</button>
      </form>
    </div>
  `;

  $('#btn-cancel-si').addEventListener('click', () => openProductDetail(productId));
  $('#stock-in-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const qty = parseInt($('#si-qty').value, 10);
    if (!qty || qty <= 0) {
      showToast('จำนวนต้องมากกว่า 0', 'error');
      return;
    }
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    showLoading('กำลังบันทึก...');
    try {
      await stockIn({
        shopId: getCurrentShopId(),
        productId,
        quantity: qty,
        unitCost: parseFloat($('#si-cost').value) || null,
        supplier: $('#si-supplier').value.trim() || null,
        docNo: $('#si-doc').value.trim() || null,
        note: $('#si-note').value.trim() || null,
        employeeId: getCurrentEmployee()?.id,
        userId: getCurrentUser()?.uid
      });
      // อัปเดตราคาทุนถ้าเปลี่ยน
      const newCost = parseFloat($('#si-cost').value);
      if (!isNaN(newCost) && newCost >= 0 && newCost !== product.costPrice) {
        await saveProduct(productId, { costPrice: newCost });
      }
      hideLoading();
      showToast(`รับเข้า ${qty} สำเร็จ`, 'success');
      openProductDetail(productId);
    } catch (err) {
      hideLoading();
      btn.disabled = false;
      showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  });
}

export async function openAdjustStockForm(productId) {
  const product = await getProduct(productId);
  if (!product) return;

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:8px;">ปรับ Stock</h2>
      <p class="text-muted" style="font-size:0.9rem;margin-bottom:14px;">
        ${escapeHtml(product.name)} · คงเหลือปัจจุบัน: <strong>${product.stock || 0}</strong> ${escapeHtml(product.unit || 'ชิ้น')}
      </p>
      <form id="adjust-form">
        <div class="form-group">
          <label>จำนวนใหม่ *</label>
          <input type="number" id="adj-qty" class="form-control" min="0" step="1" value="${product.stock || 0}" required inputmode="numeric">
        </div>
        <div class="form-group">
          <label>เหตุผล *</label>
          <select id="adj-reason" class="form-control" required>
            <option value="">— เลือกเหตุผล —</option>
            <option value="COUNT">นับ Stock ใหม่</option>
            <option value="DAMAGE">สินค้าเสีย</option>
            <option value="LOSS">สินค้าหาย</option>
            <option value="INTERNAL">ใช้ภายในร้าน</option>
            <option value="OTHER">อื่น ๆ</option>
          </select>
        </div>
        <div class="form-group">
          <label>หมายเหตุ</label>
          <textarea id="adj-note" class="form-control" rows="2"></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">ยืนยันปรับ Stock</button>
        <button type="button" class="btn btn-outline btn-block mt-1" id="btn-cancel-adj">ยกเลิก</button>
      </form>
    </div>
  `;

  $('#btn-cancel-adj').addEventListener('click', () => openProductDetail(productId));
  $('#adjust-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newStock = parseInt($('#adj-qty').value, 10);
    const reason = $('#adj-reason').value;
    if (isNaN(newStock) || newStock < 0) {
      showToast('จำนวนไม่ถูกต้อง', 'error');
      return;
    }
    if (!reason) {
      showToast('กรุณาเลือกเหตุผล', 'error');
      return;
    }
    if (!confirm(`ยืนยันปรับ Stock จาก ${product.stock || 0} เป็น ${newStock}?`)) return;

    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    showLoading('กำลังบันทึก...');
    try {
      await adjustStock({
        shopId: getCurrentShopId(),
        productId,
        newStock,
        reason,
        note: $('#adj-note').value.trim() || null,
        employeeId: getCurrentEmployee()?.id,
        userId: getCurrentUser()?.uid
      });
      hideLoading();
      showToast('ปรับ Stock สำเร็จ', 'success');
      openProductDetail(productId);
    } catch (err) {
      hideLoading();
      btn.disabled = false;
      showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  });
}

export async function openStockHistory(productId) {
  showLoading('โหลดประวัติ...');
  const [product, movements] = await Promise.all([
    getProduct(productId),
    listInventoryTransactions(getCurrentShopId(), productId, 50)
  ]);
  hideLoading();

  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">ประวัติ Stock</h2>
      <button class="btn btn-outline btn-sm" id="btn-back-detail">กลับ</button>
    </div>
    <p class="text-muted" style="font-size:0.85rem;margin-bottom:12px;">
      ${escapeHtml(product?.name || '')} · คงเหลือ ${product?.stock ?? 0}
    </p>
    ${movements.length === 0 ? `
      <div class="card text-center text-muted"><p>ยังไม่มีประวัติ</p></div>
    ` : movements.map(m => {
      const diff = (m.afterStock ?? 0) - (m.beforeStock ?? 0);
      const sign = diff >= 0 ? '+' : '';
      return `
        <div class="card" style="margin-bottom:8px;padding:12px;">
          <div class="flex-between">
            <strong>${movementTypeLabel(m.type)}</strong>
            <span class="${diff >= 0 ? 'text-success' : 'text-danger'}">${sign}${diff}</span>
          </div>
          <div class="text-muted" style="font-size:0.8rem;margin-top:4px;">
            ${m.beforeStock ?? '-'} → ${m.afterStock ?? '-'}
            ${m.reason ? ` · ${escapeHtml(m.reason)}` : ''}
          </div>
          ${m.note ? `<div style="font-size:0.8rem;">${escapeHtml(m.note)}</div>` : ''}
          <div class="text-muted" style="font-size:0.75rem;margin-top:4px;">
            ${formatDateTime(m.createdAt)}
          </div>
        </div>
      `;
    }).join('')}
  `;

  $('#btn-back-detail').addEventListener('click', () => openProductDetail(productId));
}

// ---------- Categories ----------
export async function renderCategories() {
  showLoading();
  let categories = [];
  try {
    categories = await listCategories(getCurrentShopId());
  } catch (err) {
    hideLoading();
    console.error(err);
    pageContent.innerHTML = firestoreErrorHtml(err, { title: 'หมวดหมู่', retryId: 'btn-retry-cat' });
    $('#btn-retry-cat')?.addEventListener('click', () => renderCategories());
    return;
  }
  hideLoading();

  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.15rem;">หมวดหมู่</h2>
      <button class="btn btn-primary btn-sm" id="btn-add-cat">+ เพิ่ม</button>
    </div>
    ${categories.length === 0 ? `
      <div class="card text-center text-muted">
        <p>ยังไม่มีหมวดหมู่</p>
      </div>
    ` : categories.map(c => `
      <div class="card" style="margin-bottom:8px;cursor:pointer;" data-cat-id="${escapeHtml(c.id)}">
        <div class="flex-between">
          <div>
            <strong>${escapeHtml(c.name)}</strong>
            <div class="text-muted" style="font-size:0.8rem;">
              ${c.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด'} · ลำดับ ${c.sortOrder ?? 0}
            </div>
          </div>
          <span>›</span>
        </div>
      </div>
    `).join('')}
    <button class="btn btn-outline btn-block mt-2" id="btn-back-prod">กลับหน้าสินค้า</button>
  `;

  $('#btn-add-cat').addEventListener('click', () => openCategoryForm(null));
  $('#btn-back-prod').addEventListener('click', () => renderProducts());
  pageContent.querySelectorAll('[data-cat-id]').forEach(el => {
    el.addEventListener('click', () => openCategoryForm(el.dataset.catId));
  });
}

export async function openCategoryForm(categoryId) {
  let cat = null;
  if (categoryId) {
    showLoading();
    cat = await getCategory(categoryId);
    hideLoading();
  }

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:16px;">${cat ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่'}</h2>
      <form id="cat-form">
        <div class="form-group">
          <label>ชื่อหมวดหมู่ *</label>
          <input type="text" id="c-name" class="form-control" value="${escapeHtml(cat?.name || '')}" required>
        </div>
        <div class="form-group">
          <label>คำอธิบาย</label>
          <textarea id="c-desc" class="form-control" rows="2">${escapeHtml(cat?.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>ลำดับการแสดง</label>
          <input type="number" id="c-sort" class="form-control" value="${cat?.sortOrder ?? 0}" step="1">
        </div>
        <div class="form-group">
          <label>สถานะ</label>
          <select id="c-status" class="form-control">
            <option value="ACTIVE" ${!cat || cat.status === 'ACTIVE' ? 'selected' : ''}>ใช้งาน</option>
            <option value="INACTIVE" ${cat?.status === 'INACTIVE' ? 'selected' : ''}>ปิด</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">บันทึก</button>
        <button type="button" class="btn btn-outline btn-block mt-1" id="btn-cancel-cat">ยกเลิก</button>
      </form>
    </div>
  `;

  $('#btn-cancel-cat').addEventListener('click', () => renderCategories());
  $('#cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#c-name').value.trim();
    if (!name) {
      showToast('กรุณากรอกชื่อหมวดหมู่', 'error');
      return;
    }
    showLoading('กำลังบันทึก...');
    try {
      const id = await saveCategory(categoryId, {
        shopId: getCurrentShopId(),
        name,
        description: $('#c-desc').value.trim() || null,
        sortOrder: parseInt($('#c-sort').value, 10) || 0,
        status: $('#c-status').value
      });
      await writeAuditLog({
        shopId: getCurrentShopId(),
        userId: getCurrentUser()?.uid,
        employeeId: getCurrentEmployee()?.id,
        action: categoryId ? 'UPDATE_CATEGORY' : 'CREATE_CATEGORY',
        module: 'PRODUCT',
        targetId: id,
        newValue: { name }
      });
      hideLoading();
      showToast('บันทึกหมวดหมู่สำเร็จ', 'success');
      renderCategories();
    } catch (err) {
      hideLoading();
      showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  });
}


