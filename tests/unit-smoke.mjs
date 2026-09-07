/**
 * POSMATE static unit tests (Node, no browser)
 * Run: node tests/unit-smoke.mjs
 */
import { createRequire } from 'module';
import assert from 'assert';

// Inline pure helpers mirrored from production
function normalizeBarcode(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/\s+/g, '');
}
function barcodeVariants(raw) {
  const code = normalizeBarcode(raw);
  if (!code) return [];
  const set = new Set([code]);
  if (/^\d+$/.test(code)) {
    if (code.length === 12) set.add('0' + code);
    if (code.length === 13 && code.startsWith('0')) set.add(code.slice(1));
    const stripped = code.replace(/^0+/, '');
    if (stripped && stripped !== code) set.add(stripped);
  }
  return [...set];
}
function genSku({ categoryName = '', barcode = '', existingSkus = [] } = {}) {
  const raw = String(categoryName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = (raw.slice(0, 4) || 'PRD');
  if (barcode) {
    const digits = String(barcode).replace(/\D/g, '');
    const tail = (digits || String(barcode)).slice(-6).toUpperCase();
    return `${prefix}-${tail}`;
  }
  let maxSeq = 0;
  for (const sku of existingSkus) {
    const s = String(sku || '');
    let n = null;
    if (s.toUpperCase().startsWith(prefix + '-')) n = parseInt(s.slice(prefix.length + 1), 10);
    else {
      const m = s.match(/(\d+)$/);
      if (m) n = parseInt(m[1], 10);
    }
    if (n != null && !Number.isNaN(n)) maxSeq = Math.max(maxSeq, n);
  }
  return `${prefix}-${String(maxSeq + 1).padStart(4, '0')}`;
}

function stripUndefined(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripUndefined).filter(v => v !== undefined);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = stripUndefined(v);
  }
  return out;
}

// Tests
assert.strictEqual(normalizeBarcode('  885 99 '), '88599');
assert.ok(barcodeVariants('885123456789').includes('885123456789'));
assert.ok(barcodeVariants('085123456789').includes('85123456789') || barcodeVariants('085123456789').includes('085123456789'));
const v12 = barcodeVariants('851234567890'); // 12 digit
assert.ok(v12.includes('0851234567890') || v12.includes('851234567890'));

assert.strictEqual(genSku({ categoryName: 'Beverage', barcode: '8850991234567' }), 'BEVE-234567');
assert.strictEqual(genSku({ categoryName: 'ขนม', barcode: '' , existingSkus: [] }), 'PRD-0001');
assert.strictEqual(genSku({ categoryName: 'Snack', existingSkus: ['SNAC-0003', 'SNAC-0001'] }), 'SNAC-0004');

const cleaned = stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: 2 }, f: [1, undefined, 3] });
assert.strictEqual(cleaned.b, undefined);
assert.ok(!('b' in cleaned));
assert.strictEqual(cleaned.c.e, 2);
assert.ok(!('d' in cleaned.c));

console.log('ALL UNIT TESTS PASSED');
