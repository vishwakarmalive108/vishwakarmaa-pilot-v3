# V46 — Miller Association Network + Intelligence

## Added
- Miller Association records
- Factory membership
- Special Review Committee roster
- Association Notice Board
- System-generated notice capability
- Network worker-status check

## Worker check logic
- Active permanent record at another registered mill → `PERMANENT_ELSEWHERE`, NOC required.
- Active permanent record at requesting mill → `PERMANENT_HERE`.
- No active permanent record in the registered network → `FREE_TO_WORK`.

This implements the stated policy: ordinary temporary labour remains free to work at any registered factory unless the network has an active permanent employment record.

## Privacy principle
The association layer should expose status/signals rather than unrestricted employer HR records. Employer-sensitive details remain controlled by role and governance.

## APIs
- GET/POST `/api/association`
- POST `/api/association/:id/member`
- GET/POST `/api/association/:id/committee`
- POST `/api/association/:id/notice`
- GET `/api/network/worker-check/:workerId`

## Production note
The final deployment needs authenticated factory identity, explicit association governance, consent/legal review for cross-employer worker-status processing, and a secure identity/KYC provider.
