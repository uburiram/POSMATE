# POSMATE — Permission Matrix

**Version:** 1.0.0

| Module / Action | ADMIN | MANAGER | CASHIER |
|-----------------|-------|---------|--------|
| Login / PIN switch / Logout | ✓ | ✓ | ✓ |
| Dashboard full | ✓ | ✓ | Limited |
| POS sale / scan / cart / checkout | ✓ | ✓ | ✓ |
| Sales history view | ✓ | ✓ | Own |
| Cancel / Refund | ✓ | ✓ | ✗ |
| Products create/edit | ✓ | ✓ | ✗ |
| Stock in / adjust | ✓ | ✓ | ✗ |
| Employees manage | ✓ | ✗ | ✗ |
| Reports full | ✓ | ✓ | Limited |
| Shift open/close | ✓ | ✓ | ✓ |
| Shop settings | ✓ | Limited | ✗ |
| Audit log | ✓ | ✓ | ✗ |

Route: `/pos` CASHIER+ · `/products` MANAGER+ · `/employees` ADMIN · `/reports` MANAGER+
