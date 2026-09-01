# V28 Payroll Engine

## Payroll flow

Attendance days → present/half-day/absence → approved leave → overtime → deductions → net payable.

### Current calculation
- Monthly salary is the employee's configured `salary_monthly`.
- Daily rate = monthly salary / calendar days in the payroll month.
- Half-day = 50% daily deduction.
- Uncovered absent days are deducted.
- Approved leave is excluded from absence deduction.
- OT amount = OT hours × employee OT rate.
- Net payable = monthly salary + OT amount − absence/half-day deductions.

### Controls
- Payroll starts as `DRAFT`.
- Owner can finalize it to `LOCKED`.
- Locked payroll cannot be finalized again.
- Payroll actions are audited.

### Production upgrades
The exact wage policy should be configurable per factory and aligned with applicable Indian labour/payroll requirements. Add PF, ESI, PT, TDS, advances, incentives, bonuses, salary components, weekly-off/holiday rules, rounding and statutory reports before production use.
