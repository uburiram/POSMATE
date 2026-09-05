# POSMATE — System Architecture (Phase 1)

**Version:** 1.0.0  
**Date:** 2026-09-04  
**Target:** Small–Medium Retail POS (Mobile-First, Android Phone)

---

## 1. Overview

POSMATE is a production-ready Web Application POS system designed to run primarily on a single Android phone (Chrome / Android Browser).  
It uses pure HTML5 + CSS3 + Vanilla JavaScript (ES Modules) + Firebase to minimize dependencies and allow development/deployment from a phone.

### Core Principles
- **Mobile First** — Large touch targets, single-hand use, barcode-first workflow
- **Data Integrity** — Stock, Sales, Payments must always stay consistent
- **Security First** — No open Firebase Rules, Role-based access, Soft-delete
- **Offline-Aware** — Local queue + Idempotent sync (V1 limited but structured)
- **Multi-shop Ready** — Every document carries `shopId`

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Android Phone (Chrome)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   HTML/CSS  │  │  JS Modules │  │  IndexedDB + Cache  │  │
│  │  Mobile UI  │◄─┤  POS Logic  │◄─┤  Offline Queue      │  │
│  └─────────────┘  └──────┬──────┘  └──────────┬──────────┘  │
└──────────────────────────┼─────────────────────┼────────────┘
                           │                     │
                           ▼                     ▼
                    ┌──────────────┐      ┌─────────────┐
                    │   Firebase   │      │  Local Sync │
                    │  Auth        │      │  when Online│
                    │  Firestore   │◄─────┤             │
                    │  Storage     │      └─────────────┘
                    │  Hosting     │
                    └──────────────┘
```

### Technology Stack (Strict)
| Layer          | Technology                          | Reason |
|----------------|-------------------------------------|--------|
| Frontend       | HTML5 + CSS3 + Vanilla JS (ESM)     | No build step, easy on Android |
| UI Style       | Mobile-first, large buttons         | Single-hand + speed |
| Auth           | Firebase Authentication             | Secure, free tier friendly |
| Database       | Cloud Firestore                     | Real-time + offline persistence |
| Files          | Firebase Storage                    | Product images + logo |
| Hosting        | Firebase Hosting                    | Simple deploy |
| Barcode        | html5-qrcode (CDN)                  | Lightweight, Android camera |
| QR PromptPay   | promptpay-qr (or pure JS)           | No heavy dependency |
| Offline        | IndexedDB + Firestore offline       | Structured queue |

**Forbidden in V1:** React, Vue, Angular, heavy bundlers, unnecessary npm packages that require complex build.

---

## 3. Module Breakdown

```
POSMATE
├── Auth & Session
│   ├── Firebase Auth
│   ├── Role Claims (ADMIN / MANAGER / CASHIER)
│   └── Employee PIN Switch (fast switch without full logout)
├── Shop Settings
│   ├── Shop info, Logo, PromptPay, Receipt footer
│   └── Tax / Currency settings
├── Catalog
│   ├── Categories
│   └── Products (barcode, cost, sell, stock, minStock)
├── Inventory
│   ├── Stock In
│   ├── Stock Adjust
│   ├── Stock Movement Log (immutable history)
│   └── Low / Out of Stock alerts
├── POS Core
│   ├── Barcode Scanner (camera)
│   ├── Search
│   ├── Cart + Quantity + Discount
│   └── Real-time total calculation
├── Payment
│   ├── Cash (change calculation)
│   ├── PromptPay (QR generation + staff confirm)
│   └── Payment Status (PENDING → PAID)
├── Transaction
│   ├── Sale + SaleItems
│   ├── Receipt (INV-YYYYMMDD-XXXX)
│   ├── Cancel / Refund
│   └── Idempotent transactionId
├── Employee & Permission
│   ├── CRUD Employee
│   ├── PIN
│   └── Role-based route protection
├── Reports & Dashboard
│   ├── Today sales, cash, transfer, profit
│   ├── Top products, low stock
│   └── Sales / Stock / Employee / Profit reports
├── Shift
│   └── Close shift (expected vs counted cash)
├── Audit Log
│   └── All critical actions (immutable)
└── Offline Sync
    ├── Local pending sales
    ├── Sync on reconnect
    └── Conflict prevention via unique IDs
```

---

## 4. Critical Data Integrity Rules

1. **Sale → Stock** must be atomic (Firestore Transaction / Batch)
2. **Never hard-delete** sales, products, employees that have history (use status)
3. **Stock change** must always create an `inventoryTransactions` document
4. **Receipt number** generated via atomic counter (`counters/{shopId}`)
5. **Double-submit protection**: unique `transactionId` + button disable + processing flag
6. **PromptPay**: QR only shows amount. Status becomes PAID only after staff confirmation

---

## 5. Offline Strategy (V1)

**Supported:**
- View cached products
- Create sale while offline → store in IndexedDB as `PENDING_SYNC`
- When online → push with same `transactionId` (idempotent)

**Limitations (clearly documented):**
- Concurrent offline sales from multiple devices may cause stock race (accept in V1)
- No automatic conflict resolution for stock
- Reports may be incomplete until sync finishes

Status values for offline items:
- `LOCAL`
- `PENDING_SYNC`
- `SYNCED`
- `SYNC_ERROR`

---

## 6. Security Architecture

- Firebase Auth required for all data access
- Custom Claims: `{ role: "ADMIN"|"MANAGER"|"CASHIER", shopId: "..." }`
- Firestore Rules enforce role + shopId on every document
- Client never writes `stock` field directly
- Audit logs are append-only
- No service account keys in frontend

---

## 7. Performance Targets (Mobile)

- POS screen ready < 1.5s on mid-range Android
- Barcode scan → add to cart < 400ms (after first load)
- Checkout (online) < 2s
- Large buttons (≥ 48×48 dp), high contrast

---

## 8. Future Extension Points

- Multi-branch (already has `shopId`)
- Cloud Functions for advanced receipt numbering / payment webhooks
- Thermal printer Bluetooth (Android Intent)
- Full offline multi-device CRDT / last-write-wins with versioning

---

**Document Status:** Approved for Phase 1  
Next: Detailed Database Schema + Security Rules + File Structure
