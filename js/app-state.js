/**
 * POSMATE — shared UI state & router hooks
 * ใช้ร่วมกันระหว่าง app.js และ page modules
 */
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export let currentPage = 'dashboard';
export let posMode = 'cart'; // cart | scan | search | discount
export let checkoutPayload = null;
export let productScannerOpen = false;

export let loginScreen = null;
export let mainApp = null;
export let pageContent = null;
export let headerUser = null;
export let pinModal = null;

/** ถูก bind จาก app.js หลังประกาศ navigate จริง — กัน circular import */
let _navigate = async (_page) => {};
let _renderPage = async (_page) => {};
let _updateHeader = () => {};

export function setNavigate(fn) { _navigate = fn; }
export function setRenderPage(fn) { _renderPage = fn; }
export function setUpdateHeader(fn) { _updateHeader = fn; }

export async function navigate(page) { return _navigate(page); }
export async function renderPage(page) { return _renderPage(page); }
export function updateHeader() { return _updateHeader(); }

export function bindDom() {
  loginScreen = $('#login-screen');
  mainApp = $('#main-app');
  pageContent = $('#page-content');
  headerUser = $('#header-user');
  pinModal = $('#pin-modal');
}

export function setCurrentPage(p) { currentPage = p; }
export function setPosMode(m) { posMode = m; }
export function setCheckoutPayload(v) { checkoutPayload = v; }
export function setProductScannerOpen(v) { productScannerOpen = v; }
