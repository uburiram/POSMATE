/**
 * POSMATE — shared UI state
 */
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export let currentPage = 'dashboard';
export let posMode = 'cart';
export let checkoutPayload = null;
export let productScannerOpen = false;

export let loginScreen = null;
export let mainApp = null;
export let pageContent = null;
export let headerUser = null;
export let pinModal = null;

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
