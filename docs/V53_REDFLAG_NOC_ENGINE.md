# V53 — Red Flag + NOC Engine

## Business rule
1. Temporary labour is free to work at any registered mill on any day.
2. The system checks whether the worker has an active permanent employment record at another registered mill.
3. If no active permanent record exists: gate = ALLOW.
4. If an active permanent record exists elsewhere: protected employer red flag is created; gate = HOLD; NOC is required.
5. If an approved NOC exists for the destination mill: gate = ALLOW_WITH_NOC.
6. Association cases can separately record rule violations and penalties.

## APIs
- POST `/api/risk/employment-status`
- POST `/api/risk/check-gate`
- GET `/api/risk/redflags`
- POST `/api/risk/redflags/:id/review`
- POST `/api/risk/noc`
- POST `/api/risk/association-case`

## Privacy
Red flags are stored as employer-sensitive cases. Association cases are separate governance records.
