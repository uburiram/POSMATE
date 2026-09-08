/**
 * POSMATE — Sales history / cancel / refund UI
 */
import {
  listSales, getSale, cancelSale, refundSale, getShop
} from './db.js';
import {
  getCurrentUser, getCurrentEmployee, getCurrentShopId, hasRole, canAccess
} from './auth.js';
import {
  showToast, showLoading, hideLoading, escapeHtml, formatMoney, formatDateTime,
  firestoreErrorHtml, isFirestoreIndexError
} from './utils.js';
import { openReceiptPrint, reprintSale } from './payment.js';
import { $, pageContent, navigate } from './app-state.js';

let historyFilter = { status: 'ALL', paymentMethod: 'ALL', receiptNo: '' };

export function saleStatusLabel(status) {
  const map = {
    COMPLETED: 'สำเร็จ',
    CANCELLED: 'ยกเลิก',
    REFUNDED: 'คืนเงิน'
  };
  return map[status] || status || '-';
}

export function saleStatusClass(status) {
  if (status === 'COMPLETED') return 'badge-success';
  if (status === 'CANCELLED') return 'badge-danger';
  if (status === 'REFUNDED') return 'badge-muted';
  return 'badge-muted';
}

export async function renderSalesHistory() {
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
    console.error(err);
    pageContent.innerHTML = firestoreErrorHtml(err, { title: 'ประวัติการขาย', retryId: 'btn-retry-hist' });
    $('#btn-retry-hist')?.addEventListener('click', () => renderSalesHistory());
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

export async function openSaleDetail(saleId) {
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

export function openCancelSaleForm(sale) {
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

export function openRefundForm(sale) {
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

