/**
 * POSMATE — Authentication & Session (Phase 2)
 *
 * Flow:
 * 1. Firebase Auth (email/password)
 * 2. โหลด user profile + role + shopId จาก Firestore
 * 3. Employee PIN switch (ไม่ต้อง logout Firebase)
 */

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initFirebase, getUserProfile, saveUserProfile, getEmployee, getEmployeeByCode, writeAuditLog } from './db.js';
import { DEFAULT_SHOP_ID } from './config.js';
import { hashPin, verifyPin, showToast, showLoading, hideLoading } from './utils.js';

let auth = null;
let currentUser = null;       // Firebase User
let currentProfile = null;    // users/{uid}
let currentEmployee = null;   // พนักงานที่กำลังใช้งาน (หลังใส่ PIN)

const SESSION_KEY = 'posmate_session';

export function initAuth() {
  initFirebase();
  auth = getAuth();
  return auth;
}

export function getAuthInstance() {
  if (!auth) initAuth();
  return auth;
}

/** ฟังก์ชันรอ Auth state ครั้งแรก */
export function waitForAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(getAuthInstance(), (user) => {
      unsub();
      resolve(user);
    });
  });
}

/** Login ด้วย Email + Password */
export async function loginWithEmail(email, password) {
  showLoading('กำลังเข้าสู่ระบบ...');
  try {
    const cred = await signInWithEmailAndPassword(getAuthInstance(), email.trim(), password);
    currentUser = cred.user;

    // โหลด profile
    let profile = await getUserProfile(currentUser.uid);
    if (!profile) {
      // ยังไม่มี profile → สร้างชั่วคราว (Admin ต้องตั้งค่า role ทีหลัง)
      profile = {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName || email.split('@')[0],
        role: 'CASHIER',
        shopId: DEFAULT_SHOP_ID,
        active: true
      };
      await saveUserProfile(currentUser.uid, { ...profile, createdAt: new Date() });
      // หมายเหตุ: user คนแรกควรตั้ง role=ADMIN ใน Firestore Console
    }

    if (!profile.active) {
      await signOut(getAuthInstance());
      throw new Error('บัญชีนี้ถูกระงับการใช้งาน');
    }

    currentProfile = profile;
    saveSession();

    await writeAuditLog({
      shopId: profile.shopId,
      userId: currentUser.uid,
      action: 'LOGIN',
      module: 'AUTH',
      targetId: currentUser.uid
    });

    hideLoading();
    return { user: currentUser, profile };
  } catch (err) {
    hideLoading();
    console.error(err);
    let msg = 'เข้าสู่ระบบไม่สำเร็จ';
    if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      msg = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    } else if (err.code === 'auth/too-many-requests') {
      msg = 'พยายามหลายครั้งเกินไป กรุณารอสักครู่';
    } else if (err.message) {
      msg = err.message;
    }
    throw new Error(msg);
  }
}

/** Logout */
export async function logout() {
  if (currentUser) {
    try {
      await writeAuditLog({
        shopId: currentProfile?.shopId || DEFAULT_SHOP_ID,
        userId: currentUser.uid,
        employeeId: currentEmployee?.id,
        action: 'LOGOUT',
        module: 'AUTH'
      });
    } catch (e) { /* ignore */ }
  }
  await signOut(getAuthInstance());
  currentUser = null;
  currentProfile = null;
  currentEmployee = null;
  clearSession();
}

/** โหลด session จาก localStorage (หลัง refresh) */
export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession() {
  const data = {
    uid: currentUser?.uid,
    email: currentUser?.email,
    role: currentProfile?.role,
    shopId: currentProfile?.shopId,
    employeeId: currentEmployee?.id || null,
    employeeName: currentEmployee ? `${currentEmployee.firstName} ${currentEmployee.lastName || ''}`.trim() : null
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/** ตั้งค่า current user/profile หลัง onAuthStateChanged */
export async function setCurrentFromAuth(user) {
  currentUser = user;
  if (!user) {
    currentProfile = null;
    currentEmployee = null;
    clearSession();
    return null;
  }
  currentProfile = await getUserProfile(user.uid);
  // restore employee จาก session ถ้ามี
  const sess = loadSession();
  if (sess?.employeeId) {
    currentEmployee = await getEmployee(sess.employeeId);
  }
  saveSession();
  return currentProfile;
}

export function getCurrentUser() { return currentUser; }
export function getCurrentProfile() { return currentProfile; }
export function getCurrentEmployee() { return currentEmployee; }
export function getCurrentRole() { return currentProfile?.role || 'CASHIER'; }
export function getCurrentShopId() { return currentProfile?.shopId || DEFAULT_SHOP_ID; }

/** ตรวจสอบสิทธิ์ */
export function hasRole(...roles) {
  const r = getCurrentRole();
  return roles.includes(r);
}

export function canAccess(requiredRoles) {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  return hasRole(...requiredRoles);
}

/**
 * Employee PIN Switch
 * ใช้เมื่อมีหลายพนักงานใช้เครื่องเดียวกัน
 */
export async function switchEmployeeByPin(code, pin) {
  const shopId = getCurrentShopId();
  const emp = await getEmployeeByCode(shopId, code);

  if (!emp) {
    throw new Error('ไม่พบรหัสพนักงานนี้');
  }
  if (emp.status !== 'ACTIVE') {
    throw new Error('พนักงานคนนี้ถูกปิดการใช้งาน');
  }

  const ok = await verifyPin(pin, emp.pinHash);
  if (!ok) {
    throw new Error('PIN ไม่ถูกต้อง');
  }

  currentEmployee = emp;
  saveSession();

  await writeAuditLog({
    shopId,
    userId: currentUser?.uid,
    employeeId: emp.id,
    action: 'EMPLOYEE_SWITCH',
    module: 'AUTH',
    targetId: emp.id
  });

  return emp;
}

export function clearCurrentEmployee() {
  currentEmployee = null;
  saveSession();
}

/** สร้าง user ใหม่ (Admin only — ใช้จากหน้าจัดการ) */
export async function createAuthUser(email, password, profileData) {
  // หมายเหตุ: การสร้าง user จาก client จะทำให้ session เปลี่ยนเป็น user ใหม่
  // ใน production ควรใช้ Cloud Function + Admin SDK
  const cred = await createUserWithEmailAndPassword(getAuthInstance(), email, password);
  await saveUserProfile(cred.user.uid, {
    ...profileData,
    uid: cred.user.uid,
    email,
    active: true
  });
  // กลับไป user เดิม (ต้อง re-login)
  return cred.user;
}
