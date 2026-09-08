/**
 * POSMATE — Shop settings
 */
import { getShop, saveShop, writeAuditLog } from './db.js';
import { getCurrentUser, getCurrentShopId, hasRole } from './auth.js';
import {
  showToast, showLoading, hideLoading, escapeHtml
} from './utils.js';
import { DEFAULT_SHOP_ID, APP_VERSION } from './config.js';
import { $, pageContent, navigate } from './app-state.js';

export async function renderSettings() {
  if (!hasRole('ADMIN', 'MANAGER')) {
    pageContent.innerHTML = '<div class="card"><p>ไม่มีสิทธิ์</p></div>';
    return;
  }

  showLoading('โหลดข้อมูลร้าน...');
  const shop = await getShop(getCurrentShopId()) || {};
  hideLoading();

  const isAdmin = hasRole('ADMIN');

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:16px;">ตั้งค่าข้อมูลร้าน</h2>
      <form id="shop-form">
        <div class="form-group">
          <label>ชื่อร้าน *</label>
          <input type="text" id="s-name" class="form-control" value="${escapeHtml(shop.name || '')}" required ${isAdmin ? '' : 'readonly'}>
        </div>
        <div class="form-group">
          <label>ที่อยู่</label>
          <textarea id="s-address" class="form-control" rows="2" ${isAdmin ? '' : 'readonly'}>${escapeHtml(shop.address || '')}</textarea>
        </div>
        <div class="form-group">
          <label>เบอร์โทรร้าน</label>
          <input type="tel" id="s-phone" class="form-control" value="${escapeHtml(shop.phone || '')}" ${isAdmin ? '' : 'readonly'}>
        </div>
        <div class="form-group">
          <label>ข้อความท้ายใบเสร็จ</label>
          <textarea id="s-footer" class="form-control" rows="2" ${isAdmin ? '' : 'readonly'}>${escapeHtml(shop.receiptFooter || '')}</textarea>
        </div>
        <hr style="margin:16px 0;border:none;border-top:1px solid var(--border);">
        <h3 style="font-size:0.95rem;margin-bottom:12px;">PromptPay</h3>
        <div class="form-group">
          <label>หมายเลข PromptPay (เบอร์โทร / เลขบัตรประชาชน)</label>
          <input type="text" id="s-promptpay" class="form-control" value="${escapeHtml(shop.promptPayId || '')}" ${isAdmin ? '' : 'readonly'} placeholder="0812345678">
        </div>
        <div class="form-group">
          <label>ชื่อบัญชี PromptPay</label>
          <input type="text" id="s-promptpay-name" class="form-control" value="${escapeHtml(shop.promptPayName || '')}" ${isAdmin ? '' : 'readonly'}>
        </div>
        <div class="form-group">
          <label>สกุลเงิน</label>
          <input type="text" id="s-currency" class="form-control" value="${escapeHtml(shop.currency || 'THB')}" ${isAdmin ? '' : 'readonly'}>
        </div>
        ${isAdmin ? `
          <button type="submit" class="btn btn-primary btn-block btn-lg">บันทึกการตั้งค่า</button>
        ` : `<p class="text-muted text-center">เฉพาะ Admin แก้ไขได้</p>`}
      </form>
    </div>
  `;

  if (isAdmin) {
    $('#shop-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveShopForm(shop);
    });
  }
}

export async function saveShopForm(oldShop) {
  const data = {
    name: $('#s-name').value.trim(),
    address: $('#s-address').value.trim(),
    phone: $('#s-phone').value.trim(),
    receiptFooter: $('#s-footer').value.trim(),
    promptPayId: $('#s-promptpay').value.trim(),
    promptPayName: $('#s-promptpay-name').value.trim(),
    currency: $('#s-currency').value.trim() || 'THB'
  };

  if (!data.name) {
    showToast('กรุณากรอกชื่อร้าน', 'error');
    return;
  }

  showLoading('กำลังบันทึก...');
  try {
    const shopId = getCurrentShopId();
    await saveShop(shopId, data);
    await writeAuditLog({
      shopId,
      userId: getCurrentUser()?.uid,
      employeeId: getCurrentEmployee()?.id,
      action: 'UPDATE_SHOP',
      module: 'SETTINGS',
      targetId: shopId,
      oldValue: {
        name: oldShop?.name ?? null,
        promptPayId: oldShop?.promptPayId ?? null,
        promptPayName: oldShop?.promptPayName ?? null
      },
      newValue: {
        name: data.name,
        promptPayId: data.promptPayId || null,
        promptPayName: data.promptPayName || null
      }
    });
    hideLoading();
    showToast('บันทึกข้อมูลร้านสำเร็จ', 'success');
    renderSettings();
  } catch (err) {
    hideLoading();
    console.error(err);
    showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
  }
}

