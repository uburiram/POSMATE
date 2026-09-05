# POSMATE — Firebase Security Model

**Version:** 1.0.0  
**Project ID:** posmate-4f87b

## Core Principles

1. Never use `allow read, write: if true;`
2. Every document belongs to a `shopId`
3. Role from `users/{uid}` document (ADMIN / MANAGER / CASHIER)
4. Soft-delete only (status fields)
5. Audit logs append-only
6. Stock changed only via controlled transactions

## Roles

| Role | Access |
|------|--------|
| ADMIN | Full access, employees, settings |
| MANAGER | Products, stock, reports, cancel/refund |
| CASHIER | Sell, payment, view sales |

## Implementation

- Full rules: see `firestore.rules` and `storage.rules` in repo root
- Cashier can create `inventoryTransactions` on sale (append-only)
- Sales create: Cashier+; update (cancel/refund): Manager+
- PIN stored as SHA-256 hash
- Client validation is UX only — rules are the real gate

**Status:** Deploy `firestore.rules` + `storage.rules` to Firebase Console before production use.
