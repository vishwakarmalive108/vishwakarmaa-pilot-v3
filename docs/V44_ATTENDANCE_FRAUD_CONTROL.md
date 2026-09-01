# V44 — Manager Fraud Control + Attendance Correction

## Goal
Prevent silent attendance manipulation while still allowing legitimate corrections when a biometric/device problem occurs.

## Rules
- Attendance can be locked by Owner/Admin for a date.
- Ordinary edits are blocked after lock.
- Corrections require a reason.
- Correction requests preserve original and proposed values.
- Authorised approvers decide approve/reject.
- Approved changes are recorded as security events.
- Attempts to edit after lock are high-risk security events.
- Owner gets a security dashboard with correction counts, pending approvals and high-risk events.

## APIs
- POST `/api/attendance/lock`
- GET `/api/attendance/lock/:date`
- POST `/api/attendance/correction`
- GET `/api/attendance/corrections`
- POST `/api/attendance/corrections/:id/decision`
- GET `/api/attendance/security-dashboard`

## Production note
A production deployment should enforce database-level immutability/append-only audit storage and use authenticated identity from the actual login/session layer. V44 provides the application workflow foundation.
