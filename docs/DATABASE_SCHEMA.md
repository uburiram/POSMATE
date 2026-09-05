# POSMATE — Database Schema (Firestore)

**Version:** 1.0.0 · **Project:** posmate-4f87b

All collections are multi-shop ready via `shopId`.

## Collections

| Collection | Key fields |
|------------|------------|
| shops | name, promptPayId, promptPayName, currency, receiptPrefix |
| users | email, role, shopId, active |
| employees | code, firstName, pinHash, role, status |
| categories | name, shopId, status |
| products | barcode, name, sellPrice, costPrice, stock, minStock, status |
| sales | transactionId, receiptNo, items[], total, paymentMethod, status |
| payments | saleId, method, amount, status |
| receipts | saleId, receiptNo, content |
| inventoryTransactions | productId, type, quantity, beforeStock, afterStock |
| refunds | saleId, items[], totalRefund |
| shifts | status OPEN/CLOSED, openingCash, countedCash |
| auditLogs | action, module, targetId |
| counters | receiptSeq |

## Integrity rules

- Sale + stock cut in one Firestore Transaction
- Soft-delete via status fields
- Receipt numbers via atomic counter
- Unique transactionId for idempotent sales
