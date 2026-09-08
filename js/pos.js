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
  if (!isOnline()) return searchCachedProducts(kw);
  try {
    const list = await listProducts(shopId, { search: kw, status: 'ACTIVE' });
    return (list || []).slice(0, 30);
  } catch (e) {
    console.warn(e);
    return searchCachedProducts(kw);
  }
}

export async function findProductByBarcode(barcode) {
  const code = normalizeBarcode(barcode);
  if (!code) return null;
  const shopId = getCurrentShopId();
  if (!isOnline()) return getCachedProductByBarcode(code);
  try {
    return await getProductByBarcode(shopId, code);
  } catch (e) {
    console.warn(e);
    return getCachedProductByBarcode(code);
  }
}

export async function scanAndAdd(barcode) {
  const code = normalizeBarcode(barcode);
  if (!code) throw new Error('บาร์โค้ดว่าง');
  const product = await findProductByBarcode(code);
  if (!product) throw new Error('ไม่พบสินค้า: ' + code);
  addToCart(product, 1);
  return product;
}

export function normalizeBarcode(raw) {
  return String(raw || '').trim().replace(/\s+/g, '');
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

export async function startScanner(elementId, onDecode, options = {}) {
  if (scannerBusy) return;
  scannerBusy = true;
  try {
    await stopScanner().catch(() => {});
    const Html5Qrcode = await loadHtml5Qrcode();
    scannerInstance = new Html5Qrcode(elementId);
    const qrbox = options.qrbox || { width: 280, height: 160 };
    await scannerInstance.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox },
      async (decodedText) => {
        if (!scannerBusy) return;
        try { await onDecode(decodedText); }
        catch (e) {
          console.warn(e);
          showToast(e.message || 'สแกนไม่สำเร็จ', 'error');
        }
      },
      () => {}
    );
  } catch (e) {
    scannerBusy = false;
    throw e;
  }
}

export async function stopScanner() {
  scannerBusy = false;
  if (!scannerInstance) return;
  try {
    const state = scannerInstance.getState && scannerInstance.getState();
    if (state === 2 || state === 3) await scannerInstance.stop();
  } catch (e) { console.warn('stopScanner', e); }
  try { scannerInstance.clear(); } catch (e) {}
  scannerInstance = null;
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
