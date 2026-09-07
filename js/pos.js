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

/**
 * คำนวณยอดรวม
 */
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

/**
 * เพิ่มสินค้าเข้าตะกร้า (ตรวจ stock)
 */
export function addToCart(product, qty = 1) {
  if (!product || !product.id) throw new Error('ไม่พบสินค้า');
  if (product.status === 'INACTIVE') throw new Error('สินค้านี้ถูกปิดการขาย');

  const stock = Number(product.stock) || 0;
  if (stock <= 0) throw new Error('สินค้าหมดสต็อก');

  const existing = cart.find(i => i.productId === product.id);
  const newQty = (existing ? existing.quantity : 0) + qty;

  if (newQty > stock) {
    throw new Error(`สต็อกไม่พอ (เหลือ ${stock} ${product.unit || 'ชิ้น'})`);
  }

  if (existing) {
    existing.quantity = newQty;
    existing.lineTotal = Math.round(existing.unitPrice * newQty * 100) / 100;
  } else {
    const unitPrice = Number(product.sellPrice) || 0;
    cart.push({
      productId: product.id,
      barcode: product.barcode || null,
      name: product.name,
      unitPrice,
      costPrice: Number(product.costPrice) || 0,
      quantity: qty,
      stock,
      unit: product.unit || 'ชิ้น',
      lineTotal: Math.round(unitPrice * qty * 100) / 100
    });
  }
  return cart;
}

export function setCartQty(productId, quantity) {
  const item = cart.find(i => i.productId === productId);
  if (!item) return;
  const qty = Math.floor(Number(quantity));
  if (qty <= 0) {
    cart = cart.filter(i => i.productId !== productId);
    return;
  }
  if (qty > item.stock) {
    throw new Error(`สต็อกไม่พอ (เหลือ ${item.stock})`);
  }
  item.quantity = qty;
  item.lineTotal = Math.round(item.unitPrice * qty * 100) / 100;
}

export function removeFromCart(productId) {
  cart = cart.filter(i => i.productId !== productId);
}

export function setDiscount(type, value) {
  const v = Number(value) || 0;
  if (type === 'AMOUNT' || type === 'PERCENT') {
    discount = { type, value: v };
  } else {
    discount = { type: 'NONE', value: 0 };
  }
  // ป้องกันส่วนลดเกินยอด
  const { subtotal, discountAmount } = calcTotals();
  if (discountAmount > subtotal) {
    discount = { type: 'AMOUNT', value: subtotal };
  }
}

/**
 * ปรับรูปแบบ barcode ที่พบบ่อย (ตัดช่องว่าง, ลองตัดเลข 0 นำหน้า)
 */
export function normalizeBarcode(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/\s+/g, '');
}

export function barcodeVariants(raw) {
  const code = normalizeBarcode(raw);
  if (!code) return [];
  const set = new Set([code]);
  // EAN-13 บางครั้งอ่านเป็น UPC-A (ตัด 0 นำหน้า) หรือกลับกัน
  if (/^\d+$/.test(code)) {
    if (code.length === 12) set.add('0' + code);
    if (code.length === 13 && code.startsWith('0')) set.add(code.slice(1));
    // ตัด 0 นำหน้าทั้งหมด (กรณีสแกนได้ padding)
    const stripped = code.replace(/^0+/, '');
    if (stripped && stripped !== code) set.add(stripped);
  }
  return [...set];
}

/**
 * สแกน barcode → หาสินค้า → เพิ่มตะกร้า
 * หมายเหตุ: ห้ามใช้ scannerBusy บล็อกที่ต้นฟังก์ชันร่วมกับ startScanner
 * (บั๊กเดิม: กล้องขึ้นกรอบเขียวแต่ไม่เข้าตะกร้า)
 */
let addInProgress = false;
let lastScanCode = '';
let lastScanAt = 0;

export async function scanAndAdd(barcode) {
  const code = normalizeBarcode(barcode);
  if (!code) return null;

  // กันสแกนซ้ำรหัสเดิมภายใน 1.5 วินาที
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

    // fallback: ค้นในแคชด้วยทุก variants
    if (!product) {
      for (const v of variants) {
        product = await getCachedProductByBarcode(shopId, v);
        if (product) break;
      }
    }

    if (!product) {
      showToast(`ไม่พบสินค้า: ${code}`, 'error', 2500);
      try { navigator.vibrate?.(80); } catch (_) {}
      return { found: false, barcode: code };
    }

    addToCart(product, 1);
    showToast(`+ ${product.name}`, 'success', 1500);
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

/**
 * โหลด html5-qrcode จาก CDN (ครั้งเดียว)
 */
function loadScannerLib() {
  return new Promise((resolve, reject) => {
    if (window.Html5Qrcode) {
      resolve(window.Html5Qrcode);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    script.onload = () => resolve(window.Html5Qrcode);
    script.onerror = () => reject(new Error('โหลดสแกนเนอร์ไม่สำเร็จ'));
    document.head.appendChild(script);
  });
}

/**
 * เริ่มสแกนด้วยกล้อง
 * @param {string} elementId - id ของ div ที่จะใส่ scanner
 * @param {function} onDetected - callback(barcode)
 * @param {object} options - { qrbox }
 */
export async function startScanner(elementId, onDetected, options = {}) {
  await stopScanner();
  const Html5Qrcode = await loadScannerLib();
  const el = document.getElementById(elementId);
  if (!el) throw new Error('ไม่พบ element สแกนเนอร์');

  scannerInstance = new Html5Qrcode(elementId);
  const qrbox = options.qrbox || { width: 280, height: 180 };
  const startConfig = {
    fps: 12,
    qrbox,
    aspectRatio: 1.333,
    disableFlip: false
  };

  // ใช้ cooldown แยก ไม่บล็อก scanAndAdd ก่อนเริ่มทำงาน
  let handling = false;

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
      } finally {
        setTimeout(() => { handling = false; }, 900);
      }
    },
    () => { /* ignore frame miss */ }
  );
  return scannerInstance;
}

export async function stopScanner() {
  if (scannerInstance) {
    try {
      const state = scannerInstance.getState?.();
      // 2 = SCANNING, 3 = PAUSED (html5-qrcode states)
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

export async function searchProductsForPos(keyword, limitCount = 30) {
  const shopId = getCurrentShopId();
  if (!isOnline()) {
    const cached = await searchCachedProducts(shopId, keyword);
    return cached.slice(0, limitCount);
  }
  try {
    if (!keyword || keyword.trim().length < 1) {
      return listProducts(shopId, { status: 'ACTIVE', limitCount });
    }
    const byBarcode = await getProductByBarcode(shopId, keyword.trim());
    if (byBarcode && byBarcode.status !== 'INACTIVE') {
      return [byBarcode];
    }
    return listProducts(shopId, {
      status: 'ACTIVE',
      search: keyword.trim(),
      limitCount
    });
  } catch (e) {
    const cached = await searchCachedProducts(shopId, keyword);
    return cached.slice(0, limitCount);
  }
}

/**
 * เตรียมข้อมูลสำหรับ checkout (Phase 5 จะใช้)
 */
export function buildCheckoutPayload() {
  const emp = getCurrentEmployee();
  const totals = calcTotals();
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
    itemCount: totals.itemCount
  };
}

export function requireEmployee() {
  const emp = getCurrentEmployee();
  if (!emp) {
    throw new Error('กรุณาเลือกพนักงาน / ใส่ PIN ก่อนขาย');
  }
  return emp;
}
