/**
 * POSMATE — Employees management
 */
import { listEmployees, getEmployee, saveEmployee, writeAuditLog } from './db.js';
import {
  getCurrentUser, getCurrentShopId, hasRole
} from './auth.js';
import {
  showToast, showLoading, hideLoading, escapeHtml, formatDateTime, hashPin
} from './utils.js';
import { $, pageContent, navigate } from './app-state.js';

export async function renderEmployees() {
  if (!hasRole('ADMIN')) {
    pageContent.innerHTML = '<div class="card"><p>เฉพาะ Admin เท่านั้น</p></div>';
    return;
  }

  showLoading('โหลดรายชื่อพนักงาน...');
  let list = [];
  try {
    list = await listEmployees(getCurrentShopId());
  } catch (err) {
    hideLoading();
    console.error(err);
    const msg = err?.message || String(err);
    const needIndex = /requires an index|failed-precondition/i.test(msg);
    pageContent.innerHTML = `
      <div class="card">
        <h2 style="font-size:1.15rem;margin-bottom:8px;">พนักงาน</h2>
        <p class="text-danger" style="font-size:0.9rem;">
          ${needIndex
            ? 'ฐานข้อมูลกำลังเตรียม Index กรุณารอ 1–5 นาที แล้วรีเฟรชหน้านี้'
            : 'โหลดรายชื่อพนักงานไม่สำเร็จ'}
        </p>
        ${needIndex ? `
          <p class="text-muted" style="font-size:0.8rem;margin-top:8px;">
            เปิด Firebase Console → Firestore → Indexes แล้วรอสถานะ Enabled
          </p>
          <a class="btn btn-outline btn-block mt-2" target="_blank" rel="noopener"
             href="https://console.firebase.google.com/u/0/project/posmate-4f87b/firestore/indexes">
            เปิดหน้า Indexes
          </a>
        ` : `<p class="text-muted" style="font-size:0.8rem;">${escapeHtml(msg)}</p>`}
        <button class="btn btn-primary btn-block mt-2" id="btn-retry-emp">ลองใหม่</button>
      </div>`;
    $('#btn-retry-emp')?.addEventListener('click', () => renderEmployees());
    return;
  }
  hideLoading();

  pageContent.innerHTML = `
    <div class="flex-between mb-2">
      <h2 style="font-size:1.15rem;">พนักงาน</h2>
      <button class="btn btn-primary btn-sm" id="btn-add-emp">+ เพิ่ม</button>
    </div>
    <div id="emp-list">
      ${list.length === 0 ? `
        <div class="card text-center text-muted">
          <p>ยังไม่มีพนักงาน</p>
          <p style="font-size:0.85rem;">กดปุ่ม "เพิ่ม" เพื่อสร้างพนักงานคนแรก</p>
        </div>
      ` : list.map(emp => `
        <div class="card emp-card" data-id="${escapeHtml(emp.id)}" style="margin-bottom:10px;cursor:pointer;">
          <div class="flex-between">
            <div>
              <strong>${escapeHtml(emp.code)} — ${escapeHtml(emp.firstName || '')} ${escapeHtml(emp.lastName || '')}</strong>
              <div class="text-muted" style="font-size:0.8rem;">
                ${escapeHtml(emp.role || 'CASHIER')} · ${emp.status === 'ACTIVE' ? 'ใช้งาน' : 'ปิด'}
              </div>
            </div>
            <span style="font-size:1.2rem;">›</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  $('#btn-add-emp')?.addEventListener('click', () => openEmployeeForm(null));
  pageContent.querySelectorAll('.emp-card').forEach(card => {
    card.addEventListener('click', () => openEmployeeForm(card.dataset.id));
  });
}

export async function openEmployeeForm(employeeId) {
  let emp = null;
  if (employeeId) {
    showLoading();
    emp = await getEmployee(employeeId);
    hideLoading();
  }

  pageContent.innerHTML = `
    <div class="card">
      <h2 style="font-size:1.1rem;margin-bottom:16px;">${emp ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงานใหม่'}</h2>
      <form id="emp-form">
        <div class="form-group">
          <label>รหัสพนักงาน *</label>
          <input type="text" id="f-code" class="form-control" value="${escapeHtml(emp?.code || '')}" required inputmode="numeric" placeholder="001">
        </div>
        <div class="form-group">
          <label>ชื่อ *</label>
          <input type="text" id="f-first" class="form-control" value="${escapeHtml(emp?.firstName || '')}" required>
        </div>
        <div class="form-group">
          <label>นามสกุล</label>
          <input type="text" id="f-last" class="form-control" value="${escapeHtml(emp?.lastName || '')}">
        </div>
        <div class="form-group">
          <label>เบอร์โทร</label>
          <input type="tel" id="f-phone" class="form-control" value="${escapeHtml(emp?.phone || '')}">
        </div>
        <div class="form-group">
          <label>ตำแหน่ง / Role *</label>
          <select id="f-role" class="form-control">
            <option value="CASHIER" ${emp?.role === 'CASHIER' ? 'selected' : ''}>แคชเชียร์ (CASHIER)</option>
            <option value="MANAGER" ${emp?.role === 'MANAGER' ? 'selected' : ''}>ผู้จัดการ (MANAGER)</option>
            <option value="ADMIN" ${emp?.role === 'ADMIN' ? 'selected' : ''}>แอดมิน (ADMIN)</option>
          </select>
        </div>
        <div class="form-group">
          <label>PIN (4–6 หลัก) ${emp ? '(ว่างไว้ถ้าไม่เปลี่ยน)' : '*'}</label>
          <input type="password" id="f-pin" class="form-control pin-input" maxlength="6" inputmode="numeric" ${emp ? '' : 'required'} placeholder="••••">
        </div>
        <div class="form-group">
          <label>สถานะ</label>
          <select id="f-status" class="form-control">
            <option value="ACTIVE" ${!emp || emp.status === 'ACTIVE' ? 'selected' : ''}>ใช้งาน</option>
            <option value="INACTIVE" ${emp?.status === 'INACTIVE' ? 'selected' : ''}>ปิดการใช้งาน</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary btn-block btn-lg">บันทึก</button>
        <button type="button" class="btn btn-outline btn-block mt-1" id="btn-cancel-emp">ยกเลิก</button>
      </form>
    </div>
  `;

  $('#btn-cancel-emp').addEventListener('click', () => renderEmployees());
  $('#emp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveEmployeeForm(employeeId);
  });
}

export async function saveEmployeeForm(employeeId) {
  const code = $('#f-code').value.trim();
  const firstName = $('#f-first').value.trim();
  const lastName = $('#f-last').value.trim();
  const phone = $('#f-phone').value.trim();
  const role = $('#f-role').value;
  const pin = $('#f-pin').value.trim();
  const status = $('#f-status').value;

  if (!code || !firstName) {
    showToast('กรุณากรอกรหัสและชื่อ', 'error');
    return;
  }
  if (!employeeId && (!pin || pin.length < 4)) {
    showToast('PIN ต้องมีอย่างน้อย 4 หลัก', 'error');
    return;
  }
  if (pin && (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin))) {
    showToast('PIN ต้องเป็นตัวเลข 4–6 หลัก', 'error');
    return;
  }

  showLoading('กำลังบันทึก...');
  try {
    const shopId = getCurrentShopId();
    const data = {
      shopId,
      code,
      firstName,
      lastName,
      phone,
      role,
      status
    };
    if (pin) {
      data.pinHash = await hashPin(pin);
    }

    const id = await saveEmployee(employeeId, data);

    await writeAuditLog({
      shopId,
      userId: getCurrentUser()?.uid,
      employeeId: getCurrentEmployee()?.id,
      action: employeeId ? 'UPDATE_EMPLOYEE' : 'CREATE_EMPLOYEE',
      module: 'EMPLOYEE',
      targetId: id || employeeId,
      newValue: { code, firstName, role, status }
    });

    hideLoading();
    showToast('บันทึกพนักงานสำเร็จ', 'success');
    renderEmployees();
  } catch (err) {
    hideLoading();
    console.error(err);
    showToast(err.message || 'บันทึกไม่สำเร็จ', 'error');
  }
}


