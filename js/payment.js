/**
 * POSMATE — Payment + Sale Transaction (Phase 5)
 * Cash · PromptPay QR · Receipt · Stock cut (atomic)
 */

import {
  getDb,
  getShop,
  nextReceiptNumber,
  writeAuditLog,
  serverTimestamp,
  runTransaction,
  doc,
  query,
  where,
  limit,
  collection
} from './db.js';
import { getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { generateId, formatMoney, formatDateTime, escapeHtml, showToast } from './utils.js';
import { getCurrentUser, getCurrentEmployee, getCurrentShopId } from './auth.js';
import { clearCart } from './pos.js';

function crc16Ccitt(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
      else crc <<= 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id, value) {
  const v = String(value);
  const len = String(v.length).padStart(2, '0');
  return id + len + v;
}

export function buildPromptPayPayload(promptPayId, amount) {
  if (!promptPayId) throw new Error('ยังไม่ได้ตั้งค่า PromptPay ในร้าน');
  let target = String(promptPayId).replace(/[^0-9]/g, '');
  let merchantInfo;
  if (target.length >= 13 && target.length <= 15 && !target.startsWith('0')) {
    merchantInfo = tlv('00', 'A000000677010111') + tlv('02', target);
  } else {
    if (target.startsWith('0')) target = target.slice(1);
    if (!target.startsWith('66')) target = '66' + target;
    merchantInfo = tlv('00', 'A000000677010111') + tlv('01', target);
  }
  let payload = '';
  payload += tlv('00', '01');
  payload += tlv('01', amount != null && amount > 0 ? '12' : '11');
  payload += tlv('29', merchantInfo);
  payload += tlv('53', '764');
  if (amount != null && amount > 0) payload += tlv('54', Number(amount).toFixed(2));
  payload += tlv('58', 'TH');
  payload += '6304';
  payload += crc16Ccitt(payload);
  return payload;
}

function loadQrLib() {
  return new Promise((resolve, reject) => {
    if (window.QRCode) { resolve(window.QRCode); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    script.onload = () => resolve(window.QRCode);
    script.onerror = () => reject(new Error('โหลด QR library ไม่สำเร็จ'));
    document.head.appendChild(script);
  });
}

export async function renderPromptPayQR(elementId, promptPayId, amount) {
  const payload = buildPromptPayPayload(promptPayId, amount);
  const el = document.getElementById(elementId);
  if (!el) throw new Error('ไม่พบ element สำหรับ QR');
  el.innerHTML = '';
  const QRCode = await loadQrLib();
  new QRCode(el, {
    text: payload,
    width: 220,
    height: 220,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });
  return payload;
}

export async function completeSale({ payload, paymentMethod, amountReceived = null, changeAmount = null }) {
  if (!payload || !payload.items?.length) throw new Error('ไม่มีรายการสินค้า');
  if (!payload.transactionId) throw new Error('ไม่มี transactionId');
  const shopId = payload.shopId || getCurrentShopId();
  const userId = getCurrentUser()?.uid || null;
  const employeeId = payload.employeeId || getCurrentEmployee()?.id || null;
  const employeeName = payload.employeeName || '';
  try {
    const dupQ = query(collection(getDb(), 'sales'), where('shopId', '==', shopId), where('transactionId', '==', payload.transactionId), limit(1));
    const dupSnap = await getDocs(dupQ);
    if (!dupSnap.empty) throw new Error('รายการนี้ถูกบันทึกไปแล้ว (ป้องกันซ้ำ)');
  } catch (e) {
    if (e.message && e.message.includes('ป้องกันซ้ำ')) throw e;
    console.warn('dup check skipped', e.message);
  }
  const shop = await getShop(shopId);
  const receiptPrefix = shop?.receiptPrefix || 'INV';
  const receiptNo = await nextReceiptNumber(shopId, receiptPrefix);
  const saleId = generateId('sale');
  const paymentId = generateId('pay');
  const now = serverTimestamp();
  const saleData = {
    saleId, shopId, transactionId: payload.transactionId, receiptNo, employeeId, employeeName,
    status: 'COMPLETED',
    items: payload.items.map(i => ({
      productId: i.productId, barcode: i.barcode || null, name: i.name, quantity: i.quantity,
      unitPrice: i.unitPrice, costPrice: i.costPrice || 0, discount: 0, lineTotal: i.lineTotal, returnedQty: 0
    })),
    subtotal: payload.subtotal, discountType: payload.discountType || 'NONE',
    discountValue: payload.discountValue || 0, discountAmount: payload.discountAmount || 0,
    total: payload.total, paymentMethod,
    amountReceived: paymentMethod === 'CASH' ? Number(amountReceived) || payload.total : payload.total,
    changeAmount: paymentMethod === 'CASH' ? Number(changeAmount) || 0 : 0,
    paymentStatus: 'PAID', paymentId, createdAt: now, updatedAt: now, syncStatus: 'SYNCED'
  };
  const paymentData = {
    paymentId, shopId, saleId, method: paymentMethod, amount: payload.total, status: 'PAID',
    amountReceived: saleData.amountReceived, changeAmount: saleData.changeAmount,
    confirmedBy: employeeId, confirmedAt: now, createdAt: now
  };
  const receiptData = {
    receiptId: saleId, shopId, saleId, receiptNo,
    content: {
      shopName: shop?.name || 'ร้านค้า', shopAddress: shop?.address || '', shopPhone: shop?.phone || '',
      receiptFooter: shop?.receiptFooter || '', receiptNo, employeeName, paymentMethod,
      amountReceived: saleData.amountReceived, changeAmount: saleData.changeAmount,
      items: saleData.items, subtotal: saleData.subtotal, discountAmount: saleData.discountAmount,
      total: saleData.total, createdAt: new Date().toISOString()
    },
    createdAt: now
  };
  await runTransaction(getDb(), async (tx) => {
    const productSnaps = [];
    for (const item of payload.items) {
      const pref = doc(getDb(), 'products', item.productId);
      const snap = await tx.get(pref);
      if (!snap.exists()) throw new Error(`ไม่พบสินค้า: ${item.name}`);
      const data = snap.data();
      if (data.shopId !== shopId) throw new Error('สินค้าไม่ใช่ของร้านนี้');
      const stock = Number(data.stock) || 0;
      if (stock < item.quantity) throw new Error(`สต็อกไม่พอ: ${item.name} (เหลือ ${stock})`);
      productSnaps.push({ ref: pref, data, item, stock });
    }
    for (const { ref, data, item, stock } of productSnaps) {
      const after = stock - item.quantity;
      let status = data.status;
      if (after <= 0 && status === 'ACTIVE') status = 'OUT_OF_STOCK';
      tx.update(ref, { stock: after, status, updatedAt: serverTimestamp() });
      const txId = generateId('inv');
      tx.set(doc(getDb(), 'inventoryTransactions', txId), {
        txId, shopId, productId: item.productId, type: 'SALE', quantity: item.quantity,
        beforeStock: stock, afterStock: after, reason: 'ขายสินค้า', note: receiptNo,
        refType: 'SALE', refId: saleId, employeeId, createdAt: serverTimestamp()
      });
    }
    tx.set(doc(getDb(), 'sales', saleId), saleData);
    tx.set(doc(getDb(), 'payments', paymentId), paymentData);
    tx.set(doc(getDb(), 'receipts', saleId), receiptData);
  });
  await writeAuditLog({
    shopId, userId, employeeId, action: 'SALE', module: 'SALE', targetId: saleId,
    newValue: { receiptNo, total: payload.total, paymentMethod, itemCount: payload.itemCount }
  });
  clearCart();
  return { saleId, receiptNo, paymentId, sale: saleData, receipt: receiptData, shop };
}

export function buildReceiptHtml(result) {
  const r = result.receipt?.content || {};
  const sale = result.sale || {};
  const items = r.items || sale.items || [];
  const methodLabel = sale.paymentMethod === 'PROMPTPAY' ? 'PromptPay' : 'เงินสด';
  const rows = items.map(i => `
    <tr>
      <td style="text-align:left;padding:2px 0;">${escapeHtml(i.name)} x${i.quantity}</td>
      <td style="text-align:right;padding:2px 0;">${formatMoney(i.lineTotal)}</td>
    </tr>
  `).join('');
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>ใบเสร็จ ${escapeHtml(result.receiptNo)}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',Courier,monospace;font-size:12px;width:72mm;max-width:100%;margin:0 auto;padding:8px;color:#000}.center{text-align:center}.shop-name{font-size:16px;font-weight:bold;margin-bottom:4px}.muted{color:#333;font-size:11px}hr{border:none;border-top:1px dashed #000;margin:8px 0}table{width:100%;border-collapse:collapse}.total-row{font-size:14px;font-weight:bold}.footer{margin-top:12px;text-align:center;font-size:11px}@media print{body{width:72mm}.no-print{display:none!important}}</style></head><body>
<div class="center"><div class="shop-name">${escapeHtml(r.shopName||'ร้านค้า')}</div>
${r.shopAddress?`<div class="muted">${escapeHtml(r.shopAddress)}</div>`:''}
${r.shopPhone?`<div class="muted">โทร. ${escapeHtml(r.shopPhone)}</div>`:''}</div><hr>
<div>เลขที่: ${escapeHtml(result.receiptNo)}</div>
<div>วันที่: ${formatDateTime(sale.createdAt)!=='-'?formatDateTime(sale.createdAt):new Date().toLocaleString('th-TH')}</div>
<div>พนักงาน: ${escapeHtml(r.employeeName||sale.employeeName||'-')}</div><hr>
<table>${rows}</table><hr><table>
<tr><td>ยอดรวม</td><td style="text-align:right">${formatMoney(r.subtotal??sale.subtotal)}</td></tr>
${(r.discountAmount||sale.discountAmount)>0?`<tr><td>ส่วนลด</td><td style="text-align:right">-${formatMoney(r.discountAmount??sale.discountAmount)}</td></tr>`:''}
<tr class="total-row"><td>ยอดสุทธิ</td><td style="text-align:right">${formatMoney(r.total??sale.total)}</td></tr>
<tr><td>ชำระโดย</td><td style="text-align:right">${methodLabel}</td></tr>
${sale.paymentMethod==='CASH'?`<tr><td>รับเงิน</td><td style="text-align:right">${formatMoney(sale.amountReceived)}</td></tr><tr><td>เงินทอน</td><td style="text-align:right">${formatMoney(sale.changeAmount)}</td></tr>`:''}
</table><hr><div class="footer">${r.receiptFooter?escapeHtml(r.receiptFooter)+'<br>':''}ขอบคุณที่อุดหนุน</div>
<div class="no-print" style="margin-top:20px;text-align:center"><button onclick="window.print()" style="padding:12px 24px;font-size:16px">พิมพ์ใบเสร็จ</button></div>
</body></html>`;
}

export function openReceiptPrint(result) {
  const html = buildReceiptHtml(result);
  const w = window.open('', '_blank', 'width=400,height=600');
  if (!w) { showToast('กรุณาอนุญาตป๊อปอัปเพื่อพิมพ์ใบเสร็จ', 'error'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}

export async function reprintSale(sale, shop) {
  if (!sale) throw new Error('ไม่พบรายการขาย');
  const result = {
    saleId: sale.saleId || sale.id, receiptNo: sale.receiptNo, sale,
    receipt: { content: {
      shopName: shop?.name || 'ร้านค้า', shopAddress: shop?.address || '', shopPhone: shop?.phone || '',
      receiptFooter: shop?.receiptFooter || '', receiptNo: sale.receiptNo, employeeName: sale.employeeName || '',
      paymentMethod: sale.paymentMethod, amountReceived: sale.amountReceived, changeAmount: sale.changeAmount,
      items: sale.items || [], subtotal: sale.subtotal, discountAmount: sale.discountAmount, total: sale.total,
      createdAt: sale.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString()
    }}, shop
  };
  openReceiptPrint(result);
}
