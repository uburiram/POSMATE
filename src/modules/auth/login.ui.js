// src/modules/auth/login.ui.js
// หน้า Login ด้วยบัญชี Firebase หลักของร้าน (device owner)
// การสลับพนักงานรายวันทำผ่าน PIN (employeeSwitch.ui.js) หลัง login สำเร็จ

import { loginWithEmail } from "../../firebase/auth.js";
import { showToast, withLoading } from "../../shared/toast.js";

export function renderLoginPage(container, { onSuccess }) {
  container.innerHTML = `
    <div class="pm-page" style="max-width:400px; padding-top:20vh;">
      <h1 style="text-align:center;">POSMATE</h1>
      <label class="pm-label">อีเมล</label>
      <input id="login-email" type="email" class="pm-input" autocomplete="username" />
      <label class="pm-label">รหัสผ่าน</label>
      <input id="login-password" type="password" class="pm-input" autocomplete="current-password" />
      <button id="login-btn" class="pm-btn">เข้าสู่ระบบ</button>
    </div>
  `;

  const btn = container.querySelector("#login-btn");
  btn.addEventListener("click", () => {
    withLoading(btn, async () => {
      const email = container.querySelector("#login-email").value.trim();
      const password = container.querySelector("#login-password").value;
      if (!email || !password) throw new Error("กรุณากรอกอีเมลและรหัสผ่าน");
      await loginWithEmail(email, password);
      onSuccess();
    }, { loadingText: "กำลังเข้าสู่ระบบ..." });
  });
}
