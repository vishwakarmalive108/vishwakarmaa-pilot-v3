# Mannat Factory Attendance — V26 Backend Scaffold

This version adds a production-oriented backend contract and local development scaffold.

## Stack
- Node.js + Express
- SQLite for local development
- JWT authentication
- Zod-style request validation can be added at the service boundary
- REST API contracts for employees, devices, biometric events, attendance, leave, payroll, documents, red flags and audit logs

## Important
This is a backend scaffold, not a production deployment. Before production:
1. Replace SQLite with PostgreSQL.
2. Put biometric integration behind a signed device gateway/vendor SDK.
3. Use an approved Aadhaar verification provider and minimize Aadhaar data.
4. Encrypt sensitive data at rest and in transit.
5. Add rate limiting, secret management, backups, monitoring and automated tests.
6. Enforce employer-only Red Flag authorization on the server.


## V27 additions
- Shift master and employee shift assignments
- Attendance calculation engine
- First-IN / last-OUT logic
- Late and grace-period calculation
- Missing-OUT detection
- Approved-leave handling
- Overtime calculation
- Attendance recalculation endpoint
- Daily attendance summary endpoint
- Demo attendance-engine console


## V28 additions
- Payroll calculation engine
- Monthly payroll runs
- OT amount calculation
- Absence and half-day deductions
- Approved leave handling
- Payroll summary API
- Draft → Locked payroll lifecycle
- Owner-only finalization
- Payroll audit events
- Payroll demo console


## V29 additions
- Millers Association entity
- Factory ↔ Association linkage
- Special Review Committee
- Committee members
- Automatic case creation from employer red flags
- System-generated association update feed
- Committee review workflow
- Resolution statuses
- Governance and privacy guardrails
- Review Committee demo console


## V30 additions
- Permanent vs temporary employment records
- Daily/Fatak Labour registration
- Cross-mill employment check
- NOC records and date/destination validity
- Gate ALLOW/BLOCK decision
- Automatic high-severity Red Flag for permanent worker without NOC
- Automatic Review Committee routing
- Association penalty record foundation
- Daily Labour console


## V31 additions
- Miller/Factory Command Center dashboard
- Permanent vs daily labour snapshot
- Live attendance overview
- Employer Red Flag alerts
- Daily labour gate flow
- NOC quick action
- Payroll snapshot
- Association/Review Committee connection status
- Responsive dashboard demo


## V32 additions
- Biometric device registry
- Gate/device health and heartbeat
- Device type abstraction for face/fingerprint
- Live gate events endpoint
- Gate exception monitoring
- Physical gate command-center demo


## V33 additions
- Unified Employee Master Profile
- Documents and verification records
- Face/fingerprint identity registry
- Employment history timeline
- NOC and Red Flag profile view
- Audited employee activity timeline
- Role-aware sensitive-data design
- Employee profile API


## V34 additions
- Smart Employee Search API
- Cross-mill eligibility endpoint
- Minimum-necessary cross-mill visibility
- Employee search console
- Permanent/NOC/temporary status indicators
- Privacy-aware network intelligence


## V35 additions
- Salary profiles
- Payroll periods and payroll items
- Overtime calculation fields
- Employee advance tracking
- Employee loan tracking
- Payroll summary APIs
- Employee compensation API
- Payroll dashboard
- Approval/audit architecture


## V36 additions
- Factory report engine
- Attendance analytics
- Workforce mix analytics
- Daily labour analytics
- Risk/compliance analytics
- Payroll analytics
- Management report catalogue
- Reports API


## V37 additions
- Miller Association membership
- Special Review Committee
- Review case workflow
- System-generated association updates
- Association notice board
- Aggregate compliance feed
- Privacy-aware governance layer


## V38 additions
- Security events
- Role/permission architecture
- Notifications
- Biometric device registry
- Final control center
- Production integration checklist
- Privacy and least-privilege guidance

## Build status
Core application architecture: COMPLETE through V38.
External production integrations remain configuration/deployment work: biometric hardware SDK, authorised Aadhaar/KYC provider, payment/bank provider, production authentication, hosting/monitoring/backups.


V40: Hamal Toli team workforce, member records, team attendance and operations dashboard.


V41: Daily operations engine — morning workforce snapshot, Fatak requirement, verified labour entry, employment/NOC decisioning, alerts and advance capture.


V42: Time events, advance ledger, weekly pay-period calculation and settlement dashboard.


V43: Role hierarchy, granular permissions, user-specific overrides, operational limitations and security audit trail.


V44: Attendance locks, correction requests, approval workflow, security events and owner fraud-control dashboard.


V45: Worker master identity, employment history, assignments and Worker 360 record.


V46: Miller Association network, memberships, committee, notice board and cross-registered-mill worker-status check.


V47: Fatak/daily labour requirement board, network eligibility check, gate entry/checkout and daily settlement.


V48: Hamal Toli team management, roster, separate attendance, jobs, rates and advances.


V49: Advance ledger, weekly payroll periods, deductions, approvals and payment history.


V50: Owner Command Centre, factory alerts and daily dashboard snapshots.


V51: Event-based attendance, shift calculations, correction workflow and audit trail.


V52: Worker 360° identity hub linking verification, employment, NOC, attendance, Fatak, Hamal, advances, payroll and risk history.


V53: Red Flag + NOC Engine enforcing the permanent-employment conflict rule with gate decisions and association cases.


V54: Association Command Centre, Review Committee, automatic updates, notices and network governance.


V55: Role profiles, sub-user assignments, permission matrix and role-specific UX foundation.


V55.1: Per-user system language preference with English/Hindi only.


V56: Final UI/UX shell and full prototype audit. Business modules rechecked; remaining items are deployment, hardware/API integration, security/compliance and field testing.


V57: Integrated prototype hub, system health/module status endpoints, and final gap audit. Next focus is production foundation + field pilot.


V58: Production foundation for auth/session audit, device registry, offline sync and notification queues; external provider connections remain explicit integration steps.


V59: Mobile Attendance + Gate Mode for Android phone operation, with OS biometric, camera-ready verification, manual fallback, dedupe and offline queue integration.


V60: Android/PWA app shell, mobile onboarding and Android device registration foundation. Designed for manual pilot before dedicated biometric machines.


V61: Native Android wrapper + Gradle project + Codemagic debug APK workflow. Built for phone-only cloud compilation.


V62: Mobile field-pilot release. Launch hub with English/Hindi toggle, manual-first attendance, native Android phone biometric bridge, camera-ready WebView attendance, Hamal Toli, Fatak labour, payroll/advances, red-flag/NOC, and user limitations modules. Dedicated biometric machines remain a later hardware integration.
