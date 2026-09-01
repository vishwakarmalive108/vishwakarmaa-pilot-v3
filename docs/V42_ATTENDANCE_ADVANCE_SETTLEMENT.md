# V42 — Attendance + Advance + Weekly Settlement

## Purpose
Automates the mill owner's recurring weekly calculation problem.

### Time events
IN/OUT events are stored with worker, workforce type, date, time and source. Biometric/face is the intended source; manual events remain auditable.

### Advance ledger
Every advance is a separate ledger entry. Recovery/adjustment entries can offset it. Outstanding balance is queryable per worker.

### Weekly settlement
A pay period can be created and calculated from stored time events and advance ledger. The current calculation foundation supports:
- present days
- total hours
- overtime hours
- base amount
- OT amount
- advances
- deductions
- net amount

Rates are configurable at calculation time and should be replaced with each mill's final wage/OT rules before production use.

## APIs
- POST `/api/time/in`
- POST `/api/time/out`
- POST `/api/ledger/advance`
- GET `/api/ledger/:worker_id`
- POST `/api/payroll/period`
- POST `/api/payroll/calculate/:id`
- GET `/api/payroll/:id`
