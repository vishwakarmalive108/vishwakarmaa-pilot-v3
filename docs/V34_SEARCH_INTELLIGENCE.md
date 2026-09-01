# V34 Smart Employee Search & Workforce Intelligence

## Search inputs
- Name
- Employee code
- Mobile
- Biometric reference

## Search result policy
Own-factory employees: permitted profile access according to role.
Cross-factory identities: minimum necessary information only.

## Cross-mill eligibility
The search engine connects to the same gate decision rule:
- No active permanent employment record → temporary work eligible.
- Active permanent record + valid NOC → temporary work eligible for the NOC scope/date.
- Active permanent record + no valid NOC → temporary assignment blocked and Red Flag workflow triggered at the destination.

## Privacy
The system deliberately does not expose full address, Aadhaar number, salary, document files, biometric templates or other sensitive information to another mill.

## Auditability
Search and eligibility decisions should be logged in production. A Red Flag represents a policy event for authorised review; it is not by itself a final finding of misconduct.
