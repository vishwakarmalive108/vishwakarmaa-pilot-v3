# V50 — Owner Command Centre

## Purpose
Give the owner a single operational view of the factory without exposing employer-sensitive data to unauthorized users.

## Dashboard
- Permanent present / absent
- Daily labour and Fatak
- Hamal Toli presence
- NOC cases
- Open alerts
- Pending advances
- Pending payroll
- Open Hamal jobs
- Quick actions
- System health
- External labour network marked Phase 2

## Alert controls
Alerts have severity, status, entity linkage, creator/acknowledgement and role-based access. Owner-sensitive red flags remain protected.

## APIs
- GET `/api/dashboard/owner/:date`
- GET/POST `/api/dashboard/alerts`
- POST `/api/dashboard/alerts/:id/ack`
- POST `/api/dashboard/snapshot/:date`
