/**
 * POSMATE — POS Core (Phase 4)
 * Cart · Scanner · Search · Discount · Stock check
 */

import {
  getProductByBarcode,
  listProducts,
  getProduct
} from './db.js';
import {
  showToast,
  showLoading,
  hideLoading,
  escapeHtml,
  formatMoney,
  generateId,
  debounce
} from './utils.js';
import { getCurrentShopId, getCurrentEmployee } from './auth.js';
import {
  isOnline,
  getCachedProductByBarcode,
  searchCachedProducts
} from './offline.js';

// ---------- Cart State ----------
/** @type {Array<{productId, barcode, name, unitPrice, costPrice, quantity, stock, unit, lineTotal}>} */
let cart = [];
/** @type {{ type: 'NONE'|'AMOUNT'|'PERCENT', value: number }} */
let discount = { type: 'NONE', value: 0 };
let scannerInstance = null;
let scannerBusy = false;

export function getCart() {
  return cart;
}

export function getDiscount() {
  return { ...discount };
}

export function clearCart() {
  cart = [];
  discount = { type: 'NONE', value: 0 };
}

export function calcTotals() {
  const subtotal = cart.reduce((s, i) => s + i.lineTotal, 0);
  let discountAmount = 0;
  if (discount.type === 'AMOUNT') {
    discountAmount = Math.min(Number(discount.value) || 0, subtotal);
  } else if (discount.type === 'PERCENT') {
    const pct = Math.min(Math.max(Number(discount.value) || 0, 0), 100);
    discountAmount = Math.round(subtotal * pct / 100 * 100) / 100;
  }
  const total = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);
  return { subtotal, discountAmount, total, itemCount };
}

export function addToCart(product, qty = 1) {
  if (!product || !product.id) throw new Error('ไม่พบสินค้า');
  if (product.status === 'INACTIVE') throw new Error('สินค้านี้ถูกปิดการขาย');
  const stock = Number(product.stock) || 0;
  if (stock <= 0) throw new Error('สินค้าหมดสต็อก');
  const existing = cart.find(i => i.productId === product.id);
  const newQty = (existing ? existing.quantity : 0) + qty;
  if (newQty > stock) throw new Error(`สต็อกไม่พอ (เหลือ ${stock} ${product.unit || 'ชิ้น'})`);
  const unitPrice = Number(product.sellPrice) || 0;
  const costPrice = Number(product.costPrice) || 0;
  const lineTotal = Math.round(unitPrice * newQty * 100) / 100;
  if (existing) {
    existing.quantity = newQty;
    existing.lineTotal = lineTotal;
    existing.stock = stock;
  } else {
    cart.push({
      productId: product.id,
      barcode: product.barcode || null,
      name: product.name,
      unitPrice,
      costPrice,
      quantity: newQty,
      stock,
      unit: product.unit || 'ชิ้น',
      lineTotal
    });
  }
  return getCart();
}

export function setCartQty(productId, qty) {
  const item = cart.find(i => i.productId === productId);
  if (!item) return;
  qty = Math.floor(Number(qty) || 0);
  if (qty <= 0) { cart = cart.filter(i => i.productId !== productId); return; }
  if (qty > item.stock) throw new Error(`สต็อกไม่พอ (เหลือ ${item.stock})`);
  item.quantity = qty;
  item.lineTotal = Math.round(item.unitPrice * qty * 100) / 100;
}

export function removeFromCart(productId) {
  cart = cart.filter(i => i.productId !== productId);
}

export function setDiscount(type, value) {
  discount = { type: type || 'NONE', value: Number(value) || 0 };
}

export async function searchProductsForPos(keyword) {
  const shopId = getCurrentShopId();
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  if (!isOnline()) return searchCachedProducts(shopId, kw);
  try {
    const list = await listProducts(shopId, { search: kw, status: 'ACTIVE' });
    return (list || []).slice(0, 30);
  } catch (e) {
    console.warn(e);
    return searchCachedProducts(shopId, kw);
  }
}

export function normalizeBarcode(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/\s+/g, '');
}

export function barcodeVariants(raw) {
  const code = normalizeBarcode(raw);
  if (!code) return [];
  const set = new Set([code]);
  if (/^\d+$/.test(code)) {
    if (code.length === 12) set.add('0' + code);
    if (code.length === 13 && code.startsWith('0')) set.add(code.slice(1));
    const stripped = code.replace(/^0+/, '');
    if (stripped && stripped !== code) set.add(stripped);
  }
  return [...set];
}

/**
 * สแกน barcode → หาสินค้า → เพิ่มตะกร้า
 * ห้ามใช้ scannerBusy บล็อก callback (บั๊กเดิม: กรอบเขียวแต่ไม่เข้าตะกร้า)
 */
let addInProgress = false;
let lastScanCode = '';
let lastScanAt = 0;

export async function scanAndAdd(barcode) {
  const code = normalizeBarcode(barcode);
  if (!code) return null;

  const now = Date.now();
  if (code === lastScanCode && (now - lastScanAt) < 1500) {
    return { found: true, duplicate: true };
  }

  if (addInProgress) return null;
  addInProgress = true;
  lastScanCode = code;
  lastScanAt = now;

  try {
    const shopId = getCurrentShopId();
    const variants = barcodeVariants(code);
    let product = null;

    for (const v of variants) {
      if (isOnline()) {
        try {
          product = await getProductByBarcode(shopId, v);
        } catch (e) {
          product = await getCachedProductByBarcode(shopId, v);
        }
      } else {
        product = await getCachedProductByBarcode(shopId, v);
      }
      if (product) break;
    }

    if (!product) {
      for (const v of variants) {
        product = await getCachedProductByBarcode(shopId, v);
        if (product) break;
      }
    }

    if (!product) {
      showToast('ไม่พบสินค้า: ' + code, 'error');
      try { navigator.vibrate?.(80); } catch (_) {}
      return { found: false, barcode: code };
    }

    addToCart(product, 1);
    showToast('+ ' + product.name, 'success');
    try { navigator.vibrate?.([40, 30, 40]); } catch (_) {}
    return { found: true, product };
  } catch (err) {
    showToast(err.message || 'เพิ่มสินค้าไม่สำเร็จ', 'error');
    try { navigator.vibrate?.(120); } catch (_) {}
    return { found: false, error: err.message };
  } finally {
    addInProgress = false;
  }
}

export async function findProductByBarcode(barcode) {
  const code = normalizeBarcode(barcode);
  if (!code) return null;
  const shopId = getCurrentShopId();
  for (const v of barcodeVariants(code)) {
    try {
      if (isOnline()) {
        const p = await getProductByBarcode(shopId, v);
        if (p) return p;
      }
    } catch (_) {}
    const cached = await getCachedProductByBarcode(shopId, v);
    if (cached) return cached;
  }
  return null;
}

function loadHtml5Qrcode() {
  return new Promise((resolve, reject) => {
    if (window.Html5Qrcode) return resolve(window.Html5Qrcode);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    script.onload = () => resolve(window.Html5Qrcode);
    script.onerror = () => reject(new Error('โหลดสแกนเนอร์ไม่สำเร็จ'));
    document.head.appendChild(script);
  });
}

/**
 * เริ่มสแกนด้วยกล้อง — รองรับบาร์โค้ด 1D + QR
 */
export async function startScanner(elementId, onDetected, options = {}) {
  await stopScanner().catch(() => {});
  const Html5Qrcode = await loadHtml5Qrcode();
  const el = document.getElementById(elementId);
  if (!el) throw new Error('ไม่พบ element สแกนเนอร์');

  const qrbox = options.qrbox || { width: 280, height: 180 };

  const formats = [];
  try {
    const F = window.Html5QrcodeSupportedFormats;
    if (F) {
      [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.QR_CODE, F.ITF]
        .filter(Boolean)
        .forEach(f => formats.push(f));
    }
  } catch (_) {}

  const startConfig = {
    fps: 12,
    qrbox,
    aspectRatio: 1.333,
    disableFlip: false
  };

  let handling = false;

  try {
    if (formats.length) {
      scannerInstance = new Html5Qrcode(elementId, { formatsToSupport: formats, verbose: false });
    } else {
      scannerInstance = new Html5Qrcode(elementId);
    }
  } catch (_) {
    scannerInstance = new Html5Qrcode(elementId);
  }

  await scannerInstance.start(
    { facingMode: 'environment' },
    startConfig,
    async (decodedText) => {
      if (handling) return;
      handling = true;
      try {
        if (onDetected) await onDetected(normalizeBarcode(decodedText));
      } catch (e) {
        console.error('scan handler', e);
        showToast(e.message || 'สแกนไม่สำเร็จ', 'error');
      } finally {
        setTimeout(() => { handling = false; }, 900);
      }
    },
    () => { /* ignore frame miss */ }
  );
  scannerBusy = true;
  return scannerInstance;
}

export async function stopScanner() {
  if (scannerInstance) {
    try {
      const state = scannerInstance.getState?.();
      if (state === 2 || state === 3 || state == null) {
        try { await scannerInstance.stop(); } catch (_) {}
      }
      try { await scannerInstance.clear(); } catch (_) {}
    } catch (e) {
      console.warn('stopScanner', e);
    }
    scannerInstance = null;
  }
  scannerBusy = false;
  addInProgress = false;
}

export function buildCheckoutPayload(extra = {}) {
  const emp = getCurrentEmployee();
  const totals = calcTotals();
  if (!cart.length) throw new Error('ไม่มีรายการสินค้า');
  return {
    transactionId: generateId('txn'),
    shopId: getCurrentShopId(),
    employeeId: emp?.id || null,
    employeeName: emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.code : null,
    items: cart.map(i => ({ ...i })),
    subtotal: totals.subtotal,
    discountType: discount.type,
    discountValue: discount.value,
    discountAmount: totals.discountAmount,
    total: totals.total,
    itemCount: totals.itemCount,
    shiftId: extra.shiftId || null,
    paymentMethod: extra.paymentMethod || extra.method || null,
    amountReceived: extra.receivedAmount != null ? extra.receivedAmount : (extra.amountReceived != null ? extra.amountReceived : null),
    changeAmount: extra.changeAmount != null ? extra.changeAmount : null
  };
}

export function requireEmployee() {
  const emp = getCurrentEmployee();
  if (!emp) throw new Error('กรุณาเลือกพนักงาน / ใส่ PIN ก่อนขาย');
  return emp;
}
