/**
 * POSMATE — Application shell v1.0.8
 * Login ไม่พึ่ง page modules (dynamic import ตอนเข้าแต่ละหน้า)
 */
import {
  initAuth, waitForAuth, loginWithEmail, logout, setCurrentFromAuth,
  getCurrentProfile, getCurrentEmployee, getCurrentRole,
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
      refreshProductCache(getCurrentShopId(), listProducts).catch(function () {});
      syncPendingSales(completeSale).then(function (r) {
        if (r.synced > 0) showToast('Sync การขาย offline ' + r.synced + ' รายการ', 'success');
      }).catch(function () {});
    } else {
      showLogin();
    }
  } catch (err) {
    console.error('Boot error:', err);
    showLogin();
    showToast('เกิดข้อผิดพลาดในการเริ่มระบบ', 'error');
  }

  bindEvents();
  console.info('[POSMATE] shell ready', APP_VERSION, 'lazy-pages');
});

function bindEvents() {
  var form = document.getElementById('login-form');
  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var emailEl = document.getElementById('email');
      var passEl = document.getElementById('password');
      var btn = document.getElementById('btn-login');
      var email = emailEl ? emailEl.value.trim() : '';
      var password = passEl ? passEl.value : '';
      if (btn) btn.disabled = true;
      try {
        await loginWithEmail(email, password);
        showMainApp();
        showToast('เข้าสู่ระบบสำเร็จ', 'success');
        refreshProductCache(getCurrentShopId(), listProducts).catch(function () {});
        syncPendingSales(completeSale).then(function (r) {
          if (r.synced > 0) showToast('Sync การขาย offline ' + r.synced + ' รายการ', 'success');
        }).catch(function () {});
      } catch (err) {
        console.error(err);
        showToast((err && err.message) || 'เข้าสู่ระบบไม่สำเร็จ', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  var logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function () {
      if (!confirm('ต้องการออกจากระบบ?')) return;
      await logout();
      showLogin();
      showToast('ออกจากระบบแล้ว', 'info');
    });
  }

  document.querySelectorAll('.bottom-nav a').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var page = a.getAttribute('data-page');
      if (!page) return;
      navigate(page);
    });
  });

  var switchBtn = document.getElementById('btn-switch-emp');
  if (switchBtn) switchBtn.addEventListener('click', onSwitchEmployee);
  var closePin = document.getElementById('btn-close-pin');
  if (closePin) {
    closePin.addEventListener('click', function () {
      if (pinModal) pinModal.classList.remove('active');
    });
  }
}

function showLogin() {
  if (loginScreen) loginScreen.classList.remove('hidden');
  if (mainApp) mainApp.classList.add('hidden');
  if (pinModal) pinModal.classList.remove('active');
}

function showMainApp() {
  if (loginScreen) loginScreen.classList.add('hidden');
  if (mainApp) mainApp.classList.remove('hidden');
  updateHeader();
  navigate('dashboard');
}

function updateHeader() {
  var profile = getCurrentProfile();
  var emp = getCurrentEmployee();
  var role = getCurrentRole();
  var text = (profile && (profile.displayName || profile.email)) || '-';
  if (emp) text += ' · ' + (emp.firstName || emp.code || '');
  text += ' (' + role + ')';
  if (headerUser) headerUser.textContent = text;
}

async function navigate(page) {
  if (currentPage === 'pos' && page !== 'pos') {
    await stopScanner().catch(function () {});
    setPosMode('cart');
  }

  var gates = {
    dashboard: ['ADMIN', 'MANAGER', 'CASHIER'],
    pos: ['ADMIN', 'MANAGER', 'CASHIER'],
    history: ['ADMIN', 'MANAGER', 'CASHIER'],
    products: ['ADMIN', 'MANAGER'],
    employees: ['ADMIN'],
    settings: ['ADMIN', 'MANAGER']
  };
  var allowed = gates[page] || ['ADMIN'];
  if (!hasRole.apply(null, allowed)) {
    showToast('ไม่มีสิทธิ์เข้าหน้านี้', 'error');
    page = 'dashboard';
  }

  setCurrentPage(page);

  document.querySelectorAll('.bottom-nav a').forEach(function (a) {
    a.classList.toggle('active', a.getAttribute('data-page') === page);
  });

  var isCashier = getCurrentRole() === 'CASHIER';
  var prodNav = document.querySelector('[data-page="products"]');
  var empNav = document.querySelector('[data-page="employees"]');
  var setNav = document.querySelector('[data-page="settings"]');
  if (prodNav) prodNav.classList.toggle('hidden', isCashier);
  if (empNav) empNav.classList.toggle('hidden', isCashier);
  if (setNav) setNav.classList.toggle('hidden', isCashier);

  await renderPage(page);
}

async function renderPage(page) {
  if (!pageContent) return;
  pageContent.innerHTML = '<div class="text-center text-muted" style="padding:40px 0;">กำลังโหลด...</div>';
  try {
    if (page === 'dashboard') {
      var dash = await import('./page-dashboard.js');
      await dash.renderDashboard();
    } else if (page === 'employees') {
      var emp = await import('./page-employees.js');
      await emp.renderEmployees();
    } else if (page === 'settings') {
      var set = await import('./page-settings.js');
      await set.renderSettings();
    } else if (page === 'pos') {
      var pos = await import('./page-pos.js');
      await pos.renderPos();
    } else if (page === 'history') {
      var hist = await import('./page-history.js');
      await hist.renderSalesHistory();
    } else if (page === 'products') {
      var prod = await import('./page-products.js');
      await prod.renderProducts();
    } else {
      pageContent.innerHTML = '<p class="text-center">หน้านี้ยังไม่พร้อม</p>';
    }
  } catch (err) {
    console.error('renderPage', page, err);
    pageContent.innerHTML = firestoreErrorHtml(err, { title: 'เกิดข้อผิดพลาด', retryId: 'btn-retry-page' });
    var retry = document.getElementById('btn-retry-page');
    if (retry) {
      retry.addEventListener('click', function () {
        renderPage(currentPage);
      });
    }
  }
}

async function onSwitchEmployee() {
  var codeEl = document.getElementById('emp-code');
  var pinEl = document.getElementById('emp-pin');
  var code = codeEl ? codeEl.value.trim() : '';
  var pin = pinEl ? pinEl.value.trim() : '';
  if (!code || !pin) {
    showToast('กรุณากรอกรหัสและ PIN', 'error');
    return;
  }
  var btn = document.getElementById('btn-switch-emp');
  if (btn) btn.disabled = true;
  try {
    var emp = await switchEmployeeByPin(code, pin);
    if (pinModal) pinModal.classList.remove('active');
    updateHeader();
    showToast('เข้างาน: ' + (emp.firstName || emp.code), 'success');
    if (currentPage === 'pos') await renderPage('pos');
  } catch (err) {
    showToast((err && err.message) || 'สลับพนักงานไม่สำเร็จ', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function setupConnectivityBanner() {
  var banner = document.getElementById('connectivity-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'connectivity-banner';
    banner.className = 'connectivity-banner';
    document.body.appendChild(banner);
  }
  var update = async function (online) {
    var pending = await getPendingCount().catch(function () { return 0; });
    if (!online) {
      banner.textContent = pending > 0
        ? '⚡ Offline · คิวรอ sync ' + pending + ' รายการ'
        : '⚡ Offline — ขายได้จากแคชสินค้า';
      banner.classList.add('show', 'offline');
      banner.classList.remove('online');
    } else if (pending > 0) {
      banner.textContent = '🔄 Online · มี ' + pending + ' รายการรอ sync — แตะเพื่อ sync';
      banner.classList.add('show', 'online');
      banner.classList.remove('offline');
      banner.onclick = async function () {
        showLoading('กำลัง sync...');
        var r = await syncPendingSales(completeSale);
        hideLoading();
        if (r.synced) showToast('Sync สำเร็จ ' + r.synced + ' รายการ', 'success');
        if (r.failed) showToast('Sync ไม่สำเร็จ ' + r.failed + ' รายการ', 'error');
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
