# POSMATE — Risks & Edge Cases

**Version:** 1.0.0

## Critical Edge Cases to Handle

### Sale & Stock
1. User scans same barcode multiple times → increase quantity, do not create duplicate lines
2. Stock becomes 0 while item is in cart → block increase, show warning
3. Two devices sell last item at the same time → Firestore Transaction must reject one
4. User clicks "ชำระเงิน" many times rapidly → disable button + check transactionId uniqueness
5. Page refresh during payment → recover from pending state or cancel cleanly
6. Internet drops after payment success but before stock write → offline queue must complete later

### Payment
7. PromptPay QR shown but customer never pays → staff must not confirm → status stays PENDING
8. Staff confirms PromptPay by mistake → need cancel/refund flow
9. Cash received < total → block confirmation, show "เงินไม่เพียงพอ"
10. Change calculation must be exact (no floating point errors) → use integer satang or careful rounding

### Receipt
11. Receipt number must never duplicate even under concurrent load
12. Reprint must use snapshot data, not live product prices

### Inventory
13. Adjust stock to negative → reject
14. Delete category that still has products → soft deactivate or reassign
15. Product with history cannot be hard-deleted

### Auth & Permission
16. Cashier tries to open /employees or /settings via URL → Access Denied
17. Employee PIN wrong 5 times → temporary lock (optional)
18. Admin changes role of currently logged-in user → force re-auth or clear session

### Offline
19. Sale created offline, then product price changed online → use price at time of sale (snapshot)
20. Sync fails repeatedly → mark SYNC_ERROR and allow manual retry
21. Device A and Device B both offline sell same product → stock may go negative temporarily (document as V1 limitation)

### Data Integrity
22. Never allow sale without corresponding inventoryTransaction
23. Cancel sale must reverse stock and write new inventoryTransaction of type CANCEL
24. Refund partial quantity must not exceed original sold quantity

### UX on Android
25. Camera permission denied → clear message + open search
26. Low light / blurry barcode → timeout + retry button
27. Very long product name → truncate with ellipsis on cart
28. Keyboard covers input fields → proper viewport / scroll

### Security
29. User tries to write stock field directly via console → Rules must block
30. Audit log cannot be edited or deleted by any client role

---

## Known Limitations (V1)

- Full multi-device offline conflict resolution is not guaranteed
- No automatic PromptPay payment verification (requires external Payment Gateway)
- No Bluetooth thermal printer integration yet (browser print only)
- Search is client-side filter on loaded products (for very large catalogs will need Algolia or extension later)
- Image compression is basic (recommend resize before upload)

These limitations are accepted for V1 and will be clearly stated in the README.
