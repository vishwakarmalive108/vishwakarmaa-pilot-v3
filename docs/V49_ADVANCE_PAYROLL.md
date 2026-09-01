# V49 — Advance & Payroll Engine

## Purpose
Control the weekly calculation problem: attendance, hours, rates, OT, advances, deductions, net pay, approval and payment history.

## Added
- Worker advance ledger
- Advance approval workflow
- Payroll periods
- Payroll lines
- Automatic approved-advance deduction
- Base pay + OT - deductions = net pay
- Owner/Admin payroll approval
- Payment records with mode/reference/date/user
- Paid status

## APIs
- POST/GET `/api/advances`
- POST `/api/advances/:id/approve`
- POST `/api/payroll/periods`
- POST `/api/payroll/:periodId/line`
- GET `/api/payroll/:periodId`
- POST `/api/payroll/:periodId/approve`
- POST `/api/payroll/lines/:id/pay`

## Control principle
Payroll cannot be paid until the period is approved. Advances only reduce payroll when they are approved ledger entries.
