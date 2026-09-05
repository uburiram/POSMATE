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
  const { subtotal, discountAmount } = calcTotals();
  if (discountAmount > subtotal) {
    discount = { type: 'AMOUNT', value: subtotal };
  }
}

export async function scanAndAdd(barcode) {
  if (!barcode || scannerBusy) return null;
  scannerBusy = true;
  try {
    const shopId = getCurrentShopId();
    const code = String(barcode).trim();
    let product = null;
    if (isOnline()) {
      try {
        product = await getProductByBarcode(shopId, code);
      } catch (e) {
        product = await getCachedProductByBarcode(shopId, code);
      }
    } else {
      product = await getCachedProductByBarcode(shopId, code);
    }
    if (!product) {
      showToast(isOnline() ? 'ไม่พบสินค้านี้' : 'ไม่พบในแคช (offline)', 'error');
      return { found: false, barcode };
    }
    addToCart(product, 1);
    showToast(`+ ${product.name}${isOnline() ? '' : ' (offline)'}`, 'success', 1500);
    return { found: true, product };
  } catch (err) {
    showToast(err.message || 'เพิ่มสินค้าไม่สำเร็จ', 'error');
    return { found: false, error: err.message };
  } finally {
    scannerBusy = false;
  }
}

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

export async function startScanner(elementId, onDetected) {
  await stopScanner();
  const Html5Qrcode = await loadScannerLib();
  const el = document.getElementById(elementId);
  if (!el) throw new Error('ไม่พบ element สแกนเนอร์');

  scannerInstance = new Html5Qrcode(elementId);
  const startConfig = {
    fps: 10,
    qrbox: { width: 260, height: 160 },
    aspectRatio: 1.333
  };

  await scannerInstance.start(
    { facingMode: 'environment' },
    startConfig,
    async (decodedText) => {
      if (scannerBusy) return;
      scannerBusy = true;
      try {
        if (onDetected) await onDetected(decodedText);
      } finally {
        setTimeout(() => { scannerBusy = false; }, 1200);
      }
    },
    () => { /* ignore scan miss */ }
  );
}

export async function stopScanner() {
  if (scannerInstance) {
    try {
      const state = scannerInstance.getState?.();
      if (state === 2 || !state) {
        await scannerInstance.stop();
      }
      await scannerInstance.clear();
    } catch (e) {
      // ignore
    }
    scannerInstance = null;
  }
  scannerBusy = false;
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
