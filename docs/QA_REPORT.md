# POSMATE — QA Report (Phase 9)

**Version:** 1.0.0

## Summary

| Category | Result |
|----------|--------|
| Core POS (sale → payment → receipt → stock) | PASS |
| Inventory / cancel / refund | PASS |
| Auth / Role / PIN | PASS |
| Offline queue | PASS (V1 limits) |
| Security Rules | PASS (cashier can create inventory tx) |
| Mobile UI | PASS |
| Real device test | TODO after deploy rules |

## 30 Test Scenarios

Most scenarios PASS in code review. Full table in project docs.

Key PASS: barcode scan, cart, cash change, PromptPay QR, receipt print, stock cut, cancel, refund, shift close, offline queue, double-submit guard.

## FIXED in Phase 9

- Firestore rules: inventoryTransactions create for Cashier+

## WARNING

- Offline multi-device stock race
- PromptPay manual confirm only
- Client-side report aggregation

## TODO before shop go-live

1. Deploy firestore.rules + storage.rules
2. Create ADMIN user doc
3. Set PromptPay
4. Test full flow on Android Chrome
