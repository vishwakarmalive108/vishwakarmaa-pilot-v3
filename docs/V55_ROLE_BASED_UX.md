# V55 — Role-Based UX & Permissions

Adds explicit role profiles, user-role assignments and permission records for:
Owner, Admin, Manager, Supervisor, Gate Operator, Accounts, Association Admin, Association Reviewer and Viewer.

## APIs
- GET `/api/access/me`
- GET `/api/access/roles`
- POST `/api/access/assign`
- POST `/api/access/seed`
- GET `/api/access/role-matrix`

## Principle
UI navigation can now be driven by stored permissions, while server-side role middleware remains the enforcement layer. Sub-users do not inherit Owner authority.
