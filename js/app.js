/**
 * POSMATE — emergency minimal app (login + dashboard shell)
 * Restores login while full monolith is re-published
 */
import { initAuth, waitForAuth, loginWithEmail, logout, setCurrentFromAuth,
         getCurrentProfile, getCurrentEmployee, getCurrentRole, getCurrentShopId,
         switchEmployeeByPin } from './auth.js';
import { listProducts, getDashboardStats, getOpenShift, getShop } from './db.js';
import { showToast, showLoading, hideLoading, escapeHtml, formatMoney, formatDateTime } from './utils.js';
import { APP_VERSION } from './config.js';
import { initOfflineListeners, setSaleCompleter, refreshProductCache, syncPendingSales } from './offline.js';
import { completeSale } from './payment.js';

const $ = (s) => document.querySelector(s);
let loginScreen, mainApp, pageContent, headerUser, pinModal;

document.addEventListener('DOMContentLoaded', async () => {
  loginScreen = $('#login-screen');
  mainApp = $('#main-app');
  pageContent = $('#page-content');
  headerUser = $('#header-user');
  pinModal = $('#pin-modal');

  try {
    initAuth();
    initOfflineListeners();
    setSaleCompleter(completeSale);
    const user = await waitForAuth();
    if (user) {
      await setCurrentFromAuth(user);
      showMain();
    } else {
      showLogin();
    }
  } catch (e) {
    console.error(e);
    showLogin();
    showToast('เริ่มระบบไม่สำเร็จ: ' + (e.message || e), 'error');
  }
  bind();
});

function bind() {
  $('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#email').value.trim();
    const password = $('#password').value;
    const btn = $('#btn-login');
    btn.disabled = true;
    try {
      await loginWithEmail(email, password);
      showToast('เข้าสู่ระบบสำเร็จ', 'success');
      showMain();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'เข้าสู่ระบบไม่สำเร็จ', 'error');
    } finally {
      btn.disabled = false;
    }
  });
  $('#btn-logout')?.addEventListener('click', async () => {
    if (!confirm('ออกจากระบบ?')) return;
    await logout();
    showLogin();
  });
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const page = a.dataset.page;
      if (page) renderPage(page);
    });
  });
  $('#btn-switch-emp')?.addEventListener('click', async () => {
    try {
      const emp = await switchEmployeeByPin($('#emp-code').value.trim(), $('#emp-pin').value.trim());
      pinModal?.classList.remove('active');
      updateHeader();
      showToast('เข้างาน: ' + (emp.firstName || emp.code), 'success');
    } catch (err) {
      showToast(err.message || 'สลับพนักงานไม่สำเร็จ', 'error');
    }
  });
  $('#btn-close-pin')?.addEventListener('click', () => pinModal?.classList.remove('active'));
}

function showLogin() {
  loginScreen?.classList.remove('hidden');
  mainApp?.classList.add('hidden');
}
function showMain() {
  loginScreen?.classList.add('hidden');
  mainApp?.classList.remove('hidden');
  updateHeader();
  renderPage('dashboard');
}
function updateHeader() {
  const p = getCurrentProfile();
  const emp = getCurrentEmployee();
  let t = p?.displayName || p?.email || '-';
  if (emp) t += ' · ' + (emp.firstName || emp.code);
  t += ' (' + getCurrentRole() + ')';
  if (headerUser) headerUser.textContent = t;
}

async function renderPage(page) {
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });
  if (!pageContent) return;
  pageContent.innerHTML = '<div class="text-center text-muted" style="padding:40px 0;">กำลังโหลด...</div>';
  try {
    if (page === 'dashboard') await renderDashboard();
    else if (page === 'pos') pageContent.innerHTML = '<div class="card"><p>หน้าขาย — กำลังกู้คืน full app</p><p class="text-muted">Login ใช้ได้แล้ว</p></div>';
    else if (page === 'history') pageContent.innerHTML = '<div class="card"><p>ประวัติ — กำลังกู้คืน</p></div>';
    else if (page === 'products') pageContent.innerHTML = '<div class="card"><p>สินค้า — กำลังกู้คืน</p></div>';
    else if (page === 'employees') pageContent.innerHTML = '<div class="card"><p>พนักงาน — กำลังกู้คืน</p></div>';
    else if (page === 'settings') pageContent.innerHTML = '<div class="card"><p>ตั้งค่า — กำลังกู้คืน</p></div>';
    else pageContent.innerHTML = '<div class="card"><p>หน้านี้ยังไม่พร้อม</p></div>';
  } catch (err) {
    console.error(err);
    pageContent.innerHTML = '<div class="card"><p style="color:#c00;">' + escapeHtml(err.message || String(err)) + '</p></div>';
  }
}

async function renderDashboard() {
  showLoading('โหลดแดชบอร์ด...');
  const shopId = getCurrentShopId();
  let shop = null, stats = null, shift = null;
  try {
    [shop, stats, shift] = await Promise.all([
      getShop(shopId).catch(() => null),
      getDashboardStats(shopId).catch(() => null),
      getOpenShift(shopId).catch(() => null)
    ]);
  } catch (e) { console.warn(e); }
  hideLoading();
  pageContent.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 8px;">ยินดีต้อนรับ</h2>
      <p class="text-muted">${escapeHtml(shop?.name || 'POSMATE')} · v${APP_VERSION}</p>
      <p>สถานะ: <strong>Login สำเร็จ</strong></p>
      ${shift ? `<p>กะเปิดอยู่ · เงินทอนเริ่มต้น ฿${formatMoney(shift.openingCash || 0)}</p>` : '<p class="text-muted">ยังไม่ได้เปิดกะ</p>'}
      ${stats ? `<p>ยอดวันนี้ (ถ้ามี): ฿${formatMoney(stats.todaySales || stats.totalSales || 0)}</p>` : ''}
      <button class="btn btn-primary btn-block mt-2" id="btn-dash-pin">เลือกพนักงาน / PIN</button>
    </div>
    <div class="card mt-2">
      <p style="font-size:0.85rem;color:#666;">หน้าอื่นกำลังกู้คืน full app — login / auth ใช้ได้แล้ว</p>
    </div>`;
  $('#btn-dash-pin')?.addEventListener('click', () => pinModal?.classList.add('active'));
}
console.info('[POSMATE] emergency login build', APP_VERSION);
