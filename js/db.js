/**
 * POSMATE — Firestore Database Layer
 * Phase 2 + Phase 3 (Categories, Products, Inventory)
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  runTransaction,
  onSnapshot,
  startAt,
  endAt
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { firebaseConfig, DEFAULT_SHOP_ID } from './config.js';
import { generateId } from './utils.js';

let app = null;
let db = null;
let storage = null;

export function initFirebase() {
  if (app) return { app, db, storage };
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  storage = getStorage(app);
  return { app, db, storage };
}

export function getDb() {
  if (!db) initFirebase();
  return db;
}

export function getStorageInstance() {
  if (!storage) initFirebase();
  return storage;
}

export { serverTimestamp, writeBatch, runTransaction, onSnapshot, collection, doc, query, where, orderBy, limit };

// ---------- Shop ----------
export async function getShop(shopId = DEFAULT_SHOP_ID) {
  const snap = await getDoc(doc(getDb(), 'shops', shopId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveShop(shopId, data) {
  const refDoc = doc(getDb(), 'shops', shopId);
  await setDoc(refDoc, {
    ...data,
    shopId,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// ---------- Users ----------
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(getDb(), 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveUserProfile(uid, data) {
  await setDoc(doc(getDb(), 'users', uid), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// ---------- Employees ----------
export async function listEmployees(shopId = DEFAULT_SHOP_ID) {
  const q = query(
    collection(getDb(), 'employees'),
    where('shopId', '==', shopId),
    orderBy('code')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getEmployee(employeeId) {
  const snap = await getDoc(doc(getDb(), 'employees', employeeId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getEmployeeByCode(shopId, code) {
  const q = query(
    collection(getDb(), 'employees'),
    where('shopId', '==', shopId),
    where('code', '==', code),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function saveEmployee(employeeId, data) {
  const refDoc = doc(getDb(), 'employees', employeeId || generateId('emp'));
  const payload = {
    ...data,
    updatedAt: serverTimestamp()
  };
  if (!employeeId) {
    payload.createdAt = serverTimestamp();
  }
  await setDoc(refDoc, payload, { merge: true });
  return refDoc.id;
}

// ---------- Audit Log ----------
/** ลบ undefined ออกจาก object/array ก่อนเขียน Firestore (Firestore ไม่รับ undefined) */
function stripUndefined(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(stripUndefined).filter(v => v !== undefined);
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    out[k] = stripUndefined(v);
  }
  return out;
}

export async function writeAuditLog({
  shopId = DEFAULT_SHOP_ID,
  userId,
  employeeId,
  action,
  module,
  targetId = null,
  oldValue = null,
  newValue = null,
  reason = null
}) {
  const logId = generateId('log');
  await setDoc(doc(getDb(), 'auditLogs', logId), {
    logId,
    shopId,
    userId: userId || null,
    employeeId: employeeId || null,
    action,
    module,
    targetId: targetId ?? null,
    oldValue: oldValue != null ? stripUndefined(oldValue) : null,
    newValue: newValue != null ? stripUndefined(newValue) : null,
    reason: reason ?? null,
    createdAt: serverTimestamp()
  });
  return logId;
}
