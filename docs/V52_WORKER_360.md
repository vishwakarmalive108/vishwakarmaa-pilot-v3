# V52 — Worker 360°

## Purpose
Create a single worker identity hub that connects the operational modules without duplicating the person.

## Included views
- Identity and Aadhaar verification status
- Current employment
- Employment history
- NOC records
- Attendance events and summaries
- Fatak activity
- Hamal Toli membership
- Advance ledger
- Payroll and payment history
- Attendance corrections
- Employer-sensitive red flag history

## APIs
- GET `/api/workers/:workerId/360`
- POST `/api/workers/:workerId/documents`
- POST `/api/workers/:workerId/documents/:id/verify`
- POST `/api/workers/:workerId/employment-history`
- POST `/api/workers/:workerId/noc`

## Privacy
Aadhaar numbers are represented as masked values in the profile. Red-flag data remains subject to existing role-based permissions.
