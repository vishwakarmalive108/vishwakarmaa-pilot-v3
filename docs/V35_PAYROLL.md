# V35 Payroll & Compensation

## Modules
- Salary profiles: monthly, daily, hourly
- Payroll periods
- Payroll items
- Overtime
- Employee advances
- Employee loans
- Deductions
- Daily labour payment
- Approval / paid status

## Calculation architecture
Approved attendance → payable days/hours → overtime → gross → advance/loan/other deductions → net pay → owner approval → payment status.

## Controls
Payroll access is restricted to authorised owner/HR roles. Manual adjustments should be audited. Payment status is a record of processing, not proof of bank settlement unless a payment integration is later connected.

## Next production integration
Attendance calculations, holiday/shift rules, statutory deductions and payment provider/bank integration should be configured for the mill's jurisdiction and payroll policy.
