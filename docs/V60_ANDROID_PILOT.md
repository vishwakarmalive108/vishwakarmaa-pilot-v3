# V60 — Android Mobile App Shell + Onboarding

## Goal
Make the prototype practical to operate from an Android phone before dedicated biometric machines are available.

## Added
- PWA manifest
- Service worker and offline shell caching
- Installable/app-like mobile shell
- Android mobile device registration endpoint
- Owner/Admin onboarding status endpoint
- Mobile-first setup checklist

## Android use
Serve the web app over HTTPS, open it in Chrome on Android, and use the browser's Add to Home screen / Install option. Native Android biometric authentication can then be invoked by a future WebAuthn/native adapter; the app must not attempt to read raw fingerprint data.

## Current manual pilot
The attendance engine supports manual IN/OUT and records the source. Phone OS biometric and camera face verification require their respective secure implementations/provider adapters.

## Production prerequisites
HTTPS, real authentication, secure secrets, production database/backups, actual face verification, Aadhaar provider, notification provider, device testing and privacy/consent controls.
