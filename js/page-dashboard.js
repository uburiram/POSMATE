/**
 * POSMATE — Dashboard + Reports + Shift open/close
 */
import {
  getShop, listEmployees, getDashboardStats, getOpenShift, openShift, closeShift,
  listSales, listProducts, getLowStockProducts, listShifts
} from './db.js';
import {
  getCurrentUser, getCurrentProfile, getCurrentEmployee, getCurrentRole,
  getCurrentShopId, hasRole
} from './auth.js';
import {
  showToast, showLoading, hideLoading, escapeHtml, formatDateTime, formatMoney,
  firestoreErrorHtml, isFirestoreIndexError
} from './utils.js';
import * as ui from './app-state.js';
import { $, pageContent, navigate, pinModal, updateHeader } from './app-state.js';

export async function renderDashboard() {
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

  // คำแนะนำตั้งค่าร้านครั้งแรก
  let setupHints = [];
  try {
    if (!shop?.name || shop.name === 'ร้านค้า' || shop.name === 'ร้านของฉัน') {
      setupHints.push({ page: 'settings', text: 'ตั้งชื่อร้านและที่อยู่' });
    }
    if (!shop?.promptPayId) {
      setupHints.push({ page: 'settings', text: 'ตั้งค่า PromptPay (ถ้ารับโอน)' });
    }
    const emps = await listEmployees(shopId).catch(() => []);
    if (!emps.length) {
      setupHints.push({ page: 'employees', text: 'เพิ่มพนักงานและตั้ง PIN' });
    }
    const prods = await listProducts(shopId, { limitCount: 5 }).catch(() => []);
    if (!prods.length) {
      setupHints.push({ page: 'products', text: 'เพิ่มสินค้าอย่างน้อย 1 รายการ' });
    }
  } catch (e) {
    console.warn('setupHints', e);
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

    ${setupHints.length ? `
      <div class="card mb-2" style="border-left:4px solid var(--primary);">
        <h3 style="font-size:0.95rem;margin-bottom:8px;">เริ่มต้นใช้งาน</h3>
        <ol style="margin:0;padding-left:20px;font-size:0.9rem;">
          ${setupHints.map(h => `<li style="margin-bottom:6px;">${escapeHtml(h.text)}</li>`).join('')}
        </ol>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
          ${[...new Map(setupHints.map(h => [h.page, h])).values()].map(h => {
            const labels = { settings: 'ตั้งค่า', employees: 'พนักงาน', products: 'สินค้า' };
            return `<button class="btn btn-outline btn-sm" data-goto="${h.page}">${labels[h.page] || h.page}</button>`;
          }).join('')}
        </div>
      </div>
    ` : ''}

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

export async function renderReports() {
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

export function openShiftForm() {
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

export async function closeShiftForm(shift) {
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


