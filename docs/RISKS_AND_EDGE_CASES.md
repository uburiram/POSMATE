# POSMATE — Risks & Edge Cases

**Version:** 1.0.0

## Critical Edge Cases

### Sale & Stock
1. Same barcode scanned multiple times → increase quantity, no duplicate lines
2. Stock 0 while in cart → block increase, show warning
3. Two devices sell last item → Firestore Transaction rejects one
4. Rapid click ชำระเงิน → disable button + transactionId uniqueness
5. Refresh during payment → recover from pending / restart bill

### Offline
1. Multi-device offline concurrent sales → stock may conflict at sync
2. Stock cut happens at sync time (not while offline)
3. Offline receipt has no INV number until sync

### Auth
1. PIN wrong → clear error, no lockout in V1
2. Creating Auth user from client switches session (use Cloud Function later)

### Payment
1. PromptPay is manual confirm (no gateway auto-verify)
2. Cash underpay blocked in UI
