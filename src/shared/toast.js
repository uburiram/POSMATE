// src/shared/toast.js
// Success/Error notification แบบง่าย ใช้ร่วมกันทุกหน้า (ข้อ 4, 52: ต้องมี
// Loading State / Empty State / Error State / Success Notification)

let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement("div");
  container.id = "posmate-toast-container";
  container.style.cssText = `
    position: fixed; left: 0; right: 0; bottom: 16px;
    display: flex; flex-direction: column; align-items: center;
    gap: 8px; z-index: 9999; pointer-events: none;
  `;
  document.body.appendChild(container);
  return container;
}

export function showToast(message, type = "success") {
  const el = document.createElement("div");
  const bg = type === "error" ? "#d9363e" : type === "info" ? "#1f6feb" : "#1a7f37";
  el.textContent = message;
  el.style.cssText = `
    background: ${bg}; color: white; padding: 12px 20px;
    border-radius: 10px; font-size: 15px; max-width: 90vw;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  `;
  ensureContainer().appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/**
 * ครอบ async action ด้วย loading + error handling มาตรฐาน
 * ใช้กับปุ่ม submit ทุกที่ เพื่อ disable ปุ่ม/แสดง "กำลังบันทึก..." อัตโนมัติ
 * ป้องกันการกดซ้ำ (ข้อ 37)
 */
export async function withLoading(buttonEl, action, { loadingText = "กำลังบันทึก..." } = {}) {
  if (buttonEl.dataset.busy === "1") return; // กันกดซ้ำ
  const originalText = buttonEl.textContent;
  buttonEl.dataset.busy = "1";
  buttonEl.disabled = true;
  buttonEl.textContent = loadingText;
  try {
    const result = await action();
    return result;
  } catch (err) {
    console.error(err);
    showToast(err.message || "เกิดข้อผิดพลาด กรุณาลองใหม่", "error");
    throw err;
  } finally {
    buttonEl.dataset.busy = "0";
    buttonEl.disabled = false;
    buttonEl.textContent = originalText;
  }
}
