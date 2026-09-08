/**
 * POSMATE — POS page UI (v1.0.13)
 * Cart / scan / search / discount / payment
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
        <h2 style="font-size:1.1rem;margin-bottom:8px;">เลือกพนักงานก่อนขาย</h2>
        <p class="text-muted" style="font-size:0.9rem;margin-bottom:16px;">${escapeHtml(e.message)}</p>
        <button class="btn btn-primary btn-block" id="btn-pos-pick-emp">เลือกพนักงาน</button>
      </div>`;
    $('#btn-pos-pick-emp')?.addEventListener('click', () => {
      if (pinModal) pinModal.classList.add('show');
    });
    return;
  }
  if (ui.posMode === 'scan') return renderPosScan();
  if (ui.posMode === 'search') return renderPosSearch();
  if (ui.posMode === 'discount') return renderPosDiscount();
  return renderPosCart();
}

export function renderPosCart() {
  const cart = getCart();
  const totals = calcTotals();
  const emp = getCurrentEmployee();
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <div>
        <h2 style="font-size:1.15rem;margin:0;">ขายสินค้า</h2>
        <div class="text-muted" style="font-size:0.8rem;">${escapeHtml(emp?.firstName || emp?.code || '')} · ${cart.length} รายการ</div>
      </div>
      <button class="btn btn-outline btn-sm" id="btn-clear-cart" ${cart.length === 0 ? 'disabled' : ''}>ล้าง</button>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <button class="btn btn-primary" id="btn-pos-scan" style="flex:1;height:48px;">📷 สแกน</button>
      <button class="btn btn-outline" id="btn-pos-search" style="flex:1;height:48px;">🔍 ค้นหา</button>
    </div>
    <div id="pos-cart-list" class="pos-cart-list">
      ${cart.length === 0 ? `
        <div class="card text-center text-muted" style="padding:24px;">
          <p>ยังไม่มีสินค้าในตะกร้า</p>
          <p style="font-size:0.85rem;">กดสแกนหรือค้นหาเพื่อเพิ่มสินค้า</p>
        </div>
      ` : cart.map(item => `
        <div class="card pos-cart-item" data-id="${escapeHtml(item.productId)}" style="margin-bottom:8px;padding:12px;">
          <div class="flex-between" style="margin-bottom:6px;">
            <strong style="font-size:0.95rem;">${escapeHtml(item.name)}</strong>
            <button class="btn-icon cart-remove" data-id="${escapeHtml(item.productId)}" style="border:none;background:transparent;font-size:1.1rem;color:#999;">×</button>
          </div>
          <div class="text-muted" style="font-size:0.8rem;margin-bottom:8px;">฿${formatMoney(item.unitPrice)} / ${escapeHtml(item.unit || 'ชิ้น')} · สต็อก ${item.stock}</div>
          <div class="flex-between" style="align-items:center;">
            <div style="display:flex;align-items:center;gap:0;background:#f3f4f6;border-radius:8px;overflow:hidden;">
              <button class="cart-minus" data-id="${escapeHtml(item.productId)}" style="width:40px;height:36px;border:none;background:transparent;font-size:1.2rem;">−</button>
              <span style="min-width:28px;text-align:center;font-weight:600;">${item.quantity}</span>
              <button class="cart-plus" data-id="${escapeHtml(item.productId)}" style="width:40px;height:36px;border:none;background:transparent;font-size:1.2rem;">+</button>
            </div>
            <strong>฿${formatMoney(item.lineTotal)}</strong>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="card" style="margin-top:12px;">
      <div class="flex-between" style="margin-bottom:4px;"><span class="text-muted">ยอดรวม</span><span>฿${formatMoney(totals.subtotal)}</span></div>
      <div class="flex-between" style="margin-bottom:4px;"><span class="text-muted">ส่วนลด</span><span>฿${formatMoney(totals.discountAmount)}</span></div>
      <div class="flex-between" style="font-weight:700;font-size:1.15rem;margin-bottom:12px;">
        <span>ยอดสุทธิ</span><span style="color:var(--primary);">฿${formatMoney(totals.total)}</span>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline btn-block" id="btn-pos-discount" ${cart.length === 0 ? 'disabled' : ''}>ส่วนลด</button>
        <button class="btn btn-primary btn-block btn-lg" id="btn-pos-checkout" ${cart.length === 0 ? 'disabled' : ''} style="height:52px;">ชำระเงิน</button>
      </div>
    </div>`;

  $('#btn-clear-cart')?.addEventListener('click', () => {
    if (!getCart().length) return;
    if (!confirm('ล้างตะกร้าทั้งหมด?')) return;
    clearCart();
    renderPosCart();
  });
  $('#btn-pos-scan')?.addEventListener('click', () => { ui.setPosMode('scan'); renderPos(); });
  $('#btn-pos-search')?.addEventListener('click', () => { ui.setPosMode('search'); renderPos(); });
  $('#btn-pos-discount')?.addEventListener('click', () => { ui.setPosMode('discount'); renderPos(); });
  $('#btn-pos-checkout')?.addEventListener('click', () => onPosCheckout());

  pageContent.querySelectorAll('.cart-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        const item = getCart().find(i => i.productId === btn.dataset.id);
        if (item) setCartQty(item.productId, item.quantity + 1);
        renderPosCart();
      } catch (e) { showToast(e.message, 'error'); }
    });
  });
  pageContent.querySelectorAll('.cart-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = getCart().find(i => i.productId === btn.dataset.id);
      if (item) setCartQty(item.productId, item.quantity - 1);
      renderPosCart();
    });
  });
  pageContent.querySelectorAll('.cart-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFromCart(btn.dataset.id);
      renderPosCart();
    });
  });
}

export async function renderPosScan() {
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">สแกนสินค้า</h2>
      <button class="btn btn-outline btn-sm" id="btn-scan-close">ปิด</button>
    </div>
    <div id="pos-scanner-region" class="scanner-region" style="min-height:220px;margin-bottom:12px;"></div>
    <div class="card">
      <div class="flex-between mb-1">
        <strong id="scan-cart-count" style="color:var(--primary);font-size:0.9rem;">${getCart().length} รายการ · ฿${formatMoney(calcTotals().total)}</strong>
        <button class="btn btn-primary btn-sm" id="btn-scan-done">เสร็จ</button>
      </div>
      <div id="scan-cart-items" style="max-height:180px;overflow-y:auto;"></div>
    </div>`;
  const refreshScanList = () => {
    const t = calcTotals();
    const countEl = $('#scan-cart-count');
    const listEl = $('#scan-cart-items');
    if (countEl) countEl.textContent = `${getCart().length} รายการ · ฿${formatMoney(t.total)}`;
    if (listEl) {
      const cart = getCart();
      listEl.innerHTML = !cart.length ? '<p class="text-muted text-center">ยังไม่มีสินค้า</p>' : cart.map(item =>
        `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:0.9rem;">
          <span>${escapeHtml(item.name)} × ${item.quantity}</span><span>฿${formatMoney(item.lineTotal)}</span></div>`
      ).join('');
    }
  };
  refreshScanList();
  $('#btn-scan-close')?.addEventListener('click', async () => { await stopScanner(); ui.setPosMode('cart'); renderPos(); });
  $('#btn-scan-done')?.addEventListener('click', async () => { await stopScanner(); ui.setPosMode('cart'); renderPos(); });
  try {
    await startScanner('pos-scanner-region', async (code) => {
      try {
        await scanAndAdd(code);
        showToast('เพิ่มสินค้าแล้ว', 'success');
        refreshScanList();
      } catch (e) {
        showToast(e.message || 'สแกนไม่สำเร็จ', 'error');
      }
    }, { qrbox: { width: 280, height: 160 } });
  } catch (e) {
    showToast(e.message || 'เปิดกล้องไม่สำเร็จ', 'error');
  }
}

export async function renderPosSearch() {
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">ค้นหาสินค้า</h2>
      <button class="btn btn-outline btn-sm" id="btn-search-close">กลับ</button>
    </div>
    <input type="search" id="pos-search-input" class="form-control" placeholder="ชื่อ / barcode / SKU" style="margin-bottom:12px;height:48px;" autofocus>
    <div id="pos-search-results"></div>`;
  $('#btn-search-close')?.addEventListener('click', () => { ui.setPosMode('cart'); renderPos(); });
  const input = $('#pos-search-input');
  const results = $('#pos-search-results');
  const run = debounce(async () => {
    const kw = input?.value.trim() || '';
    if (!kw) { if (results) results.innerHTML = ''; return; }
    try {
      const list = await searchProductsForPos(kw);
      if (!results) return;
      if (!list.length) { results.innerHTML = '<div class="card text-center text-muted">ไม่พบสินค้า</div>'; return; }
      results.innerHTML = list.map(p => `
        <div class="card" style="margin-bottom:8px;padding:12px;cursor:pointer;" data-pid="${escapeHtml(p.id)}">
          <strong>${escapeHtml(p.name)}</strong>
          <div class="text-muted" style="font-size:0.8rem;">฿${formatMoney(p.sellPrice)} · สต็อก ${p.stock || 0}</div>
        </div>`).join('');
      results.querySelectorAll('[data-pid]').forEach(el => {
        el.addEventListener('click', async () => {
          try {
            const product = await getProduct(el.dataset.pid);
            addToCart(product, 1);
            showToast('เพิ่มแล้ว: ' + product.name, 'success');
            ui.setPosMode('cart');
            renderPos();
          } catch (e) { showToast(e.message, 'error'); }
        });
      });
    } catch (e) {
      if (results) results.innerHTML = '<div class="card text-danger">ค้นหาไม่สำเร็จ</div>';
    }
  }, 300);
  input?.addEventListener('input', run);
}

export function renderPosDiscount() {
  const d = getDiscount();
  const totals = calcTotals();
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">ส่วนลด</h2>
      <button class="btn btn-outline btn-sm" id="btn-disc-close">กลับ</button>
    </div>
    <div class="card">
      <div class="form-group"><label>ประเภท</label>
        <select id="disc-type" class="form-control">
          <option value="NONE" ${d.type === 'NONE' ? 'selected' : ''}>ไม่มี</option>
          <option value="AMOUNT" ${d.type === 'AMOUNT' ? 'selected' : ''}>จำนวนเงิน (บาท)</option>
          <option value="PERCENT" ${d.type === 'PERCENT' ? 'selected' : ''}>เปอร์เซ็นต์ (%)</option>
        </select></div>
      <div class="form-group"><label>ค่า</label>
        <input type="number" id="disc-value" class="form-control" min="0" step="0.01" value="${d.value || 0}"></div>
      <p class="text-muted">ยอดสุทธิปัจจุบัน ฿${formatMoney(totals.total)}</p>
      <button class="btn btn-primary btn-block" id="btn-disc-apply">ใช้ส่วนลด</button>
    </div>`;
  $('#btn-disc-close')?.addEventListener('click', () => { ui.setPosMode('cart'); renderPos(); });
  $('#btn-disc-apply')?.addEventListener('click', () => {
    setDiscount($('#disc-type')?.value || 'NONE', parseFloat($('#disc-value')?.value) || 0);
    ui.setPosMode('cart');
    renderPos();
  });
}

export async function onPosCheckout() {
  try { requireEmployee(); } catch (e) { showToast(e.message, 'error'); return; }
  if (!getCart().length) { showToast('ตะกร้าว่าง', 'error'); return; }
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
    <button class="btn btn-outline btn-block btn-lg" id="btn-pay-qr" style="height:56px;">PromptPay / QR</button>`;
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
    <button class="btn btn-primary btn-block btn-lg" id="btn-cash-confirm" style="height:56px;">ยืนยันรับเงิน</button>`;
  const received = $('#cash-received');
  const changeEl = $('#cash-change');
  const update = () => {
    const r = parseFloat(received?.value);
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
    <button class="btn btn-primary btn-block btn-lg" id="btn-qr-confirm" style="height:56px;">ยืนยันรับโอนแล้ว</button>`;
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
  let payload;
  try {
    payload = buildCheckoutPayload({
      paymentMethod: payment.method,
      receivedAmount: payment.receivedAmount,
      changeAmount: payment.changeAmount,
      shiftId: window.__posOpenShiftId || null
    });
  } catch (e) {
    showToast(e.message || 'ไม่มีรายการสินค้า', 'error');
    return;
  }
  if (!payload.items || !payload.items.length) {
    showToast('ไม่มีรายการสินค้า', 'error');
    return;
  }
  const saleArgs = {
    payload,
    paymentMethod: payment.method,
    amountReceived: payment.receivedAmount,
    changeAmount: payment.changeAmount
  };
  showLoading('บันทึกการขาย...');
  try {
    if (!isOnline()) {
      await enqueuePendingSale({
        transactionId: payload.transactionId,
        shopId: payload.shopId,
        payload,
        paymentMethod: payment.method,
        amountReceived: payment.receivedAmount,
        changeAmount: payment.changeAmount
      });
      hideLoading();
      clearCart();
      setDiscount('NONE', 0);
      renderOfflineSaleSuccess(payload);
      return;
    }
    const result = await completeSale(saleArgs);
    hideLoading();
    clearCart();
    setDiscount('NONE', 0);
    renderSaleSuccess(result);
  } catch (err) {
    hideLoading();
    console.error(err);
    if (!isOnline()) {
      try {
        await enqueuePendingSale({
          transactionId: payload.transactionId,
          shopId: payload.shopId,
          payload,
          paymentMethod: payment.method,
          amountReceived: payment.receivedAmount,
          changeAmount: payment.changeAmount
        });
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
      <div style="font-size:3rem;margin-bottom:8px;">✅</div>
      <h2 style="font-size:1.2rem;">บันทึกออฟไลน์แล้ว</h2>
      <p class="text-muted">ยอด ฿${formatMoney(payload.total)} · จะซิงค์เมื่อมีเน็ต</p>
      <button class="btn btn-primary btn-block mt-2" id="btn-off-done">ขายต่อ</button>
    </div>`;
  $('#btn-off-done')?.addEventListener('click', () => { ui.setPosMode('cart'); renderPos(); });
}

export function renderSaleSuccess(result) {
  const sale = result?.sale || result;
  pageContent.innerHTML = `
    <div class="card text-center">
      <div style="font-size:3rem;margin-bottom:8px;">✅</div>
      <h2 style="font-size:1.2rem;">ชำระเงินสำเร็จ</h2>
      <p class="text-muted">ใบเสร็จ ${escapeHtml(sale?.receiptNo || '')}<br>ยอด ฿${formatMoney(sale?.total || 0)}</p>
      <button class="btn btn-primary btn-block mt-2" id="btn-print-receipt">พิมพ์ใบเสร็จ</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-sale-done">ขายต่อ</button>
    </div>`;
  $('#btn-print-receipt')?.addEventListener('click', async () => {
    try {
      const shop = await getShop(getCurrentShopId());
      openReceiptPrint(sale, shop);
    } catch (e) { showToast(e.message || 'พิมพ์ไม่สำเร็จ', 'error'); }
  });
  $('#btn-sale-done')?.addEventListener('click', () => { ui.setPosMode('cart'); renderPos(); });
}
