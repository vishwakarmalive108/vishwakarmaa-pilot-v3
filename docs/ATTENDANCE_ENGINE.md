# V27 Attendance Engine

## Rules
1. Biometric `IN`/`OUT` events are stored as an immutable event ledger.
2. First IN and last OUT become the day's attendance boundaries.
3. Employee shift assignment supplies scheduled start/end and grace period.
4. Late minutes = arrival after scheduled start + grace.
5. Worked minutes are calculated between first IN and last OUT, supporting overnight shifts.
6. Missing OUT is explicitly flagged when an IN exists without an OUT.
7. Approved leave can produce `LEAVE` when no biometric IN exists.
8. OT begins after the configured shift `ot_after_minutes`.
9. A day below `min_full_day_minutes` becomes `HALF_DAY` when there is a punch.
10. Attendance is recalculated whenever a biometric event arrives and can be batch-recalculated for a date.

## Important production rule
Attendance should be deterministic and explainable. Every adjustment made manually should create an audit log entry with the actor, reason and before/after values.
