# V51 — Complete Attendance Engine

## Added
- Immutable-style attendance event records
- IN / OUT events
- Source tracking: biometric, face, manual
- Device and optional location metadata
- Shift definitions
- Grace-period calculation
- Late calculation
- Overtime calculation
- Daily worker summaries
- Attendance correction requests
- Owner/Admin approval or rejection
- Correction audit metadata

## Integration
The engine is designed to serve permanent employees, Fatak daily labour and Hamal Toli through the same worker identity model. The existing Fatak/Hamal records remain separate operational views.

## Important
Actual biometric/face machine hardware integration still requires the mill's device/API protocol. V51 provides the application-side event contract and audit model rather than pretending a physical device is already connected.

## APIs
- POST `/api/attendance/events`
- GET `/api/attendance/worker/:workerId/:date`
- POST/GET `/api/attendance/corrections`
- POST `/api/attendance/corrections/:id/review`
- POST/GET `/api/attendance/shifts`
- POST `/api/attendance/summary/:workerId/:date`
- GET `/api/attendance/summary/:date`
