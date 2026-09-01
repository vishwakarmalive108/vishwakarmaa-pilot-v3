# V43 — Roles, Permissions & Limitations

## Role hierarchy
Owner, Admin/HR, Manager, Supervisor, Gate Operator, Accounts and Viewer.

## Permission model
Access is determined by:
1. Role permissions
2. Individual user overrides
3. User-specific operational limits
4. Audit trail for security-sensitive changes

## Sensitive permissions
Red Flag view/manage, NOC management, payroll approval, user management, permission management and audit viewing are separately permissioned.

## Operational limits
`user_limits` stores arbitrary limit codes/values so the product can later enforce:
- maximum daily Fatak entries
- maximum advance amount
- maximum attendance edits
- approval thresholds
- report/export restrictions
- module visibility

The current API provides storage and administration for these limits; individual business-rule enforcement should be wired into each relevant action as those modules mature.

## APIs
- GET `/api/security/roles`
- POST `/api/security/users`
- GET `/api/security/users`
- POST `/api/security/users/:id/limit`
- POST `/api/security/users/:id/permission`
- GET `/api/security/users/:id/effective-access`
