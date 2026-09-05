/**
 * POSMATE — Main Application Controller (Phase 2)
 * Auth + Shop Settings + Employee Management + Basic Dashboard
 */

import { initAuth, waitForAuth, loginWithEmail, logout, setCurrentFromAuth,
         getCurrentUser, getCurrentProfile, getCurrentEmployee, getCurrentRole,
         getCurrentShopId, hasRole, canAccess, switchEmployeeByPin,
         clearCurrentEmployee } from './auth.js';
import {
  getShop, saveShop, listEmployees, getEmployee, saveEmployee, writeAuditLog,
  listCategories, saveCategory, getCategory, countProductsInCategory,
  listProducts, getProduct, getProductByBarcode, saveProduct,
  uploadProductImage, stockIn, adjustStock, listInventoryTransactions,
  getLowStockProducts, listSales, getSale, cancelSale, refundSale,
  getDashboardStats, getOpenShift, openShift, closeShift, listShifts
} from './db.js';
import {
  showToast, showLoading, hideLoading, escapeHtml, formatDateTime, formatMoney,
  hashPin, generateId, compressImage, productStatusLabel, movementTypeLabel, debounce
} from './utils.js';
import { DEFAULT_SHOP_ID, APP_VERSION } from './config.js';
import {
  getCart, getDiscount, clearCart, calcTotals, addToCart, setCartQty,
  removeFromCart, setDiscount, scanAndAdd, startScanner, stopScanner,
  searchProductsForPos, buildCheckoutPayload, requireEmployee
} from './pos.js';
import {
  renderPromptPayQR,
  completeSale,
  openReceiptPrint,
  reprintSale
} from './payment.js';
import {
  initOfflineListeners,
  isOnline,
  onConnectivityChange,
  refreshProductCache,
  enqueuePendingSale,
  syncPendingSales,
  getPendingCount,
  listPendingSales
} from './offline.js';

// ---------- State ----------
let currentPage = 'dashboard';

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const loginScreen = $('#login-screen');
const mainApp = $('#main-app');
const pageContent = $('#page-content');
const headerUser = $('#header-user');
const pinModal = $('#pin-modal');

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', async () => {
  try {
    initAuth();
    initOfflineListeners();
    setupConnectivityBanner();
    const user = await waitForAuth();
    if (user) {
      await setCurrentFromAuth(user);
      showMainApp();
      // cache สินค้า + sync คิว
      refreshProductCache(getCurrentShopId(), listProducts).catch(() => {});
      syncPendingSales(completeSale).then(r => {
        if (r.synced > 0) showToast(`Sync การขาย offline ${r.synced} รายการ`, 'success');
      }).catch(() => {});
    } else {
      showLogin();
    }
  } catch (err) {
    console.error('Boot error:', err);
    showLogin();
    showToast('เกิดข้อผิดพลาดในการเริ่มระบบ', 'error');
  }

  bindEvents();
});

function bindEvents() {
  // Login form
  $('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    const btn = $('#btn-login');
    btn.disabled = true;
    try {
      await loginWithEmail(email, password);
      showMainApp();
      showToast('เข้าสู่ระบบสำเร็จ', 'success');
      refreshProductCache(getCurrentShopId(), listProducts).catch(() => {});
      syncPendingSales(completeSale).then(r => {
        if (r.synced > 0) showToast(`Sync การขาย offline ${r.synced} รายการ`, 'success');
      }).catch(() => {});
    } catch (err) {
      showToast(err.message || 'เข้าสู่ระบบไม่สำเร็จ', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Logout
  $('#btn-logout')?.addEventListener('click', async () => {
    if (!confirm('ต้องการออกจากระบบ?')) return;
    await logout();
    showLogin();
    showToast('ออกจากระบบแล้ว', 'info');
  });

  // Bottom nav
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const page = a.dataset.page;
      if (!page) return;
      navigate(page);
    });
  });

  // PIN modal
  $('#btn-switch-emp')?.addEventListener('click', onSwitchEmployee);
  $('#btn-close-pin')?.addEventListener('click', () => pinModal.classList.remove('active'));
}

// ---------- UI Helpers ----------
function showLogin() {
  loginScreen?.classList.remove('hidden');
  mainApp?.classList.add('hidden');
  pinModal?.classList.remove('active');
}

function showMainApp() {
  loginScreen?.classList.add('hidden');
  mainApp?.classList.remove('hidden');
  updateHeader();
  navigate('dashboard');
}

function updateHeader() {
  const profile = getCurrentProfile();
  const emp = getCurrentEmployee();
  const role = getCurrentRole();
  let text = profile?.displayName || profile?.email || '-';
  if (emp) text += ` · ${emp.firstName || emp.code}`;
  text += ` (${role})`;
  if (headerUser) headerUser.textContent = text;
}

async function navigate(page) {
  // หยุดกล้องเมื่อออกจาก POS
  if (currentPage === 'pos' && page !== 'pos') {
    await stopScanner().catch(() => {});
    posMode = 'cart';
  }

  // Permission gate
  const gates = {
    dashboard: ['ADMIN', 'MANAGER', 'CASHIER'],
    pos: ['ADMIN', 'MANAGER', 'CASHIER'],
    history: ['ADMIN', 'MANAGER', 'CASHIER'],
    products: ['ADMIN', 'MANAGER'],
    employees: ['ADMIN'],
    settings: ['ADMIN', 'MANAGER']
  };
  if (!canAccess(gates[page] || ['ADMIN'])) {
    showToast('คุณไม่มีสิทธิ์เข้าหน้านี้', 'error');
    return;
  }

  currentPage = page;
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });

  // Cashier ไม่เห็นเมนูบางอัน
  const isCashier = getCurrentRole() === 'CASHIER';
  document.querySelector('[data-page="products"]')?.classList.toggle('hidden', isCashier);
  document.querySelector('[data-page="employees"]')?.classList.toggle('hidden', isCashier);
  if (isCashier && getCurrentRole() !== 'ADMIN') {
    document.querySelector('[data-page="settings"]')?.classList.toggle('hidden', true);
  }

  renderPage(page);
}

async function renderPage(page) {
  pageContent.innerHTML = '<div class="text-center text-muted" style="padding:40px 0;">กำลังโหลด...</div>';
  try {
    switch (page) {
      case 'dashboard':
        await renderDashboard();
        break;
      case 'employees':
        await renderEmployees();
        break;
      case 'settings':
        await renderSettings();
        break;
      case 'pos':
        await renderPos();
        break;
      case 'history':
        await renderSalesHistory();
        break;
      case 'products':
        await renderProducts();
        break;
      default:
        pageContent.innerHTML = '<p class="text-center">หน้านี้ยังไม่พร้อม</p>';
    }
  } catch (err) {
    console.error(err);
    pageContent.innerHTML = `<div class="card"><p class="text-danger">เกิดข้อผิดพลาด: ${escapeHtml(err.message)}</p></div>`;
  }
}

// ---------- Dashboard ----------
async function renderDashboard() {
  showLoading('โหลด Dashboard...');
  const shopId = getCurrentShopId();
  const shop = await getShop(shopId);
  const emp = getCurrentEmployee();
  const role = getCurrentRole();

  let stats = null;
  let low = [], out = [];
  let openShiftData = null;
  try {
    const results = await Promise.all([
      getDashboardStats(shopId),
      hasRole('ADMIN', 'MANAGER') ? getLowStockProducts(shopId) : Promise.resolve({ low: [], out: [] }),
      getOpenShift(shopId)
    ]);
    stats = results[0];
    low = results[1].low || [];
    out = results[1].out || [];
    openShiftData = results[2];
  } catch (e) {
    console.warn(e);
  }
  hideLoading();

  const s = stats || {
    totalSales: 0, billCount: 0, cashSales: 0, promptPaySales: 0,
    totalDiscount: 0, grossProfit: 0, itemCount: 0, topProducts: [],
    cancelledCount: 0
  };

  let lowStockHtml = '';
  if ((out.length || low.length) && hasRole('ADMIN', 'MANAGER')) {
    lowStockHtml = `
      <div class="card mb-2" style="border-left:4px solid var(--danger);">
        <h3 style="font-size:0.95rem;margin-bottom:8px;">แจ้งเตือนสต็อก</h3>
        ${out.length ? `<p style="font-size:0.85rem;color:var(--danger);">หมดสต็อก: <strong>${out.length}</strong> รายการ</p>` : ''}
        ${low.length ? `<p style="font-size:0.85rem;color:#b45309;">ใกล้หมด: <strong>${low.length}</strong> รายการ</p>` : ''}
        <button class="btn btn-outline btn-sm mt-1" data-goto="products">ดูสินค้า</button>
      </div>
    `;
  }

  const topHtml = (s.topProducts || []).slice(0, 5).map((p, i) => `
    <div class="flex-between" style="font-size:0.85rem;margin-bottom:4px;">
      <span>${i + 1}. ${escapeHtml(p.name)} × ${p.qty}</span>
      <span>฿${formatMoney(p.revenue)}</span>
    </div>
  `).join('') || '<p class="text-muted" style="font-size:0.85rem;">ยังไม่มีข้อมูล</p>';

  pageContent.innerHTML = `
    <div class="card mb-2">
      <h2 style="font-size:1.1rem;margin-bottom:4px;">${escapeHtml(shop?.name || 'ร้านค้า')}</h2>
      <p class="text-muted" style="font-size:0.85rem;">${escapeHtml(shop?.address || 'ยังไม่ได้ตั้งค่าที่อยู่')}</p>
      ${!emp ? `
        <button class="btn btn-primary btn-block mt-2" id="btn-open-pin">เลือกพนักงาน / ใส่ PIN</button>
      ` : `
        <p class="mt-1" style="font-size:0.9rem;">
          พนักงาน: <strong>${escapeHtml(emp.firstName || '')} ${escapeHtml(emp.lastName || '')}</strong> (${escapeHtml(emp.code)})
        </p>
        <button class="btn btn-outline btn-sm mt-1" id="btn-open-pin">เปลี่ยนพนักงาน</button>
      `}
    </div>

    <div class="card mb-2">
      <div class="flex-between" style="margin-bottom:10px;">
        <h3 style="font-size:0.95rem;margin:0;">ยอดขายวันนี้</h3>
        <button class="btn btn-outline btn-sm" id="btn-open-reports">รายงาน</button>
      </div>
      <div class="grid-2" style="gap:8px;margin-bottom:10px;">
        <div class="stat-box">
          <div class="stat-label">ยอดสุทธิ</div>
          <div class="stat-value" style="color:var(--primary);">฿${formatMoney(s.totalSales)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">จำนวนบิล</div>
          <div class="stat-value">${s.billCount}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">เงินสด</div>
          <div class="stat-value">฿${formatMoney(s.cashSales)}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">PromptPay</div>
          <div class="stat-value">฿${formatMoney(s.promptPaySales)}</div>
        </div>
      </div>
      ${hasRole('ADMIN', 'MANAGER') ? `
        <div class="grid-2" style="gap:8px;">
          <div class="stat-box">
            <div class="stat-label">ส่วนลด</div>
            <div class="stat-value">฿${formatMoney(s.totalDiscount)}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">กำไรขั้นต้น</div>
            <div class="stat-value" style="color:var(--success);">฿${formatMoney(s.grossProfit)}</div>
          </div>
        </div>
        <p class="text-muted" style="font-size:0.75rem;margin-top:8px;">
          ต้นทุน ฿${formatMoney(s.totalCost || 0)} · สินค้าขาย ${s.itemCount || 0} ชิ้น
          ${s.cancelledCount ? ` · ยกเลิก ${s.cancelledCount} บิล` : ''}
        </p>
      ` : ''}
    </div>

    ${hasRole('ADMIN', 'MANAGER') ? `
      <div class="card mb-2">
        <h3 style="font-size:0.95rem;margin-bottom:8px;">สินค้าขายดีวันนี้</h3>
        ${topHtml}
      </div>
    ` : ''}

    ${lowStockHtml}

    <div class="card mb-2">
      <h3 style="font-size:0.95rem;margin-bottom:8px;">กะทำงาน</h3>
      ${openShiftData ? `
        <p style="font-size:0.85rem;">
          สถานะ: <strong style="color:var(--success);">เปิดอยู่</strong><br>
          เปิดเมื่อ: ${formatDateTime(openShiftData.openedAt)}<br>
          เงินทอนเริ่มต้น: ฿${formatMoney(openShiftData.openingCash || 0)}
        </p>
        <button class="btn btn-primary btn-block mt-1" id="btn-close-shift">ปิดกะ / สรุปยอด</button>
      ` : `
        <p class="text-muted" style="font-size:0.85rem;">ยังไม่ได้เปิดกะ</p>
        <button class="btn btn-outline btn-block mt-1" id="btn-open-shift">เปิดกะ</button>
      `}
    </div>

    <div class="grid-2 mb-2">
      <a href="#pos" class="action-btn" data-goto="pos">
        <span class="icon">🛒</span><span>ขายสินค้า</span>
      </a>
      <a href="#history" class="action-btn" data-goto="history">
        <span class="icon">📋</span><span>ประวัติขาย</span>
      </a>
      ${hasRole('ADMIN', 'MANAGER') ? `
        <a href="#products" class="action-btn" data-goto="products">
          <span class="icon">📦</span><span>สินค้า</span>
        </a>
        <a href="#settings" class="action-btn" data-goto="settings">
          <span class="icon">⚙️</span><span>ตั้งค่า</span>
        </a>
      ` : ''}
    </div>

    <p class="text-center text-muted" style="font-size:0.75rem;">v${APP_VERSION} · ${role}</p>
  `;

  $('#btn-open-pin')?.addEventListener('click', () => {
    pinModal.classList.add('active');
    $('#emp-code').value = '';
    $('#emp-pin').value = '';
    $('#emp-code').focus();
  });
  pageContent.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.goto);
    });
  });
  $('#btn-open-reports')?.addEventListener('click', () => renderReports());
  $('#btn-open-shift')?.addEventListener('click', () => openShiftForm());
  $('#btn-close-shift')?.addEventListener('click', () => closeShiftForm(openShiftData));
}

async function renderReports() {
  if (!hasRole('ADMIN', 'MANAGER', 'CASHIER')) {
    showToast('ไม่มีสิทธิ์', 'error');
    return;
  }
  showLoading('โหลดรายงาน...');
  const shopId = getCurrentShopId();

  // presets
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const ranges = {
    today: { label: 'วันนี้', from: today, to: today },
    yesterday: { label: 'เมื่อวาน', from: yesterday, to: yesterday },
    week: { label: '7 วัน', from: weekAgo, to: today },
    month: { label: 'เดือนนี้', from: monthStart, to: today }
  };

  let current = 'today';
  let stats = await getDashboardStats(shopId, ranges.today.from, ranges.today.to);
  hideLoading();

  function paint() {
    const s = stats;
    const topHtml = (s.topProducts || []).map((p, i) => `
      <div class="flex-between" style="font-size:0.85rem;margin-bottom:6px;">
        <span>${i + 1}. ${escapeHtml(p.name)} <span class="text-muted">×${p.qty}</span></span>
        <span>
          ฿${formatMoney(p.revenue)}
          ${hasRole('ADMIN', 'MANAGER') ? `<span class="text-muted">(กำไร ฿${formatMoney(p.revenue - p.cost)})</span>` : ''}
        </span>
      </div>
    `).join('') || '<p class="text-muted">ไม่มีข้อมูล</p>';

    pageContent.innerHTML = `
      <div class="flex-between mb-2">
        <h2 style="font-size:1.15rem;">รายงาน</h2>
        <button class="btn btn-outline btn-sm" id="btn-rep-back">กลับ</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;" id="range-btns">
        ${Object.entries(ranges).map(([k, v]) => `
          <button class="btn btn-sm ${current === k ? 'btn-primary' : 'btn-outline'} range-btn" data-range="${k}">${v.label}</button>
        `).join('')}
      </div>
      <div class="card mb-2">
        <h3 style="font-size:0.95rem;margin-bottom:10px;">สรุปยอด · ${ranges[current].label}</h3>
        <div class="grid-2" style="gap:8px;">
          <div class="stat-box"><div class="stat-label">ยอดสุทธิ</div><div class="stat-value" style="color:var(--primary);">฿${formatMoney(s.totalSales)}</div></div>
          <div class="stat-box"><div class="stat-label">จำนวนบิล</div><div class="stat-value">${s.billCount}</div></div>
          <div class="stat-box"><div class="stat-label">เงินสด</div><div class="stat-value">฿${formatMoney(s.cashSales)}</div></div>
          <div class="stat-box"><div class="stat-label">PromptPay</div><div class="stat-value">฿${formatMoney(s.promptPaySales)}</div></div>
          <div class="stat-box"><div class="stat-label">ส่วนลด</div><div class="stat-value">฿${formatMoney(s.totalDiscount)}</div></div>
          <div class="stat-box"><div class="stat-label">ชิ้นที่ขาย</div><div class="stat-value">${s.itemCount}</div></div>
          ${hasRole('ADMIN', 'MANAGER') ? `
            <div class="stat-box"><div class="stat-label">ต้นทุน</div><div class="stat-value">฿${formatMoney(s.totalCost)}</div></div>
            <div class="stat-box"><div class="stat-label">กำไรขั้นต้น</div><div class="stat-value" style="color:var(--success);">฿${formatMoney(s.grossProfit)}</div></div>
          ` : ''}
        </div>
        ${s.cancelledCount ? `<p class="text-muted" style="font-size:0.8rem;margin-top:8px;">บิลยกเลิก: ${s.cancelledCount}</p>` : ''}
      </div>
      <div class="card mb-2">
        <h3 style="font-size:0.95rem;margin-bottom:8px;">สินค้าขายดี</h3>
        ${topHtml}
      </div>
      <button class="btn btn-outline btn-block" id="btn-rep-history">ดูประวัติรายบิล</button>
    `;

    $('#btn-rep-back')?.addEventListener('click', () => navigate('dashboard'));
    $('#btn-rep-history')?.addEventListener('click', () => navigate('history'));
    pageContent.querySelectorAll('.range-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        current = btn.dataset.range;
        showLoading();
        stats = await getDashboardStats(shopId, ranges[current].from, ranges[current].to);
        hideLoading();
        paint();
      });
    });
  }
  paint();
}

function openShiftForm() {
  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:12px;">เปิดกะ</h2>
      <div class="form-group">
        <label>เงินทอนเริ่มต้นในลิ้นชัก (บาท)</label>
        <input type="number" id="shift-opening" class="form-control" value="0" min="0" step="1" inputmode="decimal">
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="btn-shift-start">เริ่มกะ</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-shift-cancel">ยกเลิก</button>
    </div>
  `;
  $('#btn-shift-cancel')?.addEventListener('click', () => navigate('dashboard'));
  $('#btn-shift-start')?.addEventListener('click', async () => {
    try {
      requireEmployee();
    } catch (e) {
      showToast(e.message, 'error');
      return;
    }
    const opening = parseFloat($('#shift-opening').value) || 0;
    showLoading('กำลังเปิดกะ...');
    try {
      await openShift({
        shopId: getCurrentShopId(),
        employeeId: getCurrentEmployee()?.id,
        userId: getCurrentUser()?.uid,
        openingCash: opening
      });
      hideLoading();
      showToast('เปิดกะแล้ว', 'success');
      navigate('dashboard');
    } catch (err) {
      hideLoading();
      showToast(err.message || 'เปิดกะไม่สำเร็จ', 'error');
    }
  });
}

async function closeShiftForm(shift) {
  if (!shift) return;
  showLoading('สรุปยอดกะ...');
  let stats;
  try {
    const openedAt = shift.openedAt?.toDate?.() || new Date();
    stats = await getDashboardStats(getCurrentShopId(), openedAt, new Date());
  } catch (e) {
    stats = { totalSales: 0, cashSales: 0, promptPaySales: 0, billCount: 0 };
  }
  hideLoading();

  const expected = (Number(shift.openingCash) || 0) + (stats.cashSales || 0);

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:12px;">ปิดกะ / สรุปยอด</h2>
      <div class="stat-box mb-2" style="text-align:left;">
        <div class="flex-between" style="margin-bottom:4px;"><span class="text-muted">ยอดขายรวม</span><strong>฿${formatMoney(stats.totalSales)}</strong></div>
        <div class="flex-between" style="margin-bottom:4px;"><span class="text-muted">เงินสด</span><strong>฿${formatMoney(stats.cashSales)}</strong></div>
        <div class="flex-between" style="margin-bottom:4px;"><span class="text-muted">PromptPay</span><strong>฿${formatMoney(stats.promptPaySales)}</strong></div>
        <div class="flex-between" style="margin-bottom:4px;"><span class="text-muted">จำนวนบิล</span><strong>${stats.billCount}</strong></div>
        <div class="flex-between" style="margin-bottom:4px;"><span class="text-muted">เงินทอนเริ่มต้น</span><strong>฿${formatMoney(shift.openingCash || 0)}</strong></div>
        <div class="flex-between"><span class="text-muted">เงินสดที่ระบบคาดว่ามี</span><strong style="color:var(--primary);">฿${formatMoney(expected)}</strong></div>
      </div>
      <div class="form-group">
        <label>เงินสดที่นับได้จริง *</label>
        <input type="number" id="shift-counted" class="form-control" min="0" step="1" inputmode="decimal" placeholder="0" style="font-size:1.2rem;text-align:center;height:52px;">
      </div>
      <div class="form-group">
        <label>หมายเหตุ</label>
        <textarea id="shift-note" class="form-control" rows="2"></textarea>
      </div>
      <p id="shift-diff" class="text-center" style="font-size:0.9rem;margin-bottom:8px;"></p>
      <button class="btn btn-primary btn-block btn-lg" id="btn-shift-close">ยืนยันปิดกะ</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-shift-back">กลับ</button>
    </div>
  `;

  const countedInput = $('#shift-counted');
  const diffEl = $('#shift-diff');
  countedInput?.addEventListener('input', () => {
    const c = parseFloat(countedInput.value);
    if (isNaN(c)) { diffEl.textContent = ''; return; }
    const d = Math.round((c - expected) * 100) / 100;
    if (d === 0) diffEl.innerHTML = '<span class="text-success">ตรงกับระบบ</span>';
    else if (d > 0) diffEl.innerHTML = `<span class="text-success">เกิน ฿${formatMoney(d)}</span>`;
    else diffEl.innerHTML = `<span class="text-danger">ขาด ฿${formatMoney(Math.abs(d))}</span>`;
  });

  $('#btn-shift-back')?.addEventListener('click', () => navigate('dashboard'));
  $('#btn-shift-close')?.addEventListener('click', async () => {
    try { requireEmployee(); } catch (e) { showToast(e.message, 'error'); return; }
    const counted = parseFloat(countedInput.value);
    if (isNaN(counted) || counted < 0) {
      showToast('กรุณากรอกเงินสดที่นับได้', 'error');
      return;
    }
    if (!confirm('ยืนยันปิดกะ?')) return;
    showLoading('กำลังปิดกะ...');
    try {
      const result = await closeShift({
        shopId: getCurrentShopId(),
        shiftId: shift.id,
        employeeId: getCurrentEmployee()?.id,
        userId: getCurrentUser()?.uid,
        countedCash: counted,
        note: $('#shift-note')?.value.trim() || null
      });
      hideLoading();
      showToast('ปิดกะสำเร็จ', 'success');
      pageContent.innerHTML = `
        <div class="card text-center">
          <div style="font-size:2.5rem;">✅</div>
          <h2 style="font-size:1.1rem;margin:8px 0;">ปิดกะเรียบร้อย</h2>
          <p>ยอดขาย ฿${formatMoney(result.stats.totalSales)}</p>
          <p>เงินสดคาดว่า ฿${formatMoney(result.expectedCash)}</p>
          <p>นับได้ ฿${formatMoney(result.countedCash)}</p>
          <p class="${result.difference === 0 ? 'text-success' : result.difference > 0 ? 'text-success' : 'text-danger'}">
            ${result.difference === 0 ? 'ตรงกัน' : result.difference > 0 ? 'เกิน ฿' + formatMoney(result.difference) : 'ขาด ฿' + formatMoney(Math.abs(result.difference))}
          </p>
          <button class="btn btn-primary btn-block mt-2" id="btn-shift-done">กลับหน้าหลัก</button>
        </div>
      `;
      $('#btn-shift-done')?.addEventListener('click', () => navigate('dashboard'));
    } catch (err) {
      hideLoading();
      showToast(err.message || 'ปิดกะไม่สำเร็จ', 'error');
    }
  });
}

// ---------- Employees ----------
async function renderEmployees() {
  if (!hasRole('ADMIN')) {
    pageContent.innerHTML = '<div class="card"><p>เฉพาะ Admin เท่านั้น</p></div>';
    return;
  }

  showLoading('โหลดรายชื่อพนักงาน...');
  const list = await listEmployees(getCurrentShopId());
  hideLoading();

  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.15rem;">พนักงาน</h2>
      <button class="btn btn-primary btn-sm" id="btn-add-emp">+ เพิ่ม</button>
    </div>
    <div id="emp-list">
      ${list.length === 0 ? `
        <div class="card text-center text-muted">
          <p>ยังไม่มีพนักงาน</p>
          <p style="font-size:0.85rem;">กดปุ่ม "เพิ่ม" เพื่อสร้างพนักงานคนแรก</p>
        </div>
      ` : list.map(emp => `
        <div class="card emp-card" data-id="${escapeHtml(emp.id)}" style="margin-bottom:10px;cursor:pointer;">
          <div class="flex-between">
            <div>
              <strong>${escapeHtml(emp.code)} — ${escapeHtml(emp.firstName || '')} ${escapeHtml(emp.lastName || '')}</strong>
              <div class="text-muted" style="font-size:0.8rem;">
                ${escapeHtml(emp.role || 'CASHIER')} · ${emp.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด'}
              </div>
            </div>
            <span style="font-size:1.2rem;">›</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  $('#btn-add-emp')?.addEventListener('click', () => openEmployeeForm(null));
  pageContent.querySelectorAll('.emp-card').forEach(card => {
    card.addEventListener('click', () => openEmployeeForm(card.dataset.id));
  });
}

async function openEmployeeForm(employeeId) {
  let emp = null;
  if (employeeId) {
    showLoading();
    emp = await getEmployee(employeeId);
    hideLoading();
  }

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:16px;">${emp ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงานใหม่'}</h2>
      <form id="emp-form">
        <div class="form-group">
          <label>รหัสพนักงาน *</label>
          <input type="text" id="f-code" class="form-control" value="${escapeHtml(emp?.code || '')}" required inputmode="numeric" placeholder="001">
        </div>
        <div class="form-group">
          <label>ชื่อ *</label>
          <input type="text" id="f-first" class="form-control" value="${escapeHtml(emp?.firstName || '')}" required>
        </div>
        <div class="form-group">
          <label>นามสกุล</label>
          <input type="text" id="f-last" class="form-control" value="${escapeHtml(emp?.lastName || '')}">
        </div>
        <div class="form-group">
          <label>เบอร์โทร</label>
          <input type="tel" id="f-phone" class="form-control" value="${escapeHtml(emp?.phone || '')}">
        </div>
        <div class="form-group">
          <label>ตำแหน่ง / Role *</label>
          <select id="f-role" class="form-control">
            <option value="CASHIER" ${emp?.role === 'CASHIER' ? 'selected' : ''}>แคชเชียร์ (CASHIER)</option>
            <option value="MANAGER" ${emp?.role === 'MANAGER' ? 'selected' : ''}>ผู้จัดการ (MANAGER)</option>
            <option value="ADMIN" ${emp?.role === 'ADMIN' ? 'selected' : ''}>แอดมิน (ADMIN)</option>
          </select>
        </div>
        <div class="form-group">
          <label>PIN (4–6 หลัก) ${emp ? '(ว่างไว้ถ้าไม่เปลี่ยน)' : '*'}</label>
          <input type="password" id="f-pin" class="form-control pin-input" maxlength="6" inputmode="numeric" ${emp ? '' : 'required'} placeholder="••••">
        </div>
        <div class="form-group">
          <label>สถานะ</label>
          <select id="f-status" class="form-control">
            <option value="ACTIVE" ${!emp || emp.status === 'ACTIVE' ? 'selected' : ''}>ใช้งาน</option>
            <option value="INACTIVE" ${emp?.status === 'INACTIVE' ? 'selected' : ''}>ปิดการใช้งาน</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">บันทึก</button>
        <button type="button" class="btn btn-outline btn-block mt-1" id="btn-cancel-emp">ยกเลิก</button>
      </form>
    </div>
  `;

  $('#btn-cancel-emp').addEventListener('click', () => renderEmployees());
  $('#emp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveEmployeeForm(employeeId);
  });
}

async function saveEmployeeForm(employeeId) {
  const code = $('#f-code').value.trim();
  const firstName = $('#f-first').value.trim();
  const lastName = $('#f-last').value.trim();
  const phone = $('#f-phone').value.trim();
  const role = $('#f-role').value;
  const pin = $('#f-pin').value.trim();
  const status = $('#f-status').value;

  if (!code || !firstName) {
    showToast('กรุณากรอกรหัสและชื่อ', 'error');
    return;
  }
  if (!employeeId && (!pin || pin.length < 4)) {
    showToast('PIN ต้องมีอย่างน้อย 4 หลัก', 'error');
    return;
  }
  if (pin && (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin))) {
    showToast('PIN ต้องเป็นตัวเลข 4–6 หลัก', 'error');
    return;
  }

  showLoading('กำลังบันทึก...');
  try {
    const shopId = getCurrentShopId();
    const data = {
      shopId,
      code,
      firstName,
      lastName,
      phone,
      role,
      status
    };
    if (pin) {
      data.pinHash = await hashPin(pin);
    }

    const id = await saveEmployee(employeeId, data);

    await writeAuditLog({
      shopId,
      userId: getCurrentUser()?.uid,
      employeeId: getCurrentEmployee()?.id,
      action: employeeId ? 'UPDATE_EMPLOYEE' : 'CREATE_EMPLOYEE',
      module: 'EMPLOYEE',
      targetId: id || employeeId,
      newValue: { code, firstName, role, status }
    });

    hideLoading();
    showToast('บันทึกพนักงานสำเร็จ', 'success');
    renderEmployees();
  } catch (err) {
    hideLoading();
    console.error(err);
    showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
  }
}

// ---------- Settings (Shop) ----------
async function renderSettings() {
  if (!hasRole('ADMIN', 'MANAGER')) {
    pageContent.innerHTML = '<div class="card"><p>ไม่มีสิทธิ์</p></div>';
    return;
  }

  showLoading('โหลดข้อมูลร้าน...');
  const shop = await getShop(getCurrentShopId()) || {};
  hideLoading();

  const isAdmin = hasRole('ADMIN');

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:16px;">ตั้งค่าข้อมูลร้าน</h2>
      <form id="shop-form">
        <div class="form-group">
          <label>ชื่อร้าน *</label>
          <input type="text" id="s-name" class="form-control" value="${escapeHtml(shop.name || '')}" required ${isAdmin ? '' : 'readonly'}>
        </div>
        <div class="form-group">
          <label>ที่อยู่</label>
          <textarea id="s-address" class="form-control" rows="2" ${isAdmin ? '' : 'readonly'}>${escapeHtml(shop.address || '')}</textarea>
        </div>
        <div class="form-group">
          <label>เบอร์โทรร้าน</label>
          <input type="tel" id="s-phone" class="form-control" value="${escapeHtml(shop.phone || '')}" ${isAdmin ? '' : 'readonly'}>
        </div>
        <div class="form-group">
          <label>ข้อความท้ายใบเสร็จ</label>
          <textarea id="s-footer" class="form-control" rows="2" ${isAdmin ? '' : 'readonly'}>${escapeHtml(shop.receiptFooter || '')}</textarea>
        </div>
        <hr style="margin:16px 0;border:none;border-top:1px solid var(--border);">
        <h3 style="font-size:0.95rem;margin-bottom:12px;">PromptPay</h3>
        <div class="form-group">
          <label>หมายเลข PromptPay (เบอร์โทร / เลขบัตรประชาชน)</label>
          <input type="text" id="s-promptpay" class="form-control" value="${escapeHtml(shop.promptPayId || '')}" ${isAdmin ? '' : 'readonly'} placeholder="0812345678">
        </div>
        <div class="form-group">
          <label>ชื่อบัญชี PromptPay</label>
          <input type="text" id="s-promptpay-name" class="form-control" value="${escapeHtml(shop.promptPayName || '')}" ${isAdmin ? '' : 'readonly'}>
        </div>
        <div class="form-group">
          <label>สกุลเงิน</label>
          <input type="text" id="s-currency" class="form-control" value="${escapeHtml(shop.currency || 'THB')}" ${isAdmin ? '' : 'readonly'}>
        </div>
        ${isAdmin ? `
          <button type="submit" class="btn btn-primary btn-block btn-lg">บันทึกการตั้งค่า</button>
        ` : `<p class="text-muted text-center">เฉพาะ Admin แก้ไขได้</p>`}
      </form>
    </div>
  `;

  if (isAdmin) {
    $('#shop-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveShopForm(shop);
    });
  }
}

async function saveShopForm(oldShop) {
  const data = {
    name: $('#s-name').value.trim(),
    address: $('#s-address').value.trim(),
    phone: $('#s-phone').value.trim(),
    receiptFooter: $('#s-footer').value.trim(),
    promptPayId: $('#s-promptpay').value.trim(),
    promptPayName: $('#s-promptpay-name').value.trim(),
    currency: $('#s-currency').value.trim() || 'THB'
  };

  if (!data.name) {
    showToast('กรุณากรอกชื่อร้าน', 'error');
    return;
  }

  showLoading('กำลังบันทึก...');
  try {
    const shopId = getCurrentShopId();
    await saveShop(shopId, data);
    await writeAuditLog({
      shopId,
      userId: getCurrentUser()?.uid,
      employeeId: getCurrentEmployee()?.id,
      action: 'UPDATE_SHOP',
      module: 'SETTINGS',
      targetId: shopId,
      oldValue: {
        name: oldShop?.name ?? null,
        promptPayId: oldShop?.promptPayId ?? null,
        promptPayName: oldShop?.promptPayName ?? null
      },
      newValue: {
        name: data.name,
        promptPayId: data.promptPayId || null,
        promptPayName: data.promptPayName || null
      }
    });
    hideLoading();
    showToast('บันทึกข้อมูลร้านสำเร็จ', 'success');
    renderSettings();
  } catch (err) {
    hideLoading();
    console.error(err);
    showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
  }
}

// =====================================================
// Phase 4 — POS Core
// =====================================================

let posMode = 'cart'; // cart | scan | search | discount

async function renderPos() {
  // หยุดสแกนเนอร์เมื่อออกจากโหมด scan
  if (posMode !== 'scan') {
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

  if (posMode === 'scan') {
    await renderPosScan();
    return;
  }
  if (posMode === 'search') {
    await renderPosSearch();
    return;
  }
  if (posMode === 'discount') {
    renderPosDiscount();
    return;
  }

  // Default: cart view
  renderPosCart();
}

function renderPosCart() {
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
    posMode = 'scan';
    renderPos();
  });
  $('#btn-open-search')?.addEventListener('click', () => {
    posMode = 'search';
    renderPos();
  });
  $('#btn-pos-discount')?.addEventListener('click', () => {
    posMode = 'discount';
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

async function renderPosScan() {
  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">สแกน Barcode</h2>
      <button class="btn btn-outline btn-sm" id="btn-scan-close">ปิด</button>
    </div>
    <div id="scanner-region" class="scanner-region"></div>
    <p class="text-center text-muted mt-2" style="font-size:0.85rem;">
      หันกล้องไปที่บาร์โค้ด · สแกนแล้วเพิ่มตะกร้าอัตโนมัติ
    </p>
    <div class="card mt-2" style="padding:10px;">
      <div class="flex-between" style="margin-bottom:6px;">
        <span class="text-muted" style="font-size:0.85rem;">ตะกร้า</span>
        <strong id="scan-cart-count">${getCart().length} รายการ · ฿${formatMoney(calcTotals().total)}</strong>
      </div>
      <button class="btn btn-primary btn-block" id="btn-scan-done">เสร็จสิ้น / ดูตะกร้า</button>
    </div>
    <div class="mt-2">
      <p class="text-muted text-center" style="font-size:0.8rem;margin-bottom:8px;">หรือพิมพ์รหัส</p>
      <div style="display:flex;gap:8px;">
        <input type="text" id="manual-barcode" class="form-control" placeholder="Barcode / รหัส" inputmode="numeric">
        <button class="btn btn-primary" id="btn-manual-add" style="white-space:nowrap;">เพิ่ม</button>
      </div>
    </div>
  `;

  $('#btn-scan-close')?.addEventListener('click', async () => {
    await stopScanner();
    posMode = 'cart';
    renderPos();
  });
  $('#btn-scan-done')?.addEventListener('click', async () => {
    await stopScanner();
    posMode = 'cart';
    renderPos();
  });

  const doManual = async () => {
    const code = $('#manual-barcode')?.value.trim();
    if (!code) return;
    await scanAndAdd(code);
    $('#manual-barcode').value = '';
    const t = calcTotals();
    const el = $('#scan-cart-count');
    if (el) el.textContent = `${getCart().length} รายการ · ฿${formatMoney(t.total)}`;
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
      const t = calcTotals();
      const el = $('#scan-cart-count');
      if (el) el.textContent = `${getCart().length} รายการ · ฿${formatMoney(t.total)}`;
    });
    hideLoading();
  } catch (err) {
    hideLoading();
    console.error(err);
    showToast(err.message || 'เปิดกล้องไม่สำเร็จ — ใช้พิมพ์รหัสแทนได้', 'error');
  }
}

async function renderPosSearch() {
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
    posMode = 'cart';
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

function renderPosDiscount() {
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
    posMode = 'cart';
    renderPos();
  });
  $('#btn-disc-clear')?.addEventListener('click', () => {
    setDiscount('NONE', 0);
    showToast('ล้างส่วนลดแล้ว', 'info');
    posMode = 'cart';
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
    posMode = 'cart';
    renderPos();
  });
}

/** เก็บ payload ระหว่างหน้าชำระเงิน (กันสร้าง transactionId ใหม่ทุกครั้ง) */
let checkoutPayload = null;
let paymentSubmitting = false;

function onPosCheckout() {
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
  checkoutPayload = buildCheckoutPayload();
  renderPaymentMethod(checkoutPayload);
}

function renderPaymentMethod(payload) {
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
    posMode = 'cart';
    renderPos();
  });
}

function renderCashPayment(payload) {
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

async function renderPromptPayPayment(payload) {
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

async function submitSale(payload, paymentMethod, amountReceived, changeAmount) {
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

function renderOfflineSaleSuccess(payload, paymentMethod, amountReceived, changeAmount) {
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
    posMode = 'cart';
    renderPos();
  });
  $('#btn-sale-home')?.addEventListener('click', () => navigate('dashboard'));
}

function setupConnectivityBanner() {
  let banner = document.getElementById('connectivity-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'connectivity-banner';
    banner.className = 'connectivity-banner';
    document.body.appendChild(banner);
  }
  const update = async (online) => {
    const pending = await getPendingCount().catch(() => 0);
    if (!online) {
      banner.textContent = pending > 0
        ? `⚡ Offline · คิวรอ sync ${pending} รายการ`
        : '⚡ Offline — ขายได้จากแคชสินค้า';
      banner.classList.add('show', 'offline');
      banner.classList.remove('online');
    } else if (pending > 0) {
      banner.textContent = `🔄 Online · มี ${pending} รายการรอ sync — แตะเพื่อ sync`;
      banner.classList.add('show', 'online');
      banner.classList.remove('offline');
      banner.onclick = async () => {
        showLoading('กำลัง sync...');
        const r = await syncPendingSales(completeSale);
        hideLoading();
        if (r.synced) showToast(`Sync สำเร็จ ${r.synced} รายการ`, 'success');
        if (r.failed) showToast(`Sync ไม่สำเร็จ ${r.failed} รายการ`, 'error');
        update(true);
        if (currentPage === 'dashboard') navigate('dashboard');
      };
    } else {
      banner.classList.remove('show');
      banner.onclick = null;
    }
  };
  onConnectivityChange(update);
  update(isOnline());
}

function renderSaleSuccess(result) {
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
    posMode = 'cart';
    renderPos();
  });
  $('#btn-sale-home')?.addEventListener('click', () => navigate('dashboard'));
}

// =====================================================
// Phase 3 — Products / Categories / Stock
// =====================================================

let productFilter = { search: '', status: 'ALL', categoryId: '' };

async function renderProducts() {
  if (!hasRole('ADMIN', 'MANAGER')) {
    pageContent.innerHTML = '<div class="card"><p>เฉพาะ Admin / Manager เท่านั้น</p></div>';
    return;
  }

  showLoading('โหลดสินค้า...');
  const shopId = getCurrentShopId();
  const [products, categories] = await Promise.all([
    listProducts(shopId, {
      status: productFilter.status,
      categoryId: productFilter.categoryId || undefined,
      search: productFilter.search || undefined
    }),
    listCategories(shopId)
  ]);
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

async function openProductDetail(productId) {
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

async function openProductForm(productId) {
  showLoading();
  const [product, categories] = await Promise.all([
    productId ? getProduct(productId) : null,
    listCategories(getCurrentShopId())
  ]);
  hideLoading();

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:16px;">${product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h2>
      <form id="product-form">
        <div class="form-group">
          <label>ชื่อสินค้า *</label>
          <input type="text" id="p-name" class="form-control" value="${escapeHtml(product?.name || '')}" required>
        </div>
        <div class="form-group">
          <label>Barcode</label>
          <input type="text" id="p-barcode" class="form-control" value="${escapeHtml(product?.barcode || '')}" placeholder="สแกนหรือพิมพ์">
        </div>
        <div class="form-group">
          <label>SKU / รหัสร้าน</label>
          <input type="text" id="p-sku" class="form-control" value="${escapeHtml(product?.sku || '')}">
        </div>
        <div class="form-group">
          <label>หมวดหมู่</label>
          <select id="p-category" class="form-control">
            <option value="">— ไม่ระบุ —</option>
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

  $('#p-image')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    $('#p-image-preview').innerHTML = `<img src="${url}" style="max-width:120px;border-radius:8px;">`;
  });

  $('#btn-cancel-product').addEventListener('click', () => {
    if (productId) openProductDetail(productId);
    else renderProducts();
  });

  $('#product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveProductForm(productId, product);
  });
}

async function saveProductForm(productId, oldProduct) {
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
  if (isNaN(costPrice) || costPrice < 0 || isNaN(sellPrice) || sellPrice < 0) {
    showToast('ราคาไม่ถูกต้อง', 'error');
    return;
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
      sku: sku || null,
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

async function openStockInForm(productId) {
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

async function openAdjustStockForm(productId) {
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

async function openStockHistory(productId) {
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
async function renderCategories() {
  showLoading();
  const categories = await listCategories(getCurrentShopId());
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

async function openCategoryForm(categoryId) {
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

// ---------- PIN Switch ----------
async function onSwitchEmployee() {
  const code = $('#emp-code').value.trim();
  const pin = $('#emp-pin').value.trim();
  if (!code || !pin) {
    showToast('กรุณากรอกรหัสและ PIN', 'error');
    return;
  }
  const btn = $('#btn-switch-emp');
  btn.disabled = true;
  try {
    const emp = await switchEmployeeByPin(code, pin);
    pinModal.classList.remove('active');
    updateHeader();
    showToast(`เข้างาน: ${emp.firstName || emp.code}`, 'success');
    if (currentPage === 'dashboard') renderDashboard();
    if (currentPage === 'pos') {
      posMode = 'cart';
      renderPos();
    }
  } catch (err) {
    showToast(err.message || 'สลับพนักงานไม่สำเร็จ', 'error');
  } finally {
    btn.disabled = false;
  }
}

// =====================================================
// Phase 6 — Sales History / Cancel / Refund
// =====================================================

let historyFilter = { status: 'ALL', paymentMethod: 'ALL', receiptNo: '' };

function saleStatusLabel(status) {
  const map = {
    COMPLETED: 'สำเร็จ',
    CANCELLED: 'ยกเลิก',
    REFUNDED: 'คืนเงิน'
  };
  return map[status] || status || '-';
}

function saleStatusClass(status) {
  if (status === 'COMPLETED') return 'badge-success';
  if (status === 'CANCELLED') return 'badge-danger';
  if (status === 'REFUNDED') return 'badge-muted';
  return 'badge-muted';
}

async function renderSalesHistory() {
  showLoading('โหลดประวัติการขาย...');
  let sales = [];
  try {
    sales = await listSales(getCurrentShopId(), {
      status: historyFilter.status,
      paymentMethod: historyFilter.paymentMethod,
      receiptNo: historyFilter.receiptNo || undefined,
      limitCount: 80
    });
  } catch (err) {
    hideLoading();
    pageContent.innerHTML = `<div class="card"><p class="text-danger">${escapeHtml(err.message)}</p></div>`;
    return;
  }
  hideLoading();

  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.15rem;">ประวัติการขาย</h2>
    </div>
    <div class="card mb-2" style="padding:10px;">
      <input type="search" id="hist-receipt" class="form-control" placeholder="ค้นหาเลขใบเสร็จ"
        value="${escapeHtml(historyFilter.receiptNo)}" style="margin-bottom:8px;">
      <div style="display:flex;gap:8px;">
        <select id="hist-status" class="form-control" style="flex:1;">
          <option value="ALL" ${historyFilter.status === 'ALL' ? 'selected' : ''}>ทุกสถานะ</option>
          <option value="COMPLETED" ${historyFilter.status === 'COMPLETED' ? 'selected' : ''}>สำเร็จ</option>
          <option value="CANCELLED" ${historyFilter.status === 'CANCELLED' ? 'selected' : ''}>ยกเลิก</option>
          <option value="REFUNDED" ${historyFilter.status === 'REFUNDED' ? 'selected' : ''}>คืนเงิน</option>
        </select>
        <select id="hist-pay" class="form-control" style="flex:1;">
          <option value="ALL" ${historyFilter.paymentMethod === 'ALL' ? 'selected' : ''}>ทุกวิธี</option>
          <option value="CASH" ${historyFilter.paymentMethod === 'CASH' ? 'selected' : ''}>เงินสด</option>
          <option value="PROMPTPAY" ${historyFilter.paymentMethod === 'PROMPTPAY' ? 'selected' : ''}>PromptPay</option>
        </select>
      </div>
    </div>
    <div id="hist-list">
      ${sales.length === 0 ? `
        <div class="card text-center text-muted">
          <p>ยังไม่มีรายการขาย</p>
        </div>
      ` : sales.map(s => `
        <div class="card sale-card" data-id="${escapeHtml(s.id)}" style="margin-bottom:8px;cursor:pointer;padding:12px;">
          <div class="flex-between" style="margin-bottom:4px;">
            <strong style="font-size:0.95rem;">${escapeHtml(s.receiptNo || s.id)}</strong>
            <span class="badge ${saleStatusClass(s.status)}">${saleStatusLabel(s.status)}</span>
          </div>
          <div class="flex-between" style="font-size:0.85rem;">
            <span class="text-muted">${formatDateTime(s.createdAt)}</span>
            <strong>฿${formatMoney(s.total)}</strong>
          </div>
          <div class="text-muted" style="font-size:0.78rem;margin-top:2px;">
            ${s.paymentMethod === 'PROMPTPAY' ? 'PromptPay' : 'เงินสด'}
            ${s.employeeName ? ' · ' + escapeHtml(s.employeeName) : ''}
            · ${(s.items || []).length} รายการ
          </div>
        </div>
      `).join('')}
    </div>
  `;

  const apply = debounce(() => {
    historyFilter.receiptNo = $('#hist-receipt')?.value.trim() || '';
    historyFilter.status = $('#hist-status')?.value || 'ALL';
    historyFilter.paymentMethod = $('#hist-pay')?.value || 'ALL';
    renderSalesHistory();
  }, 400);

  $('#hist-receipt')?.addEventListener('input', apply);
  $('#hist-status')?.addEventListener('change', apply);
  $('#hist-pay')?.addEventListener('change', apply);

  pageContent.querySelectorAll('.sale-card').forEach(card => {
    card.addEventListener('click', () => openSaleDetail(card.dataset.id));
  });
}

async function openSaleDetail(saleId) {
  showLoading();
  const [sale, shop] = await Promise.all([
    getSale(saleId),
    getShop(getCurrentShopId())
  ]);
  hideLoading();
  if (!sale) {
    showToast('ไม่พบรายการ', 'error');
    return renderSalesHistory();
  }

  const canManage = hasRole('ADMIN', 'MANAGER');
  const canCancel = canManage && sale.status === 'COMPLETED';
  const canRefund = canManage && (sale.status === 'COMPLETED' || sale.status === 'REFUNDED') &&
    (sale.items || []).some(i => (Number(i.quantity) || 0) > (Number(i.returnedQty) || 0));

  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.1rem;">รายละเอียดบิล</h2>
      <button class="btn btn-outline btn-sm" id="btn-hist-back">กลับ</button>
    </div>
    <div class="card">
      <div class="flex-between mb-1">
        <strong>${escapeHtml(sale.receiptNo)}</strong>
        <span class="badge ${saleStatusClass(sale.status)}">${saleStatusLabel(sale.status)}</span>
      </div>
      <p class="text-muted" style="font-size:0.85rem;">
        ${formatDateTime(sale.createdAt)}<br>
        พนักงาน: ${escapeHtml(sale.employeeName || '-')}<br>
        ชำระ: ${sale.paymentMethod === 'PROMPTPAY' ? 'PromptPay' : 'เงินสด'}
        ${sale.paymentMethod === 'CASH' ? ` · รับ ฿${formatMoney(sale.amountReceived)} ทอน ฿${formatMoney(sale.changeAmount)}` : ''}
      </p>
      ${sale.cancelReason ? `<p class="text-danger" style="font-size:0.85rem;">เหตุผลยกเลิก: ${escapeHtml(sale.cancelReason)}</p>` : ''}
      <hr>
      ${(sale.items || []).map(i => {
        const ret = Number(i.returnedQty) || 0;
        return `
          <div class="flex-between" style="font-size:0.9rem;margin-bottom:6px;">
            <span>
              ${escapeHtml(i.name)} × ${i.quantity}
              ${ret > 0 ? `<span class="text-muted">(คืนแล้ว ${ret})</span>` : ''}
            </span>
            <span>฿${formatMoney(i.lineTotal)}</span>
          </div>
        `;
      }).join('')}
      <hr>
      <div class="flex-between"><span class="text-muted">ยอดรวม</span><span>฿${formatMoney(sale.subtotal)}</span></div>
      <div class="flex-between"><span class="text-muted">ส่วนลด</span><span>฿${formatMoney(sale.discountAmount || 0)}</span></div>
      <div class="flex-between" style="font-weight:700;font-size:1.1rem;margin-top:4px;">
        <span>สุทธิ</span><span style="color:var(--primary);">฿${formatMoney(sale.total)}</span>
      </div>

      <button class="btn btn-primary btn-block mt-2" id="btn-reprint">🖨️ พิมพ์ใบเสร็จ</button>
      ${canCancel ? `<button class="btn btn-outline btn-block mt-1" id="btn-cancel-sale" style="border-color:var(--danger);color:var(--danger);">ยกเลิกบิล</button>` : ''}
      ${canRefund ? `<button class="btn btn-outline btn-block mt-1" id="btn-refund-sale">คืนสินค้า / คืนเงิน</button>` : ''}
    </div>
  `;

  $('#btn-hist-back')?.addEventListener('click', () => renderSalesHistory());
  $('#btn-reprint')?.addEventListener('click', () => reprintSale(sale, shop));
  $('#btn-cancel-sale')?.addEventListener('click', () => openCancelSaleForm(sale));
  $('#btn-refund-sale')?.addEventListener('click', () => openRefundForm(sale));
}

function openCancelSaleForm(sale) {
  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:8px;">ยกเลิกบิล</h2>
      <p class="text-muted" style="font-size:0.9rem;margin-bottom:12px;">
        ${escapeHtml(sale.receiptNo)} · ฿${formatMoney(sale.total)}<br>
        จะคืน Stock ทุกรายการและเปลี่ยนสถานะเป็นยกเลิก
      </p>
      <div class="form-group">
        <label>เหตุผล *</label>
        <textarea id="cancel-reason" class="form-control" rows="3" required placeholder="เช่น ลูกค้ายกเลิก / คิดเงินผิด"></textarea>
      </div>
      <button class="btn btn-block btn-lg" id="btn-confirm-cancel" style="background:var(--danger);color:#fff;height:52px;">
        ยืนยันยกเลิกบิล
      </button>
      <button class="btn btn-outline btn-block mt-1" id="btn-cancel-back">กลับ</button>
    </div>
  `;
  $('#btn-cancel-back')?.addEventListener('click', () => openSaleDetail(sale.id));
  $('#btn-confirm-cancel')?.addEventListener('click', async () => {
    const reason = $('#cancel-reason')?.value.trim();
    if (!reason) {
      showToast('กรุณาระบุเหตุผล', 'error');
      return;
    }
    if (!confirm('ยืนยันยกเลิกบิลนี้?')) return;
    const btn = $('#btn-confirm-cancel');
    btn.disabled = true;
    showLoading('กำลังยกเลิก...');
    try {
      await cancelSale({
        saleId: sale.id,
        reason,
        employeeId: getCurrentEmployee()?.id,
        userId: getCurrentUser()?.uid
      });
      hideLoading();
      showToast('ยกเลิกบิลสำเร็จ · คืน Stock แล้ว', 'success');
      openSaleDetail(sale.id);
    } catch (err) {
      hideLoading();
      btn.disabled = false;
      showToast(err.message || 'ยกเลิกไม่สำเร็จ', 'error');
    }
  });
}

function openRefundForm(sale) {
  const lines = (sale.items || []).map(i => {
    const sold = Number(i.quantity) || 0;
    const ret = Number(i.returnedQty) || 0;
    const can = sold - ret;
    return { ...i, canReturn: can };
  }).filter(i => i.canReturn > 0);

  if (!lines.length) {
    showToast('ไม่มีรายการที่คืนได้', 'error');
    return openSaleDetail(sale.id);
  }

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:8px;">คืนสินค้า</h2>
      <p class="text-muted" style="font-size:0.85rem;margin-bottom:12px;">
        ${escapeHtml(sale.receiptNo)} · ระบุจำนวนที่ต้องการคืน
      </p>
      <div id="refund-lines">
        ${lines.map(i => `
          <div class="card" style="margin-bottom:8px;padding:10px;" data-pid="${escapeHtml(i.productId)}">
            <strong style="font-size:0.9rem;">${escapeHtml(i.name)}</strong>
            <div class="text-muted" style="font-size:0.8rem;">ขาย ${i.quantity} · คืนได้ ${i.canReturn} · ฿${formatMoney(i.unitPrice)}/หน่วย</div>
            <div class="form-group" style="margin:8px 0 0;">
              <label style="font-size:0.85rem;">จำนวนคืน</label>
              <input type="number" class="form-control refund-qty" data-pid="${escapeHtml(i.productId)}"
                min="0" max="${i.canReturn}" value="0" step="1" inputmode="numeric">
            </div>
          </div>
        `).join('')}
      </div>
      <div class="form-group">
        <label>เหตุผล *</label>
        <textarea id="refund-reason" class="form-control" rows="2" placeholder="เช่น ของเสีย / ลูกค้าเปลี่ยนใจ"></textarea>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="btn-confirm-refund">ยืนยันคืนสินค้า</button>
      <button class="btn btn-outline btn-block mt-1" id="btn-refund-back">กลับ</button>
    </div>
  `;

  $('#btn-refund-back')?.addEventListener('click', () => openSaleDetail(sale.id));
  $('#btn-confirm-refund')?.addEventListener('click', async () => {
    const reason = $('#refund-reason')?.value.trim();
    if (!reason) {
      showToast('กรุณาระบุเหตุผล', 'error');
      return;
    }
    const items = [];
    pageContent.querySelectorAll('.refund-qty').forEach(input => {
      const qty = parseInt(input.value, 10) || 0;
      if (qty > 0) {
        items.push({ productId: input.dataset.pid, quantity: qty });
      }
    });
    if (!items.length) {
      showToast('ระบุจำนวนคืนอย่างน้อย 1 รายการ', 'error');
      return;
    }
    if (!confirm('ยืนยันคืนสินค้าตามจำนวนที่ระบุ?')) return;

    const btn = $('#btn-confirm-refund');
    btn.disabled = true;
    showLoading('กำลังบันทึกการคืน...');
    try {
      const result = await refundSale({
        saleId: sale.id,
        items,
        reason,
        employeeId: getCurrentEmployee()?.id,
        userId: getCurrentUser()?.uid
      });
      hideLoading();
      showToast(`คืนสำเร็จ · ฿${formatMoney(result.totalRefund)}`, 'success');
      openSaleDetail(sale.id);
    } catch (err) {
      hideLoading();
      btn.disabled = false;
      showToast(err.message || 'คืนสินค้าไม่สำเร็จ', 'error');
    }
  });
}
