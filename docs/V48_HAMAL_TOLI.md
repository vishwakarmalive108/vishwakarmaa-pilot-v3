# V48 — Hamal Toli Management

## Purpose
Manage each mill's Hamal Toli as a distinct team, normally 6–15 members, for loading, unloading and packing.

## Added
- Hamal Toli/team master
- Team leader
- Member roster (maximum 15 active members)
- Separate team attendance
- Check-in / checkout
- Job type and location
- Rate and advance capture
- Team job orders
- Daily Hamal dashboard
- Individual member records retained in workforce data

## Policy
Hamal Toli attendance is shown separately from ordinary permanent/daily labour attendance, but members continue to use their existing worker identity. This prevents duplicate worker identities and preserves the complete history.

## APIs
- POST/GET `/api/hamal/teams`
- POST `/api/hamal/teams/:id/members`
- POST `/api/hamal/attendance`
- POST `/api/hamal/attendance/:id/checkout`
- POST `/api/hamal/jobs`
- GET `/api/hamal/today/:date`
