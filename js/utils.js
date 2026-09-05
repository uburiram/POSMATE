/**
 * POSMATE — Utility Functions
 */

/** สร้าง UUID แบบง่าย (ไม่ต้องพึ่ง lib) */
export function generateId(prefix = '') {
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/** แปลง Timestamp เป็นข้อความไทย */
export function formatDateTime(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('th-TH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

export function formatDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatMoney(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Hash PIN ด้วย Web Crypto (SHA-256) */
export async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(pin).trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** เปรียบเทียบ PIN */
export async function verifyPin(pin, pinHash) {
  const hashed = await hashPin(pin);
  return hashed === pinHash;
}

/** แสดง Toast notification */
export function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/** แสดง Loading overlay */
export function showLoading(text = 'กำลังโหลด...') {
  let el = document.getElementById('global-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-loading';
    el.innerHTML = `<div class="loading-box"><div class="spinner"></div><p id="loading-text">${text}</p></div>`;
    document.body.appendChild(el);
  } else {
    document.getElementById('loading-text').textContent = text;
  }
  el.classList.add('active');
}

export function hideLoading() {
  const el = document.getElementById('global-loading');
  if (el) el.classList.remove('active');
}

/** Escape HTML */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Debounce */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * ลดขนาดรูปก่อนอัปโหลด (เหมาะกับมือถือ)
 * @param {File} file
 * @param {number} maxWidth
 * @param {number} quality 0–1
 * @returns {Promise<Blob>}
 */
export function compressImage(file, maxWidth = 800, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('ไฟล์ไม่ใช่รูปภาพ'));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round(h * (maxWidth / w));
        w = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('บีบอัดรูปไม่สำเร็จ'));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('โหลดรูปไม่สำเร็จ'));
    };
    img.src = url;
  });
}

/** สถานะสินค้าเป็นภาษาไทย */
export function productStatusLabel(status) {
  const map = {
    ACTIVE: 'ใช้งาน',
    INACTIVE: 'ปิด',
    OUT_OF_STOCK: 'หมด'
  };
  return map[status] || status || '-';
}

/** ประเภท movement เป็นภาษาไทย */
export function movementTypeLabel(type) {
  const map = {
    IN: 'รับเข้า',
    OUT: 'จ่ายออก',
    ADJUST: 'ปรับยอด',
    SALE: 'ขาย',
    CANCEL: 'ยกเลิกขาย',
    RETURN: 'คืนสินค้า',
    DAMAGE: 'เสียหาย',
    LOSS: 'สูญหาย',
    INTERNAL: 'ใช้ในร้าน'
  };
  return map[type] || type || '-';
}
