# V47 — Fatak / Daily Labour Management

## Goal
Replace the 8:10 AM / 8:25 AM manual scramble with a controlled daily labour workflow.

## Flow
1. Manager records manpower requirement and permanent present/absent counts.
2. Fatak entry identifies a daily worker.
3. Existing worker identity/employment record is checked.
4. Active permanent employment at another registered mill → NOC required and gate hold.
5. No active permanent record → temporary work eligible.
6. Work assignment, check-in, checkout and rate are recorded.
7. Advance is recorded against the entry.
8. Daily settlement calculates base + OT - advance and goes through approval.

## Explicitly excluded
The user's external/hardcore labour network is not part of V47 and is reserved for a later phase.

## APIs
- POST `/api/fatak/requirement`
- GET `/api/fatak/requirement/:date`
- POST `/api/fatak/entry`
- POST `/api/fatak/:id/checkout`
- GET `/api/fatak/today/:date`
- POST `/api/fatak/:id/settlement`
- POST `/api/fatak/settlements/:id/approve`
