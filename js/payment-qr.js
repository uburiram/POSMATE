/**
 * POSMATE — PromptPay QR (EMVCo)
 */
import { generateId, formatMoney, formatDateTime, escapeHtml, showToast } from './utils.js';

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
    if (!target.startsWith('66')) {
      target = '66' + target;
    }
    merchantInfo = tlv('00', 'A000000677010111') + tlv('01', target);
  }

  let payload = '';
  payload += tlv('00', '01');
  payload += tlv('01', amount != null && amount > 0 ? '12' : '11');
  payload += tlv('29', merchantInfo);
  payload += tlv('53', '764');
  if (amount != null && amount > 0) {
    payload += tlv('54', Number(amount).toFixed(2));
  }
  payload += tlv('58', 'TH');
  payload += '6304';
  payload += crc16Ccitt(payload);
  return payload;
}

function loadQrLib() {
  return new Promise((resolve, reject) => {
    if (window.QRCode) {
      resolve(window.QRCode);
      return;
    }
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
