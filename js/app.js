/**
 * POSMATE — Application shell (router + boot)
 * Page UI ถูกแยกไปที่ page-*.js แล้ว เพื่อ maintain ง่าย
 * Version: 1.0.5-modular
 */
import {
  initAuth, waitForAuth, loginWithEmail, logout, setCurrentFromAuth,
  getCurrentUser, getCurrentProfile, getCurrentEmployee, getCurrentRole,
  getCurrentShopId, hasRole, switchEmployeeByPin
} from './auth.js';
import { listProducts } from './db.js';
import { showToast, showLoading, hideLoading, firestoreErrorHtml } from './utils.js';
import { APP_VERSION } from './config.js';
import { stopScanner } from './pos.js';
import { completeSale } from './payment.js';
import {
  initOfflineListeners, onConnectivityChange, isOnline,
  refreshProductCache, syncPendingSales, getPendingCount, setSaleCompleter
} from './offline.js';
import {
  $, bindDom, setNavigate, setRenderPage, setUpdateHeader,
  setCurrentPage, setPosMode, currentPage, pageContent,
  loginScreen, mainApp, headerUser, pinModal
} from './app-state.js';

import { renderDashboard } from './page-dashboard.js';
import { renderEmployees } from './page-employees.js';
import { renderSettings } from './page-settings.js';
import { renderPos } from './page-pos.js';
import { renderProducts } from './page-products.js';
import { renderSalesHistory } from './page-history.js';

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', async () => {
  bindDom();
  setNavigate(navigate);
  setRenderPage(renderPage);
  setUpdateHeader(updateHeader);

  try {
    initAuth();
    initOfflineListeners();
    setSaleCompleter(completeSale);
    setupConnectivityBanner();
    const user = await waitForAuth();
    if (user) {
      await setCurrentFromAuth(user);
      showMainApp();
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

  $('#btn-logout')?.addEventListener('click', async () => {
    if (!confirm('ต้องการออกจากระบบ?')) return;
    await logout();
    showLogin();
    showToast('ออกจากระบบแล้ว', 'info');
  });

  document.querySelectorAll('.bottom-nav a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const page = a.dataset.page;
      if (!page) return;
      navigate(page);
    });
  });

  $('#btn-switch-emp')?.addEventListener('click', onSwitchEmployee);
  $('#btn-close-pin')?.addEventListener('click', () => pinModal?.classList.remove('active'));
}

// ---------- UI shell ----------
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
    setPosMode('cart');
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
  const allowed = gates[page] || ['ADMIN'];
  if (!hasRole(...allowed)) {
    showToast('ไม่มีสิทธิ์เข้าหน้านี้', 'error');
    page = 'dashboard';
  }

  setCurrentPage(page);

  // active nav
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });

  // hide nav items by role
  const isCashier = getCurrentRole() === 'CASHIER';
  document.querySelector('[data-page="products"]')?.classList.toggle('hidden', isCashier);
  document.querySelector('[data-page="employees"]')?.classList.toggle('hidden', isCashier);
  if (isCashier) {
    document.querySelector('[data-page="settings"]')?.classList.toggle('hidden', true);
  } else {
    document.querySelector('[data-page="settings"]')?.classList.toggle('hidden', false);
  }

  await renderPage(page);
}

async function renderPage(page) {
  if (!pageContent) return;
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
    console.error('renderPage', page, err);
    pageContent.innerHTML = firestoreErrorHtml(err, { title: 'เกิดข้อผิดพลาด', retryId: 'btn-retry-page' });
    $('#btn-retry-page')?.addEventListener('click', () => renderPage(currentPage));
  }
}

async function onSwitchEmployee() {
  const code = $('#emp-code')?.value.trim();
  const pin = $('#emp-pin')?.value.trim();
  if (!code || !pin) {
    showToast('กรุณากรอกรหัสและ PIN', 'error');
    return;
  }
  const btn = $('#btn-switch-emp');
  if (btn) btn.disabled = true;
  try {
    const emp = await switchEmployeeByPin(code, pin);
    pinModal?.classList.remove('active');
    updateHeader();
    showToast(`เข้างาน: ${emp.firstName || emp.code}`, 'success');
    if (currentPage === 'pos') await renderPos();
  } catch (err) {
    showToast(err.message || 'สลับพนักงานไม่สำเร็จ', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
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

console.info(`[POSMATE] shell ready ${APP_VERSION}-modular`);
