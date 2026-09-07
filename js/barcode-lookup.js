/**
 * POSMATE — Barcode product lookup (Thai-first)
 *
 * ลำดับการค้นหา:
 * 1) แคตตาล็อกในร้าน/ระบบ (barcodeCatalog) — ชื่อที่เคยบันทึกไว้
 * 2) Open Food Facts (th + world) — อาหาร
 * 3) Open Beauty Facts — เครื่องสำอาง/ของใช้
 * 4) Open Products Facts — สินค้าทั่วไป
 *
 * หมายเหตุ: ไม่มีฐานข้อมูลสาธารณะใดรับประกันชื่อสินค้าไทย 100%
 * ระบบจึง "เรียนรู้" จากสินค้าที่ร้านเคยบันทึก เพื่อครั้งถัดไปดึงชื่อได้ทันที
 */

import { normalizeBarcode } from './pos.js';

const UA = 'POSMATE/1.0.5 (Thai POS; https://github.com/uburiram/POSMATE)';

function isThaiText(s) {
  return /[\u0E00-\u0E7F]/.test(String(s || ''));
}

/** เลือกชื่อที่เหมาะกับร้านไทยที่สุด */
export function pickBestThaiName(...candidates) {
  const cleaned = candidates
    .map(c => String(c || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (!cleaned.length) return '';
  const thai = cleaned.filter(isThaiText);
  if (thai.length) {
    thai.sort((a, b) => b.length - a.length);
    return thai[0];
  }
  cleaned.sort((a, b) => b.length - a.length);
  return cleaned[0];
}

function extractFromOffProduct(p) {
  if (!p) return null;
  const name = pickBestThaiName(
    p.product_name_th,
    p.product_name_th_TH,
    p.product_name,
    p.abbreviated_product_name,
    p.generic_name_th,
    p.generic_name,
    p.product_name_en
  );
  if (!name) return null;
  const brand = pickBestThaiName(
    ...(String(p.brands || '').split(',').map(s => s.trim()))
  ) || (p.brands || '').split(',')[0]?.trim() || '';
  return {
    name,
    brand: brand || '',
    quantity: String(p.quantity || '').trim(),
    unit: '',
    imageUrl: p.image_front_small_url || p.image_front_url || p.image_url || null,
    categories: Array.isArray(p.categories_tags) ? p.categories_tags.slice(0, 5) : [],
    source: 'openfoodfacts'
  };
}

async function fetchJson(url, timeoutMs = 9000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      signal: ctrl?.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': UA }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function lookupOpenFacts(barcode, host) {
  const code = normalizeBarcode(barcode);
  const data = await fetchJson(
    `https://${host}/api/v2/product/${encodeURIComponent(code)}.json`
  );
  if (!data || data.status !== 1 || !data.product) return null;
  const info = extractFromOffProduct(data.product);
  if (info) info.source = host.includes('beauty') ? 'openbeautyfacts'
    : host.includes('product') ? 'openproductsfacts' : 'openfoodfacts';
  return info;
}

/**
 * ค้นหาชื่อสินค้าจากหลายแหล่ง (Thai-first)
 */
export async function lookupProductByBarcode(barcode, opts = {}) {
  const code = normalizeBarcode(barcode);
  if (!code) return null;

  if (typeof opts.getCatalog === 'function') {
    try {
      const cat = await opts.getCatalog(code);
      if (cat && cat.name) {
        return {
          name: cat.name,
          brand: cat.brand || '',
          quantity: cat.quantity || '',
          unit: cat.unit || '',
          imageUrl: cat.imageUrl || null,
          categories: cat.categories || [],
          source: 'local_catalog'
        };
      }
    } catch (e) {
      console.warn('catalog lookup', e);
    }
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return null;
  }

  const hosts = [
    'th.openfoodfacts.org',
    'world.openfoodfacts.org',
    'world.openbeautyfacts.org',
    'world.openproductsfacts.org'
  ];

  for (const host of hosts) {
    try {
      const info = await lookupOpenFacts(code, host);
      if (info && info.name) return info;
    } catch (e) {
      console.warn('lookup', host, e);
    }
  }

  return null;
}

export function sourceLabel(source) {
  const map = {
    local_catalog: 'ข้อมูลที่ร้านเคยบันทึก',
    openfoodfacts: 'Open Food Facts',
    openbeautyfacts: 'Open Beauty Facts',
    openproductsfacts: 'Open Products Facts'
  };
  return map[source] || source || 'ภายนอก';
}
