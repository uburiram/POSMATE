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
  generateId, firestoreErrorHtml
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

export async function renderPos() {
  // หยุดสแกนเนอร์เมื่อออกจากโหมด scan
  if (ui.posMode !== 'scan') {
    await stopScanner().catch(() => {});
  }

  // บังคับเลือกพนักงานก่อนขาย
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

  // บังคับเปิดกะก่อนขาย — ปิดกะแล้วขายไม่ได้
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
  // เก็บ shift ปัจจุบันไว้ให้ checkout ใช้
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

  // Default: cart view
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
        <span class="text-muted">
          ส่วนลด
          ${disc.type === 'PERCENT' ? `(${disc.value}%)` : disc.type === 'AMOUNT' ? '' : ''}
        </span>
        <span class="${totals.discountAmount > 0 ? 'text-danger' : ''}">
          ${totals.discountAmount > 0 ? '−' : ''}฿${formatMoney(totals.discountAmount)}
        </span>
      </div>
      <div class="flex-between" style="font-size:1.15rem;font-weight:700;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
        <span>ยอดสุทธิ</span>
        <span style="color:var(--primary);">฿${formatMoney(totals.total)}</span>
      </div>
      <div class="grid-2 mt-2" style="gap:8px;">
        <button class="btn btn-outline btn-block" id="btn-pos-discount" ${cart.length === 0 ? 'disabled' : ''}>
          ส่วนลด
        </button>
        <button class="btn btn-primary btn-block btn-lg" id="btn-pos-checkout" ${cart.length === 0 ? 'disabled' : ''} style="height:52px;">
          ชำระเงิน
        </button>
      </div>
    </div>
  `;

  $('#btn-open-scan')?.addEventListener('click', () => {
    ui.setPosMode('scan');
    renderPos();
  });
  $('#btn-open-search')?.addEventListener('click', () => {
    ui.setPosMode('search');
    renderPos();
  });
  $('#btn-pos-discount')?.addEventListener('click', () => {
    ui.setPosMode('discount');
    renderPos();
  });
  $('#btn-clear-cart')?.addEventListener('click', () => {
    if (cart.length === 0) return;
    if (!confirm('ล้างตะกร้าทั้งหมด?')) return;
    clearCart();
    showToast('ล้างตะกร้าแล้ว', 'info');
    renderPosCart();
  });
  $('#btn-pos-checkout')?.addEventListener('click', () => {
    onPosCheckout();
  });

  pageContent.querySelectorAll('.pos-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        const id = btn.dataset.id;
        const item = getCart().find(i => i.productId === id);
        if (!item) return;
        setCartQty(id, item.quantity + 1);
        renderPosCart();
      } catch (err) {
        showToast(err.message, 'error');
      }
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
      } catch (err) {
        showToast(err.message, 'error');
      }
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
      return `<div class="text-muted text-center" style="padding:14px 8px;font-size:0.85rem;">
        ยังไม่มีสินค้า — สแกนบาร์โค้ดด้านบน
      </div>`;
    }
    return cart.map(item => `
      <div class="scan-cart-row" data-id="${escapeHtml(item.productId)}"
           style="display:flex;align-items:center;gap:8px;padding:10px 4px;border-bottom:1px solid var(--border,#e5e7eb);">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${escapeHtml(item.name)}
          </div>
          <div class="text-muted" style="font-size:0.78rem;">
            ฿${formatMoney(item.unitPrice)} × ${item.quantity}
          </div>
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
    <p class="text-center text-muted" style="font-size:0.8rem;margin:6px 0 8px;">
      หันกล้องไปที่บาร์โค้ด · เพิ่มตะกร้าอัตโนมัติ
    </p>

    <div class="card" style="padding:10px;margin-bottom:8px;">
      <div class="flex-between" style="margin-bottom:6px;">
        <span style="font-weight:600;font-size:0.9rem;">รายการที่สแกน</span>
        <strong id="scan-cart-count" style="color:var(--primary);font-size:0.9rem;">
          ${getCart().length} รายการ · ฿${formatMoney(calcTotals().total)}
        </strong>
      </div>
      <div id="scan-cart-items" style="max-height:220px;overflow-y:auto;-webkit-overflow-scrolling:touch;">
        ${buildScanCartListHtml()}
      </div>
      <button class="btn btn-primary btn-block btn-lg mt-2" id="btn-scan-done" style="height:52px;">
        เสร็จสิ้น / ชำระเงิน
      </button>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <input type="text" id="manual-barcode" class="form-control" placeholder="พิมพ์ barcode" inputmode="numeric">
      <button class="btn btn-outline" id="btn-manual-add" style="white-space:nowrap;">เพิ่ม</button>
    </div>
  `;

  $('#btn-scan-close')?.addEventListener('click', async () => {
    await stopScanner();
    ui.setPosMode('cart');
    renderPos();
  });
  $('#btn-scan-done')?.addEventListener('click', async () => {
    await stopScanner();
    ui.setPosMode('cart');
    renderPos();
  });

  const doManual = async () => {
    const code = $('#manual-barcode')?.value.trim();
    if (!code) return;
    await scanAndAdd(code);
    $('#manual-barcode').value = '';
    refreshScanCartUI();
  };
  $('#btn-manual-add')?.addEventListener('click', doManual);
  $('#manual-barcode')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doManual();
    }
  });

  try {
    showLoading('เปิดกล้อง...');
    await startScanner('scanner-region', async (code) => {
      await scanAndAdd(code);
      refreshScanCartUI();
    }, { qrbox: { width: 260, height: 140 } });
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
    <div id="pos-search-results">
      <p class="text-center text-muted" style="padding:20px 0;">พิมพ์เพื่อค้นหา</p>
    </div>
  `;

  $('#btn-search-close')?.addEventListener('click', () => {
    ui.setPosMode('cart');
    renderPos();
  });

  const resultsEl = $('#pos-search-results');
  const doSearch = debounce(async () => {
    const kw = $('#pos-search-input')?.value.trim() || '';
    resultsEl.innerHTML = '<p class="text-center text-muted">กำลังค้นหา...</p>';
    try {
      const list = await searchProductsForPos(kw);
      if (list.length === 0) {
        resultsEl.innerHTML = `
          <div class="card text-center text-muted">
            <p>ไม่พบสินค้า</p>
            ${kw ? `<p style="font-size:0.85rem;">ลองสแกนหรือเพิ่มสินค้าใหม่ในเมนูสินค้า</p>` : ''}
          </div>
        `;
        return;
      }
      resultsEl.innerHTML = list.map(p => {
        const stock = Number(p.stock) || 0;
        const disabled = stock <= 0 || p.status === 'INACTIVE';
        return `
          <div class="card pos-search-item ${disabled ? 'disabled' : ''}" data-id="${escapeHtml(p.id)}"
            style="margin-bottom:8px;padding:12px;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? 0.55 : 1};">
            <div class="flex-between">
              <div style="flex:1;min-width:0;">
                <strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${escapeHtml(p.name)}
                </strong>
                <div class="text-muted" style="font-size:0.8rem;">
                  ${p.barcode ? escapeHtml(p.barcode) + ' · ' : ''}
                  คงเหลือ ${stock} · ฿${formatMoney(p.sellPrice)}
                </div>
              </div>
              <button class="btn btn-primary btn-sm pos-add-btn" data-id="${escapeHtml(p.id)}" ${disabled ? 'disabled' : ''}>
                +
              </button>
            </div>
          </div>
        `;
      }).join('');

      resultsEl.querySelectorAll('.pos-add-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (btn.disabled) return;
          try {
            const product = list.find(p => p.id === btn.dataset.id);
            if (!product) return;
            addToCart(product, 1);
            showToast(`+ ${product.name}`, 'success', 1200);
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      resultsEl.innerHTML = `<p class="text-danger text-center">${escapeHtml(err.message)}</p>`;
    }
  }, 300);

  $('#pos-search-input')?.addEventListener('input', doSearch);
  // โหลดรายการเริ่มต้น
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
      <p class="text-muted" style="font-size:0.9rem;margin-bottom:12px;">
        ยอดก่อนส่วนลด: ฿${formatMoney(totals.subtotal)}
      </p>
      <div class="form-group">
        <label>ประเภทส่วนลด</label>
        <select id="disc-type" class="form-control">
          <option value="NONE" ${disc.type === 'NONE' ? 'selected' : ''}>ไม่มีส่วนลด</option>
          <option value="AMOUNT" ${disc.type === 'AMOUNT' ? 'selected' : ''}>เป็นจำนวนเงิน (บาท)</option>
          <option value="PERCENT" ${disc.type === 'PERCENT' ? 'selected' : ''}>เป็นเปอร์เซ็นต์ (%)</option>
        </select>
      </div>
      <div class="form-group" id="disc-value-group">
        <label>จำนวน</label>
        <input type="number" id="disc-value" class="form-control" min="0" step="0.01"
          value="${disc.type === 'NONE' ? '' : disc.value}" inputmode="decimal" placeholder="0">
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="btn-disc-apply">ใช้ส่วนลด</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-disc-clear">ล้างส่วนลด</button>
    </div>
  `;

  $('#btn-disc-close')?.addEventListener('click', () => {
    ui.setPosMode('cart');
    renderPos();
  });
  $('#btn-disc-clear')?.addEventListener('click', () => {
    setDiscount('NONE', 0);
    showToast('ล้างส่วนลดแล้ว', 'info');
    ui.setPosMode('cart');
    renderPos();
  });
  $('#btn-disc-apply')?.addEventListener('click', () => {
    const type = $('#disc-type').value;
    const value = parseFloat($('#disc-value').value) || 0;
    if (type !== 'NONE' && value <= 0) {
      showToast('กรุณาระบุจำนวนส่วนลด', 'error');
      return;
    }
    if (type === 'PERCENT' && value > 100) {
      showToast('ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100', 'error');
      return;
    }
    setDiscount(type, value);
    const t = calcTotals();
    showToast(`ส่วนลด ฿${formatMoney(t.discountAmount)}`, 'success');
    ui.setPosMode('cart');
    renderPos();
  });
}

/** เก็บ payload ระหว่างหน้าชำระเงิน (กันสร้าง transactionId ใหม่ทุกครั้ง) */
let checkoutPayload = null;
let paymentSubmitting = false;

export async function onPosCheckout() {
  try {
    requireEmployee();
  } catch (e) {
    showToast(e.message, 'error');
    return;
  }
  const cart = getCart();
  if (cart.length === 0) {
    showToast('ตะกร้าว่าง', 'error');
    return;
  }
  // ตรวจกะอีกครั้งก่อนชำระ
  try {
    const shift = await getOpenShift(getCurrentShopId());
    if (!shift) {
      showToast('กะถูกปิดแล้ว — เปิดกะใหม่ก่อนขาย', 'error');
      ui.setPosMode('cart');
      renderPos();
      return;
    }
    window.__posOpenShiftId = shift.id || shift.shiftId || null;
  } catch (e) {
    console.warn(e);
  }
  checkoutPayload = buildCheckoutPayload();
  if (window.__posOpenShiftId) {
    checkoutPayload.shiftId = window.__posOpenShiftId;
  }
  renderPaymentMethod(checkoutPayload);
}

export function renderPaymentMethod(payload) {
  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:8px;">เลือกวิธีชำระเงิน</h2>
      <div class="flex-between" style="font-size:1.25rem;font-weight:700;margin-bottom:16px;">
        <span>ยอดสุทธิ</span>
        <span style="color:var(--primary);">฿${formatMoney(payload.total)}</span>
      </div>
      <button class="btn btn-primary btn-block btn-lg mb-2" id="btn-pay-cash" style="height:56px;">
        💵 เงินสด
      </button>
      <button class="btn btn-outline btn-block btn-lg" id="btn-pay-promptpay" style="height:56px;">
        📱 PromptPay / Thai QR
      </button>
      <button class="btn btn-outline btn-block mt-2" id="btn-pay-back">กลับตะกร้า</button>
    </div>
  `;
  $('#btn-pay-cash')?.addEventListener('click', () => renderCashPayment(payload));
  $('#btn-pay-promptpay')?.addEventListener('click', () => renderPromptPayPayment(payload));
  $('#btn-pay-back')?.addEventListener('click', () => {
    ui.setPosMode('cart');
    renderPos();
  });
}

export function renderCashPayment(payload) {
  const total = payload.total;
  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:8px;">รับเงินสด</h2>
      <div class="text-center" style="margin:16px 0;">
        <div class="text-muted" style="font-size:0.9rem;">ยอดที่ต้องชำระ</div>
        <div style="font-size:2rem;font-weight:800;color:var(--primary);">฿${formatMoney(total)}</div>
      </div>
      <div class="form-group">
        <label>รับเงินมา (บาท)</label>
        <input type="number" id="cash-received" class="form-control" min="0" step="1"
          inputmode="decimal" placeholder="0" style="font-size:1.4rem;text-align:center;height:56px;">
      </div>
      <div class="grid-2 mb-2" style="gap:8px;">
        ${[total, Math.ceil(total / 100) * 100, 100, 500, 1000].filter((v, i, a) => a.indexOf(v) === i && v >= total).slice(0, 4).map(v => `
          <button type="button" class="btn btn-outline cash-quick" data-amt="${v}">฿${formatMoney(v)}</button>
        `).join('')}
      </div>
      <div class="card" style="background:#f8f9fa;margin-bottom:12px;">
        <div class="flex-between">
          <span class="text-muted">เงินทอน</span>
          <strong id="cash-change" style="font-size:1.2rem;">฿0.00</strong>
        </div>
      </div>
      <p id="cash-error" class="text-danger text-center" style="font-size:0.85rem;display:none;margin-bottom:8px;"></p>
      <button class="btn btn-primary btn-block btn-lg" id="btn-confirm-cash" disabled style="height:56px;">
        ยืนยันรับเงิน
      </button>
      <button class="btn btn-outline btn-block mt-1" id="btn-cash-back">เปลี่ยนวิธีชำระ</button>
    </div>
  `;

  const receivedInput = $('#cash-received');
  const changeEl = $('#cash-change');
  const errEl = $('#cash-error');
  const confirmBtn = $('#btn-confirm-cash');

  function updateChange() {
    const received = parseFloat(receivedInput.value) || 0;
    const change = Math.round((received - total) * 100) / 100;
    changeEl.textContent = `฿${formatMoney(Math.max(0, change))}`;
    if (received < total) {
      errEl.style.display = 'block';
      errEl.textContent = 'เงินไม่เพียงพอ';
      confirmBtn.disabled = true;
    } else {
      errEl.style.display = 'none';
      confirmBtn.disabled = false;
    }
  }

  receivedInput?.addEventListener('input', updateChange);
  pageContent.querySelectorAll('.cash-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      receivedInput.value = btn.dataset.amt;
      updateChange();
    });
  });
  receivedInput?.focus();

  $('#btn-cash-back')?.addEventListener('click', () => renderPaymentMethod(payload));
  confirmBtn?.addEventListener('click', async () => {
    const received = parseFloat(receivedInput.value) || 0;
    if (received < total) {
      showToast('เงินไม่เพียงพอ', 'error');
      return;
    }
    const change = Math.round((received - total) * 100) / 100;
    await submitSale(payload, 'CASH', received, change);
  });
}

export async function renderPromptPayPayment(payload) {
  showLoading('โหลดข้อมูลร้าน...');
  let shop;
  try {
    shop = await getShop(getCurrentShopId());
  } finally {
    hideLoading();
  }

  const promptPayId = shop?.promptPayId || '';
  const promptPayName = shop?.promptPayName || shop?.name || '';

  pageContent.innerHTML = `
    <div class="card promptpay-card">
      <h2 style="font-size:1.1rem;margin-bottom:4px;text-align:center;">ชำระด้วย PromptPay</h2>
      <p class="text-center text-muted" style="font-size:0.85rem;margin-bottom:12px;">Thai QR Payment</p>

      <div class="text-center" style="margin-bottom:12px;">
        <div class="text-muted" style="font-size:0.85rem;">ยอดชำระ</div>
        <div style="font-size:1.8rem;font-weight:800;color:var(--primary);">฿${formatMoney(payload.total)}</div>
      </div>

      ${!promptPayId ? `
        <div class="card" style="background:#f8d7da;padding:12px;margin-bottom:12px;">
          <p style="font-size:0.9rem;margin:0;color:#842029;">
            ยังไม่ได้ตั้งค่าหมายเลข PromptPay<br>
            ไปที่ <strong>ตั้งค่า</strong> → กรอกเบอร์ PromptPay (เช่น 08xxxxxxxx)
          </p>
        </div>
      ` : `
        <div id="pp-qr" class="pp-qr-box"></div>
        <p class="text-center" style="font-size:0.9rem;margin-top:10px;">
          <strong>${escapeHtml(promptPayName || 'บัญชีร้าน')}</strong>
        </p>
        <p class="text-center text-muted" style="font-size:0.8rem;">
          PromptPay: ${escapeHtml(promptPayId)}
        </p>
        <p class="text-center text-muted" style="font-size:0.75rem;margin-top:6px;">
          ลูกค้าสแกนด้วยแอปธนาคาร / วอลเล็ต / พอยท์
        </p>
      `}

      <div class="card mt-2" style="background:#e7f1ff;border:1px solid #b6d4fe;padding:10px;">
        <p style="font-size:0.8rem;margin:0;color:#084298;">
          การเปิด QR ยัง<strong>ไม่ถือว่า</strong>ได้รับเงิน<br>
          ตรวจสอบยอดในแอปธนาคาร แล้วกดยืนยันด้านล่าง
        </p>
      </div>

      <button class="btn btn-primary btn-block btn-lg mt-2" id="btn-confirm-pp"
        ${!promptPayId ? 'disabled' : ''} style="height:56px;">
        ✓ ยืนยันได้รับเงินแล้ว
      </button>
      <button class="btn btn-outline btn-block mt-1" id="btn-pp-back">เปลี่ยนวิธีชำระ</button>
    </div>
  `;

  $('#btn-pp-back')?.addEventListener('click', () => renderPaymentMethod(payload));
  $('#btn-confirm-pp')?.addEventListener('click', async () => {
    if (!promptPayId) return;
    if (!confirm('ยืนยันว่าได้รับเงิน PromptPay ครบแล้ว?')) return;
    await submitSale(payload, 'PROMPTPAY', payload.total, 0);
  });

  if (promptPayId) {
    try {
      await renderPromptPayQR('pp-qr', promptPayId, payload.total);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'สร้าง QR ไม่สำเร็จ', 'error');
    }
  }
}

export async function submitSale(payload, paymentMethod, amountReceived, changeAmount) {
  if (paymentSubmitting) return;
  paymentSubmitting = true;
  showLoading(isOnline() ? 'กำลังบันทึกการขาย...' : 'บันทึกแบบ Offline...');
  try {
    // Offline → คิว IndexedDB
    if (!isOnline()) {
      await enqueuePendingSale({
        transactionId: payload.transactionId,
        shopId: payload.shopId,
        payload,
        paymentMethod,
        amountReceived,
        changeAmount
      });
      // ลด stock ในแคช/ตะกร้าเชิง local — stock จริงตัดตอน sync
      clearCart();
      hideLoading();
      checkoutPayload = null;
      showToast('บันทึกออฟไลน์แล้ว จะ sync เมื่อเน็ตกลับ', 'info', 4000);
      renderOfflineSaleSuccess(payload, paymentMethod, amountReceived, changeAmount);
      return;
    }

    try {
      const result = await completeSale({
        payload,
        paymentMethod,
        amountReceived,
        changeAmount
      });
      hideLoading();
      showToast(`ขายสำเร็จ · ${result.receiptNo}`, 'success');
      checkoutPayload = null;
      // รีเฟรช cache สินค้าหลังตัด stock
      refreshProductCache(getCurrentShopId(), listProducts).catch(() => {});
      renderSaleSuccess(result);
    } catch (err) {
      // network error ระหว่างส่ง → คิว offline
      const msg = err.message || '';
      if (msg.includes('network') || msg.includes('unavailable') || msg.includes('Failed to fetch') || !isOnline()) {
        await enqueuePendingSale({
          transactionId: payload.transactionId,
          shopId: payload.shopId,
          payload,
          paymentMethod,
          amountReceived,
          changeAmount
        });
        clearCart();
        hideLoading();
        checkoutPayload = null;
        showToast('เน็ตมีปัญหา — บันทึกออฟไลน์แล้ว', 'info', 4000);
        renderOfflineSaleSuccess(payload, paymentMethod, amountReceived, changeAmount);
      } else {
        throw err;
      }
    }
  } catch (err) {
    hideLoading();
    console.error(err);
    showToast(err.message || 'บันทึกการขายไม่สำเร็จ', 'error');
  } finally {
    paymentSubmitting = false;
  }
}

export function renderOfflineSaleSuccess(payload, paymentMethod, amountReceived, changeAmount) {
  const methodLabel = paymentMethod === 'PROMPTPAY' ? 'PromptPay' : 'เงินสด';
  pageContent.innerHTML = `
    <div class="card text-center">
      <div style="font-size:3rem;margin-bottom:8px;">💾</div>
      <h2 style="font-size:1.2rem;margin-bottom:4px;">บันทึกแบบ Offline</h2>
      <p class="text-muted" style="font-size:0.9rem;">รอ Sync เมื่ออินเทอร์เน็ตกลับมา</p>
      <div style="font-size:1.8rem;font-weight:800;color:var(--warning);margin:16px 0;">
        ฿${formatMoney(payload.total)}
      </div>
      <p style="font-size:0.9rem;">ชำระโดย ${methodLabel}</p>
      ${paymentMethod === 'CASH' ? `
        <p class="text-muted" style="font-size:0.85rem;">
          รับ ฿${formatMoney(amountReceived)} · ทอน ฿${formatMoney(changeAmount)}
        </p>
      ` : ''}
      <div class="card mt-2" style="background:#fff3cd;padding:10px;text-align:left;">
        <p style="font-size:0.8rem;margin:0;">
          • ยังไม่ออกเลขใบเสร็จจริงจนกว่าจะ sync<br>
          • Stock จะถูกตัดตอน sync สำเร็จ<br>
          • อย่าขายซ้ำรายการนี้
        </p>
      </div>
      <button class="btn btn-primary btn-block btn-lg mt-2" id="btn-new-sale">ขายรายการถัดไป</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-sale-home">กลับหน้าหลัก</button>
    </div>
  `;
  $('#btn-new-sale')?.addEventListener('click', () => {
    ui.setPosMode('cart');
    renderPos();
  });
  $('#btn-sale-home')?.addEventListener('click', () => navigate('dashboard'));
}

export function renderSaleSuccess(result) {
  const sale = result.sale;
  const methodLabel = sale.paymentMethod === 'PROMPTPAY' ? 'PromptPay' : 'เงินสด';

  pageContent.innerHTML = `
    <div class="card text-center">
      <div style="font-size:3rem;margin-bottom:8px;">✅</div>
      <h2 style="font-size:1.2rem;margin-bottom:4px;">ชำระเงินสำเร็จ</h2>
      <p class="text-muted" style="font-size:0.9rem;">${escapeHtml(result.receiptNo)}</p>
      <div style="font-size:1.8rem;font-weight:800;color:var(--success);margin:16px 0;">
        ฿${formatMoney(sale.total)}
      </div>
      <p style="font-size:0.9rem;">ชำระโดย ${methodLabel}</p>
      ${sale.paymentMethod === 'CASH' ? `
        <p class="text-muted" style="font-size:0.85rem;">
          รับ ฿${formatMoney(sale.amountReceived)} · ทอน ฿${formatMoney(sale.changeAmount)}
        </p>
      ` : ''}
      <button class="btn btn-primary btn-block btn-lg mt-2" id="btn-print-receipt">
        🖨️ พิมพ์ใบเสร็จ
      </button>
      <button class="btn btn-outline btn-block mt-1" id="btn-new-sale">
        ขายรายการถัดไป
      </button>
      <button class="btn btn-outline btn-block mt-1" id="btn-sale-home">
        กลับหน้าหลัก
      </button>
    </div>
  `;

  $('#btn-print-receipt')?.addEventListener('click', () => openReceiptPrint(result));
  $('#btn-new-sale')?.addEventListener('click', () => {
    ui.setPosMode('cart');
    renderPos();
  });
  $('#btn-sale-home')?.addEventListener('click', () => navigate('dashboard'));
}


