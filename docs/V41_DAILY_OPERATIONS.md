# V41 — Daily Operations Engine

## Owner's morning problem
The system introduces a daily operational loop around the 8:10 AM attendance snapshot and 8:25 AM Fatak recruitment.

### Flow
1. Capture workforce snapshot.
2. Set today's daily-labour requirement.
3. Register each Fatak entry.
4. Verify identity using face/fingerprint/biometric or flag manual identity review.
5. Check employment conflict.
6. Apply NOC requirement when relevant.
7. Produce ALLOW/BLOCK/PENDING gate decision.
8. Record daily rate and advance.
9. Generate an alert for exceptions.

## Important product rule
The current UI does not expose a future labour marketplace. The network-ready identity architecture remains internal.

## V41 API
- `GET /api/daily-ops/today`
- `POST /api/daily-ops/requirement`
- `POST /api/daily-ops/labour-entry`
- `GET /api/daily-ops/alerts`

## Note
This is an application workflow foundation. Real biometric/face-machine SDK integration and authorised Aadhaar/KYC provider integration remain hardware/provider-dependent implementation steps.
