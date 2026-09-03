// src/firebase/auth.js
// จัดการ: Login (Firebase Auth), โหลด Role ของ user,
// Route guard ตาม role, และ PIN-switch employee (ไม่ต้อง logout Firebase ทุกครั้ง)

import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./init.js";
import { DEFAULT_SHOP_ID } from "./config.js";

// ---- Session state (in-memory, ไม่เก็บใน localStorage เพราะมี Firestore
// persistence จัดการ Firebase session อยู่แล้ว, ส่วน active-employee เก็บใน
// sessionStorage เพื่อให้หายไปเมื่อปิดแอป/รีสตาร์ทเบราว์เซอร์ ลดความเสี่ยง
// การค้าง session ของพนักงานคนก่อนหน้า) ----

let currentUserRole = null; // ADMIN | MANAGER | CASHIER — บัญชี Firebase หลัก (device owner)
let activeEmployee = null; // พนักงานที่กำลัง "สวมสิทธิ์" อยู่ ณ ขณะนี้ (หลังใส่ PIN)

/**
 * Login ด้วย Firebase Authentication (email/password)
 * ใช้สำหรับ "เจ้าของอุปกรณ์" / บัญชีหลักของร้าน ไม่ใช่ทุกครั้งที่พนักงานสลับกันขาย
 * (การสลับพนักงานรายวันใช้ PIN ผ่าน switchEmployeeByPin แทน)
 */
export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await loadUserRole(cred.user.uid);
  return cred.user;
}

export async function logout() {
  activeEmployee = null;
  sessionStorage.removeItem("posmate_active_employee");
  await firebaseSignOut(auth);
  currentUserRole = null;
}

/**
 * โหลด role ของบัญชี Firebase หลักจาก shops/{shopId}/users/{uid}
 * เอกสารนี้เป็น "แหล่งความจริง" เดียวสำหรับ role — ห้าม client เชื่อ role
 * จาก field อื่นใดที่แก้ไขได้ง่ายกว่านี้
 */
export async function loadUserRole(uid) {
  const userRef = doc(db, "shops", DEFAULT_SHOP_ID, "users", uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    throw new Error("บัญชีนี้ยังไม่ได้ผูกกับร้านค้า กรุณาติดต่อผู้ดูแลระบบ");
  }
  const data = snap.data();
  if (data.status !== "ACTIVE") {
    throw new Error("บัญชีนี้ถูกระงับการใช้งาน");
  }
  currentUserRole = data.role;
  return { role: data.role, employeeId: data.employeeId };
}

export function getCurrentRole() {
  return currentUserRole;
}

/**
 * PIN-switch: พนักงานเลือกชื่อตัวเอง + ใส่ PIN เพื่อ "สวมสิทธิ์" บนอุปกรณ์
 * ที่ล็อกอินด้วยบัญชีหลักของร้านอยู่แล้ว ไม่ต้อง sign out จาก Firebase
 * ป้องกันคนอื่นใช้สิทธิ์: pinHash ตรวจสอบฝั่ง Cloud Function (verifyEmployeePin)
 * ไม่เทียบ PIN ตรงๆ ฝั่ง client เพื่อไม่ให้ pinHash รั่วผ่าน Firestore read
 */
export async function switchEmployeeByPin(employeeId, pin) {
  const { verifyEmployeePin } = await import("./functions.js");
  const result = await verifyEmployeePin({ employeeId, pin });
  if (!result.valid) {
    throw new Error("PIN ไม่ถูกต้อง");
  }
  activeEmployee = {
    employeeId: result.employeeId,
    name: result.name,
    role: result.role, // role ของพนักงานคนนี้ อาจต่างจาก currentUserRole ของบัญชีหลัก
  };
  sessionStorage.setItem(
    "posmate_active_employee",
    JSON.stringify(activeEmployee)
  );
  return activeEmployee;
}

export function getActiveEmployee() {
  if (activeEmployee) return activeEmployee;
  const cached = sessionStorage.getItem("posmate_active_employee");
  if (cached) {
    activeEmployee = JSON.parse(cached);
  }
  return activeEmployee;
}

export function clearActiveEmployee() {
  activeEmployee = null;
  sessionStorage.removeItem("posmate_active_employee");
}

/**
 * Route Guard — เรียกก่อน render หน้าที่ต้องจำกัดสิทธิ์
 * คืนค่า true = ผ่าน, false = Access Denied
 */
const ROUTE_PERMISSIONS = {
  dashboard: ["ADMIN", "MANAGER"],
  reports: ["ADMIN", "MANAGER"],
  products: ["ADMIN", "MANAGER"],
  inventory: ["ADMIN", "MANAGER"],
  employees: ["ADMIN"],
  settings: ["ADMIN"],
  auditLog: ["ADMIN"],
  pos: ["ADMIN", "MANAGER", "CASHIER"],
  history: ["ADMIN", "MANAGER", "CASHIER"],
};

export function canAccessRoute(routeName) {
  const emp = getActiveEmployee();
  const role = emp ? emp.role : currentUserRole;
  const allowed = ROUTE_PERMISSIONS[routeName];
  if (!allowed) return true; // route ไม่ผูกสิทธิ์ (เช่นหน้า login)
  return !!role && allowed.includes(role);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        const { role } = await loadUserRole(user.uid);
        callback({ user, role });
      } catch (err) {
        console.error(err);
        callback({ user: null, role: null, error: err.message });
      }
    } else {
      currentUserRole = null;
      callback({ user: null, role: null });
    }
  });
}
