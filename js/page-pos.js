/**
 * POSMATE — POS page (cart / scan / search / discount / payment UI)
 * Business cart logic ยังอยู่ที่ pos.js — ไฟล์นี้เป็น UI layer
 */
import {
  getShop, listProducts, getProduct, writeAuditLog, getOpenShift
} from './db.js';
import {
  getCurrentUser, getCurrentEmployee, getCurrentShopId, hasRole
} from './auth.js';
import {
  showToast, showLoading, hideLoading, escapeHtml, formatMoney, formatDateTime,
  generateId, firestoreErrorHtml, debounce
} from './utils.js';
import {
  getCart, getDiscount, clearCart, calcTotals, addToCart, setCartQty,
  removeFromCart, setDiscount, scanAndAdd, startScanner, stopScanner,
  searchProductsForPos, buildCheckoutPayload, requireEmployee, normalizeBarcode
} from './pos.js';
import {
  renderPromptPayQR, completeSale, openReceiptPrint
} from './payment.js';
import {
  isOnline, enqueuePendingSale, getPendingCount, refreshProductCache
} from './offline.js';
import * as ui from './app-state.js';
import { $, pageContent, navigate, pinModal } from './app-state.js';

async function openShiftForm() {
  const mod = await import('./page-dashboard.js');
  return mod.openShiftForm();
}

export async function renderPos() {
  if (ui.posMode !== 'scan') {
    await stopScanner().catch(() => {});
  }

  try {
    requireEmployee();
  } catch (e) {
    pageContent.innerHTML = `
      <div class="card text-center">
        <div style="font-size:2.5rem;margin-bottom:12px;">👤</div>
        <h2 style="font-size:1.1rem;">เลือกพนักงานก่อนขาย</h2>
        <p class="text-muted mt-1" style="font-size:0.9rem;">ใส่รหัสพนักงาน + PIN เพื่อเข้าใช้งาน POS</p>
        <button class="btn btn-primary btn-block btn-lg mt-2" id="btn-pos-pin">เลือกพนักงาน / ใส่ PIN</button>
        <button class="btn btn-outline btn-block mt-1" id="btn-pos-back">กลับหน้าหลัก</button>
      </div>
    `;
    $('#btn-pos-pin')?.addEventListener('click', () => {
      pinModal.classList.add('active');
      $('#emp-code').value = '';
      $('#emp-pin').value = '';
      $('#emp-code').focus();
    });
    $('#btn-pos-back')?.addEventListener('click', () => navigate('dashboard'));
    return;
  }

  let openShiftData = null;
  try {
    showLoading('ตรวจสอบกะ...');
    openShiftData = await getOpenShift(getCurrentShopId());
  } catch (e) {
    console.warn(e);
  } finally {
    hideLoading();
  }
  if (!openShiftData) {
    pageContent.innerHTML = `
      <div class="card text-center">
        <div style="font-size:2.5rem;margin-bottom:12px;">🕐</div>
        <h2 style="font-size:1.1rem;">ยังไม่ได้เปิดกะ</h2>
        <p class="text-muted mt-1" style="font-size:0.9rem;">
          ต้องเปิดกะก่อนจึงจะขายสินค้าได้<br>
          เมื่อปิดกะแล้วจะขายไม่ได้จนกว่าจะเปิดกะใหม่
        </p>
        <button class="btn btn-primary btn-block btn-lg mt-2" id="btn-pos-open-shift">เปิดกะ</button>
        <button class="btn btn-outline btn-block mt-1" id="btn-pos-back-dash">กลับหน้าหลัก</button>
      </div>
    `;
    $('#btn-pos-open-shift')?.addEventListener('click', () => openShiftForm());
    $('#btn-pos-back-dash')?.addEventListener('click', () => navigate('dashboard'));
    return;
  }
  window.__posOpenShiftId = openShiftData.id || openShiftData.shiftId || null;

  if (ui.posMode === 'scan') {
    await renderPosScan();
    return;
  }
  if (ui.posMode === 'search') {
    await renderPosSearch();
    return;
  }
  if (ui.posMode === 'discount') {
    renderPosDiscount();
    return;
  }

  renderPosCart();
}

export function renderPosCart() {
  const cart = getCart();
  const totals = calcTotals();
  const disc = getDiscount();
  const emp = getCurrentEmployee();

  pageContent.innerHTML = `
    <div class="pos-header flex-between mb-2">
      <div>
        <h2 style="font-size:1.1rem;margin:0;">ขายสินค้า</h2>
        <div class="text-muted" style="font-size:0.8rem;">
          ${escapeHtml(emp?.firstName || emp?.code || '')} · ${cart.length} รายการ
        </div>
      </div>
      <button class="btn btn-outline btn-sm" id="btn-clear-cart" ${cart.length === 0 ? 'disabled' : ''}>ล้าง</button>
    </div>

    <div class="pos-actions grid-2 mb-2" style="gap:8px;">
      <button class="btn btn-primary btn-block" id="btn-open-scan" style="height:56px;font-size:1rem;">
        📷 สแกน
      </button>
      <button class="btn btn-outline btn-block" id="btn-open-search" style="height:56px;font-size:1rem;">
        🔍 ค้นหา
      </button>
    </div>

    <div id="pos-cart-list" class="pos-cart-list">
      ${cart.length === 0 ? `
        <div class="card text-center text-muted" style="padding:28px 16px;">
          <div style="font-size:2rem;margin-bottom:8px;">🛒</div>
          <p>ตะกร้าว่าง</p>
          <p style="font-size:0.85rem;">กดสแกนหรือค้นหาเพื่อเพิ่มสินค้า</p>
        </div>
      ` : cart.map(item => `
        <div class="card pos-cart-item" data-id="${escapeHtml(item.productId)}" style="margin-bottom:8px;padding:12px;">
          <div class="flex-between" style="margin-bottom:6px;">
            <strong style="font-size:0.95rem;flex:1;padding-right:8px;">${escapeHtml(item.name)}</strong>
            <button class="btn-icon pos-remove" data-id="${escapeHtml(item.productId)}" title="ลบ">✕</button>
          </div>
          <div class="text-muted" style="font-size:0.8rem;margin-bottom:8px;">
            ฿${formatMoney(item.unitPrice)} / ${escapeHtml(item.unit)}
            · สต็อก ${item.stock}
          </div>
          <div class="flex-between" style="align-items:center;">
            <div class="qty-control">
              <button class="qty-btn pos-minus" data-id="${escapeHtml(item.productId)}">−</button>
              <span class="qty-val">${item.quantity}</span>
              <button class="qty-btn pos-plus" data-id="${escapeHtml(item.productId)}">+</button>
            </div>
            <strong>฿${formatMoney(item.lineTotal)}</strong>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="pos-summary card" style="margin-top:12px;">
      <div class="flex-between" style="margin-bottom:6px;">
        <span class="text-muted">ยอดรวม</span>
        <span>฿${formatMoney(totals.subtotal)}</span>
      </div>
      <div class="flex-between" style="margin-bottom:6px;">
        <span class="text-muted">ส่วนลด</span>
        <span class="${totals.discountAmount > 0 ? 'text-danger' : ''}">
          ${totals.discountAmount > 0 ? '−' : ''}฿${formatMoney(totals.discountAmount)}
        </span>
      </div>
      <div class="flex-between" style="font-size:1.15rem;font-weight:700;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
        <span>ยอดสุทธิ</span>
        <span style="color:var(--primary);">฿${formatMoney(totals.total)}</span>
      </div>
      <div class="grid-2 mt-2" style="gap:8px;">
        <button class="btn btn-outline btn-block" id="btn-pos-discount" ${cart.length === 0 ? 'disabled' : ''}>ส่วนลด</button>
        <button class="btn btn-primary btn-block btn-lg" id="btn-pos-checkout" ${cart.length === 0 ? 'disabled' : ''} style="height:52px;">ชำระเงิน</button>
      </div>
    </div>
  `;

  $('#btn-open-scan')?.addEventListener('click', () => { ui.setPosMode('scan'); renderPos(); });
  $('#btn-open-search')?.addEventListener('click', () => { ui.setPosMode('search'); renderPos(); });
  $('#btn-pos-discount')?.addEventListener('click', () => { ui.setPosMode('discount'); renderPos(); });
  $('#btn-clear-cart')?.addEventListener('click', () => {
    if (cart.length === 0) return;
    if (!confirm('ล้างตะกร้าทั้งหมด?')) return;
    clearCart();
    showToast('ล้างตะกร้าแล้ว', 'info');
    renderPosCart();
  });
  $('#btn-pos-checkout')?.addEventListener('click', () => onPosCheckout());

  pageContent.querySelectorAll('.pos-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        const id = btn.dataset.id;
        const item = getCart().find(i => i.productId === id);
        if (!item) return;
        setCartQty(id, item.quantity + 1);
        renderPosCart();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
  pageContent.querySelectorAll('.pos-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        const id = btn.dataset.id;
        const item = getCart().find(i => i.productId === id);
        if (!item) return;
        setCartQty(id, item.quantity - 1);
        renderPosCart();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
  pageContent.querySelectorAll('.pos-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromCart(btn.dataset.id);
      renderPosCart();
    });
  });
}

export async function renderPosScan() {
  function buildScanCartListHtml() {
    const cart = getCart();
    if (!cart.length) {
      return `<div class="text-muted text-center" style="padding:14px 8px;font-size:0.85rem;">ยังไม่มีสินค้า — สแกนบาร์โค้ดด้านบน</div>`;
    }
    return cart.map(item => `
      <div class="scan-cart-row" data-id="${escapeHtml(item.productId)}" style="display:flex;align-items:center;gap:8px;padding:10px 4px;border-bottom:1px solid var(--border,#e5e7eb);">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name)}</div>
          <div class="text-muted" style="font-size:0.78rem;">฿${formatMoney(item.unitPrice)} × ${item.quantity}</div>
        </div>
        <strong style="font-size:0.95rem;white-space:nowrap;">฿${formatMoney(item.lineTotal)}</strong>
      </div>
    `).join('');
  }
  function refreshScanCartUI() {
    const t = calcTotals();
    const countEl = $('#scan-cart-count');
    const listEl = $('#scan-cart-items');
    if (countEl) countEl.textContent = `${getCart().length} รายการ · ฿${formatMoney(t.total)}`;
    if (listEl) listEl.innerHTML = buildScanCartListHtml();
  }

  pageContent.innerHTML = `
    <div class="flex-between mb-1">
      <h2 style="font-size:1.05rem;margin:0;">สแกนขาย</h2>
      <button class="btn btn-outline btn-sm" id="btn-scan-close">ปิด</button>
    </div>
    <div id="scanner-region" class="scanner-region" style="min-height:180px;max-height:240px;"></div>
    <p class="text-center text-muted" style="font-size:0.8rem;margin:6px 0 8px;">หันกล้องไปที่บาร์โค้ด · เพิ่มตะกร้าอัตโนมัติ</p>
    <div class="card" style="padding:10px;margin-bottom:8px;">
      <div class="flex-between" style="margin-bottom:6px;">
        <span style="font-weight:600;font-size:0.9rem;">รายการที่สแกน</span>
        <strong id="scan-cart-count" style="color:var(--primary);font-size:0.9rem;">${getCart().length} รายการ · ฿${formatMoney(calcTotals().total)}</strong>
      </div>
      <div id="scan-cart-items" style="max-height:220px;overflow-y:auto;-webkit-overflow-scrolling:touch;">${buildScanCartListHtml()}</div>
      <button class="btn btn-primary btn-block btn-lg mt-2" id="btn-scan-done" style="height:52px;">เสร็จสิ้น / ชำระเงิน</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <input type="text" id="manual-barcode" class="form-control" placeholder="พิมพ์ barcode" inputmode="numeric">
      <button class="btn btn-outline" id="btn-manual-add" style="white-space:nowrap;">เพิ่ม</button>
    </div>
  `;

  $('#btn-scan-close')?.addEventListener('click', async () => { await stopScanner(); ui.setPosMode('cart'); renderPos(); });
  $('#btn-scan-done')?.addEventListener('click', async () => { await stopScanner(); ui.setPosMode('cart'); renderPos(); });
  const doManual = async () => {
    const code = $('#manual-barcode')?.value.trim();
    if (!code) return;
    await scanAndAdd(code);
    $('#manual-barcode').value = '';
    refreshScanCartUI();
  };
  $('#btn-manual-add')?.addEventListener('click', doManual);
  $('#manual-barcode')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doManual(); } });

  try {
    showLoading('เปิดกล้อง...');
    await startScanner('scanner-region', async (code) => { await scanAndAdd(code); refreshScanCartUI(); }, { qrbox: { width: 260, height: 140 } });
    hideLoading();
  } catch (err) {
    hideLoading();
    console.error(err);
    showToast(err.message || 'เปิดกล้องไม่สำเร็จ — ใช้พิมพ์รหัสแทนได้', 'error');
  }
}

export async function renderPosSearch() {
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">ค้นหาสินค้า</h2>
      <button class="btn btn-outline btn-sm" id="btn-search-close">ปิด</button>
    </div>
    <input type="search" id="pos-search-input" class="form-control mb-2" placeholder="ชื่อ / barcode / SKU" autofocus>
    <div id="pos-search-results"><p class="text-center text-muted" style="padding:20px 0;">พิมพ์เพื่อค้นหา</p></div>
  `;
  $('#btn-search-close')?.addEventListener('click', () => { ui.setPosMode('cart'); renderPos(); });
  const resultsEl = $('#pos-search-results');
  const doSearch = debounce(async () => {
    const kw = $('#pos-search-input')?.value.trim() || '';
    resultsEl.innerHTML = '<p class="text-center text-muted">กำลังค้นหา...</p>';
    try {
      const list = await searchProductsForPos(kw);
      if (list.length === 0) {
        resultsEl.innerHTML = `<div class="card text-center text-muted"><p>ไม่พบสินค้า</p></div>`;
        return;
      }
      resultsEl.innerHTML = list.map(p => {
        const stock = Number(p.stock) || 0;
        const disabled = stock <= 0 || p.status === 'INACTIVE';
        return `
          <div class="card pos-search-item" data-id="${escapeHtml(p.id)}" style="margin-bottom:8px;padding:12px;opacity:${disabled ? 0.55 : 1};">
            <div class="flex-between">
              <div style="flex:1;min-width:0;">
                <strong style="display:block;">${escapeHtml(p.name)}</strong>
                <div class="text-muted" style="font-size:0.8rem;">${p.barcode ? escapeHtml(p.barcode) + ' · ' : ''}คงเหลือ ${stock} · ฿${formatMoney(p.sellPrice)}</div>
              </div>
              <button class="btn btn-primary btn-sm pos-add-btn" data-id="${escapeHtml(p.id)}" ${disabled ? 'disabled' : ''}>+</button>
            </div>
          </div>`;
      }).join('');
      resultsEl.querySelectorAll('.pos-add-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (btn.disabled) return;
          try {
            const product = list.find(p => p.id === btn.dataset.id);
            if (!product) return;
            addToCart(product, 1);
            showToast('+ ' + product.name, 'success', 1200);
          } catch (err) { showToast(err.message, 'error'); }
        });
      });
    } catch (err) {
      resultsEl.innerHTML = `<p class="text-danger text-center">${escapeHtml(err.message)}</p>`;
    }
  }, 300);
  $('#pos-search-input')?.addEventListener('input', doSearch);
  doSearch();
}

export function renderPosDiscount() {
  const disc = getDiscount();
  const totals = calcTotals();
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">ส่วนลด</h2>
      <button class="btn btn-outline btn-sm" id="btn-disc-close">ปิด</button>
    </div>
    <div class="card">
      <p class="text-muted" style="font-size:0.9rem;margin-bottom:12px;">ยอดก่อนส่วนลด: ฿${formatMoney(totals.subtotal)}</p>
      <div class="form-group">
        <label>ประเภทส่วนลด</label>
        <select id="disc-type" class="form-control">
          <option value="NONE" ${disc.type === 'NONE' ? 'selected' : ''}>ไม่มีส่วนลด</option>
          <option value="AMOUNT" ${disc.type === 'AMOUNT' ? 'selected' : ''}>เป็นจำนวนเงิน (บาท)</option>
          <option value="PERCENT" ${disc.type === 'PERCENT' ? 'selected' : ''}>เป็นเปอร์เซ็นต์ (%)</option>
        </select>
      </div>
      <div class="form-group">
        <label>มูลค่า</label>
        <input type="number" id="disc-value" class="form-control" min="0" step="0.01" value="${disc.value || 0}" inputmode="decimal">
      </div>
      <button class="btn btn-primary btn-block" id="btn-disc-apply">ใช้ส่วนลด</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-disc-clear">ล้างส่วนลด</button>
    </div>
  `;
  $('#btn-disc-close')?.addEventListener('click', () => { ui.setPosMode('cart'); renderPos(); });
  $('#btn-disc-apply')?.addEventListener('click', () => {
    try {
      setDiscount($('#disc-type').value, parseFloat($('#disc-value').value) || 0);
      showToast('ใช้ส่วนลดแล้ว', 'success');
      ui.setPosMode('cart');
      renderPos();
    } catch (err) { showToast(err.message, 'error'); }
  });
  $('#btn-disc-clear')?.addEventListener('click', () => {
    setDiscount('NONE', 0);
    showToast('ล้างส่วนลดแล้ว', 'info');
    ui.setPosMode('cart');
    renderPos();
  });
}

export async function onPosCheckout() {
  try { requireEmployee(); } catch (e) { showToast(e.message, 'error'); return; }
  const cart = getCart();
  if (!cart.length) { showToast('ตะกร้าว่าง', 'error'); return; }
  renderPaymentMethod();
}

export function renderPaymentMethod() {
  const totals = calcTotals();
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">ชำระเงิน</h2>
      <button class="btn btn-outline btn-sm" id="btn-pay-back">กลับ</button>
    </div>
    <div class="card mb-2 text-center">
      <div class="text-muted">ยอดที่ต้องชำระ</div>
      <div style="font-size:2rem;font-weight:700;color:var(--primary);">฿${formatMoney(totals.total)}</div>
    </div>
    <button class="btn btn-primary btn-block btn-lg mb-2" id="btn-pay-cash" style="height:56px;">เงินสด</button>
    <button class="btn btn-outline btn-block btn-lg" id="btn-pay-qr" style="height:56px;">PromptPay / QR</button>
  `;
  $('#btn-pay-back')?.addEventListener('click', () => { ui.setPosMode('cart'); renderPos(); });
  $('#btn-pay-cash')?.addEventListener('click', () => renderCashPayment());
  $('#btn-pay-qr')?.addEventListener('click', () => renderPromptPayPayment());
}

export function renderCashPayment() {
  const totals = calcTotals();
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">รับเงินสด</h2>
      <button class="btn btn-outline btn-sm" id="btn-cash-back">กลับ</button>
    </div>
    <div class="card mb-2 text-center">
      <div class="text-muted">ยอดที่ต้องชำระ</div>
      <div style="font-size:1.8rem;font-weight:700;color:var(--primary);">฿${formatMoney(totals.total)}</div>
    </div>
    <div class="form-group">
      <label>รับเงินมา</label>
      <input type="number" id="cash-received" class="form-control" min="0" step="1" inputmode="decimal" style="font-size:1.4rem;text-align:center;height:56px;" autofocus>
    </div>
    <p id="cash-change" class="text-center" style="font-size:1.1rem;min-height:1.5em;"></p>
    <button class="btn btn-primary btn-block btn-lg" id="btn-cash-confirm" style="height:56px;">ยืนยันรับเงิน</button>
  `;
  const received = $('#cash-received');
  const changeEl = $('#cash-change');
  const update = () => {
    const r = parseFloat(received.value);
    if (isNaN(r)) { changeEl.textContent = ''; return; }
    const ch = Math.round((r - totals.total) * 100) / 100;
    if (ch < 0) changeEl.innerHTML = '<span class="text-danger">เงินไม่พอ</span>';
    else changeEl.innerHTML = 'เงินทอน <strong>฿' + formatMoney(ch) + '</strong>';
  };
  received?.addEventListener('input', update);
  $('#btn-cash-back')?.addEventListener('click', () => renderPaymentMethod());
  $('#btn-cash-confirm')?.addEventListener('click', async () => {
    const r = parseFloat(received?.value);
    if (isNaN(r) || r < totals.total) { showToast('รับเงินไม่พอ', 'error'); return; }
    await submitSale({ method: 'CASH', receivedAmount: r, changeAmount: Math.round((r - totals.total) * 100) / 100 });
  });
}

export async function renderPromptPayPayment() {
  const totals = calcTotals();
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">PromptPay</h2>
      <button class="btn btn-outline btn-sm" id="btn-qr-back">กลับ</button>
    </div>
    <div class="card mb-2 text-center">
      <div class="text-muted">ยอดที่ต้องชำระ</div>
      <div style="font-size:1.8rem;font-weight:700;color:var(--primary);">฿${formatMoney(totals.total)}</div>
      <div id="qr-box" style="margin:16px auto;max-width:240px;"></div>
      <p class="text-muted" style="font-size:0.85rem;">ให้ลูกค้าสแกน QR แล้วกดยืนยันเมื่อโอนสำเร็จ</p>
    </div>
    <button class="btn btn-primary btn-block btn-lg" id="btn-qr-confirm" style="height:56px;">ยืนยันรับโอนแล้ว</button>
  `;
  $('#btn-qr-back')?.addEventListener('click', () => renderPaymentMethod());
  try {
    await renderPromptPayQR('qr-box', totals.total);
  } catch (err) {
    showToast(err.message || 'สร้าง QR ไม่สำเร็จ — ตรวจ PromptPay ในตั้งค่า', 'error');
  }
  $('#btn-qr-confirm')?.addEventListener('click', async () => {
    await submitSale({ method: 'PROMPTPAY', receivedAmount: totals.total, changeAmount: 0 });
  });
}

export async function submitSale(payment) {
  try { requireEmployee(); } catch (e) { showToast(e.message, 'error'); return; }
  const payload = buildCheckoutPayload({
    paymentMethod: payment.method,
    receivedAmount: payment.receivedAmount,
    changeAmount: payment.changeAmount,
    shiftId: window.__posOpenShiftId || null
  });
  showLoading('บันทึกการขาย...');
  try {
    if (!isOnline()) {
      await enqueuePendingSale(payload);
      hideLoading();
      clearCart();
      setDiscount('NONE', 0);
      renderOfflineSaleSuccess(payload);
      return;
    }
    const result = await completeSale(payload);
    hideLoading();
    clearCart();
    setDiscount('NONE', 0);
    renderSaleSuccess(result);
  } catch (err) {
    hideLoading();
    console.error(err);
    if (!isOnline()) {
      try {
        await enqueuePendingSale(payload);
        clearCart();
        setDiscount('NONE', 0);
        renderOfflineSaleSuccess(payload);
        return;
      } catch (e2) { showToast(e2.message || 'บันทึก offline ไม่สำเร็จ', 'error'); }
    } else {
      showToast(err.message || 'บันทึกการขายไม่สำเร็จ', 'error');
    }
  }
}

export function renderOfflineSaleSuccess(payload) {
  pageContent.innerHTML = `
    <div class="card text-center">
      <div style="font-size:2.5rem;">📡</div>
      <h2 style="font-size:1.1rem;">บันทึก offline แล้ว</h2>
      <p class="text-muted">ยอด ฿${formatMoney(payload.total || 0)} จะ sync เมื่อมีเน็ต</p>
      <button class="btn btn-primary btn-block mt-2" id="btn-new-sale">ขายต่อ</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-sale-home">กลับหน้าหลัก</button>
    </div>`;
  $('#btn-new-sale')?.addEventListener('click', () => { ui.setPosMode('cart'); renderPos(); });
  $('#btn-sale-home')?.addEventListener('click', () => navigate('dashboard'));
}

export function renderSaleSuccess(result) {
  pageContent.innerHTML = `
    <div class="card text-center">
      <div style="font-size:2.5rem;">✅</div>
      <h2 style="font-size:1.1rem;">ขายสำเร็จ</h2>
      <p>เลขที่ใบเสร็จ: <strong>${escapeHtml(result.receiptNo || result.id || '')}</strong></p>
      <p style="font-size:1.3rem;font-weight:700;color:var(--primary);">฿${formatMoney(result.total || 0)}</p>
      <button class="btn btn-primary btn-block mt-2" id="btn-print-receipt">พิมพ์ใบเสร็จ</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-new-sale">ขายต่อ</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-sale-home">กลับหน้าหลัก</button>
    </div>`;
  $('#btn-print-receipt')?.addEventListener('click', () => openReceiptPrint(result));
  $('#btn-new-sale')?.addEventListener('click', () => { ui.setPosMode('cart'); renderPos(); });
  $('#btn-sale-home')?.addEventListener('click', () => navigate('dashboard'));
}
