# V30 Workforce Rules

## Employment classes
- PERMANENT: active employment at a registered mill.
- TEMPORARY/FATAK: daily labour engagement.
- A worker may be a temporary worker without restriction when there is no active permanent record in the participating network.

## Gate rule
When a temporary labourer presents for work:
1. Identify the worker using the biometric/face identity.
2. Search registered mills for an active permanent employment record for that work date.
3. If none exists: ALLOW.
4. If one exists: check for a valid NOC from the permanent employer, optionally restricted to the destination mill and date range.
5. Valid NOC: ALLOW and audit.
6. No valid NOC: BLOCK temporary assignment and generate a HIGH Red Flag.
7. Route the Red Flag to the association-linked Review Committee.

## Important
A cross-mill signal is not itself proof of misconduct. The platform should record the policy event and evidence, while authorised reviewers decide the final outcome.

## Association penalty
Penalty records are separate from detection. A penalty should only be proposed/confirmed after the association's defined review process confirms a policy violation.
