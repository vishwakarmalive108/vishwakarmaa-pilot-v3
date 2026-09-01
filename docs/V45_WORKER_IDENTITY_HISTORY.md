# V45 — Worker Identity & Employment History

## Purpose
Create a durable worker master record that can connect identity, employment, assignments and operational records.

## Added
- Worker identity profile
- Masked ID reference fields
- Aadhaar verification status
- Face and fingerprint enrollment status
- Employment history across registered factories
- Permanent/temporary employment type
- NOC status
- Current assignments
- Worker 360 endpoint joining identity, employment, assignments, time, advances and labour alerts

## APIs
- POST `/api/workers/:id/identity`
- GET `/api/workers/:id/identity`
- POST `/api/workers/:id/employment-history`
- GET `/api/workers/:id/employment-history`
- POST `/api/workers/:id/assignment`
- GET `/api/workers/:id/360`

## Privacy/security note
The application stores verification status and masked ID references in this foundation; it should not store raw Aadhaar numbers. Production Aadhaar verification must use an authorised KYC/identity provider and applicable consent/security controls.
