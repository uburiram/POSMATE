// src/modules/auth/employeeSwitch.ui.js
// เลือกพนักงาน + ใส่ PIN เพื่อสวมสิทธิ์บนอุปกรณ์ (ข้อ 28)

import { listActiveEmployees } from "../employees/employees.basic.js";
import { switchEmployeeByPin } from "../../firebase/auth.js";
import { showToast, withLoading } from "../../shared/toast.js";

export async function renderEmployeeSwitchPage(container, { onSuccess }) {
  container.innerHTML = `
    <div class="pm-page">
      <div class="pm-header"><h1>เลือกพนักงาน</h1></div>
      <div id="emp-list" class="pm-loading">กำลังโหลด...</div>
    </div>
  `;

  const listEl = container.querySelector("#emp-list");
  try {
    const employees = await listActiveEmployees();
    if (employees.length === 0) {
      listEl.innerHTML = `<div class="pm-empty">ยังไม่มีพนักงาน กรุณาให้ผู้ดูแลระบบเพิ่มพนักงานก่อน</div>`;
      return;
    }
    listEl.innerHTML = "";
    employees.forEach((emp) => {
      const btn = document.createElement("button");
      btn.className = "pm-btn pm-btn--secondary";
      btn.style.marginBottom = "10px";
      btn.textContent = `${emp.firstName} ${emp.lastName} (${emp.code})`;
      btn.addEventListener("click", () => promptPin(emp));
      listEl.appendChild(btn);
    });
  } catch (err) {
    listEl.innerHTML = `<div class="pm-error">โหลดรายชื่อพนักงานไม่สำเร็จ: ${err.message}</div>`;
  }

  async function promptPin(emp) {
    const pin = prompt(`ใส่ PIN ของ ${emp.firstName}`);
    if (pin === null) return;
    try {
      await switchEmployeeByPin(emp.id, pin);
      showToast(`สวัสดี ${emp.firstName}`);
      onSuccess();
    } catch (err) {
      showToast(err.message, "error");
    }
  }
}
