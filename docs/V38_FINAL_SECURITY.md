# V38 Final Security, Permissions & Integration Readiness

## Added
- Role-based access architecture
- Notifications
- Security event logging
- Device registry
- Final control-center dashboard
- Integrated module status
- Production checklist

## Access model
Owner: full factory administration.
HR Admin: employee, attendance and payroll operations.
Supervisor: attendance and gate operations.
Association: review cases and aggregate compliance.

## Sensitive information
Aadhaar, addresses, salary, biometric references/templates and private documents must remain protected by least-privilege access. Cross-mill search exposes only operational eligibility information.

## Important implementation boundary
The project is application-ready architecture, not a claim that a physical biometric machine, Aadhaar verification provider, bank/payment provider or production identity provider is already connected. Those require exact vendor APIs/SDKs, credentials, legal/compliance configuration and device testing.

## Launch hardening
Before production:
1. Configure secure authentication and session management.
2. Enable database encryption/backup and secret management.
3. Add rate limits, input validation, CSRF protections where applicable and security headers.
4. Validate all role permissions with automated tests.
5. Integrate the selected biometric hardware SDK/protocol.
6. Use an authorised Aadhaar/KYC provider with appropriate consent/legal basis.
7. Configure notifications and monitoring.
8. Run UAT with multiple mills and association reviewers.
9. Formalise association rules, NOC policy and penalty governance.
