# V59 — Mobile Attendance + Gate Mode

## Goal
Allow the prototype to be operated manually from an Android phone before dedicated biometric machines are purchased.

## Methods
- Android OS biometric authentication
- Camera/face verification adapter
- Authorized manual fallback

The app does not read or store the raw fingerprint from the Android biometric sensor. Android provides a secure authentication result to the app.

## Added
- Mobile attendance device registry
- Mobile IN/OUT endpoint
- Verification method tracking
- Duplicate/invalid sequence protection
- Mobile attendance attempts log
- Today worker attendance endpoint
- Mobile mode status endpoint
- Offline queue integration through V58 sync foundation
- Mobile-first attendance screen

## Important
Camera face verification requires a real face-verification implementation/provider and consent flow. The prototype screen is ready, but it should not be represented as production-grade biometric identification until the verification component is connected and tested.
