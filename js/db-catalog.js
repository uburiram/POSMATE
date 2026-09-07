/**
 * POSMATE — Barcode catalog (shared name learning)
 */
import { getDb, serverTimestamp } from './db.js';
import {
  doc, getDoc, setDoc, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

export async function getBarcodeCatalog(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;
  try {
    const snap = await getDoc(doc(getDb(), 'barcodeCatalog', code));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    console.warn('getBarcodeCatalog', e);
    return null;
  }
}

export async function upsertBarcodeCatalog(barcode, info) {
  const code = String(barcode || '').trim();
  if (!code || !info?.name) return;
  const ref = doc(getDb(), 'barcodeCatalog', code);
  const payload = {
    barcode: code,
    name: String(info.name).trim(),
    brand: info.brand ? String(info.brand).trim() : null,
    quantity: info.quantity ? String(info.quantity).trim() : null,
    unit: info.unit ? String(info.unit).trim() : null,
    imageUrl: info.imageUrl || null,
    categories: info.categories || null,
    source: info.source || 'shop',
    updatedAt: serverTimestamp()
  };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
    }
  } catch (e) {
    console.warn('upsertBarcodeCatalog', e);
  }
}
