# V26 API contract

## Auth
`POST /api/dev/login`
- Development bootstrap only.
- Production must use OTP/password/SSO + MFA.

## Employee
`GET /api/employees`
`POST /api/employees`

Employee payload supports:
- employee_code
- name
- mobile
- address
- photo_url
- blood_group
- dob
- emergency_contact
- department
- designation
- joining_date
- previous_job_details

## Biometric
`POST /api/biometric-events`

Payload:
- device_code
- employee_code
- event_id
- event_type: IN | OUT
- captured_at

Production device gateway should authenticate each device and sign events.

## Attendance
`GET /api/attendance/today`

## Red Flags
`GET /api/red-flags`
`POST /api/red-flags`

Server authorization intentionally limits this module to OWNER and HR_ADMIN.

## Audit
`GET /api/audit-logs`

Owner-only.
