import { db } from './db.js';

function hmToMinutes(hm) {
  const [h,m] = hm.split(':').map(Number);
  return h*60+m;
}
function isoDate(d) {
  return d.toISOString().slice(0,10);
}
function localMinutes(iso) {
  const d = new Date(iso);
  return d.getHours()*60 + d.getMinutes();
}
function elapsedMinutes(startIso, endIso) {
  let a = localMinutes(startIso), b = localMinutes(endIso);
  if (b < a) b += 1440;
  return b-a;
}

export function getShiftForEmployee(employeeId, workDate) {
  return db.prepare(`
    SELECT s.* FROM employee_shift_assignments a
    JOIN shifts s ON s.id=a.shift_id
    WHERE a.employee_id=? AND a.effective_from<=?
      AND (a.effective_to IS NULL OR a.effective_to>=?)
    ORDER BY a.effective_from DESC LIMIT 1
  `).get(employeeId, workDate, workDate);
}

export function recalculateDay(factoryId, employeeId, workDate) {
  const employee = db.prepare('SELECT * FROM employees WHERE id=? AND factory_id=?').get(employeeId,factoryId);
  if (!employee) throw new Error('Employee not found');

  const shift = getShiftForEmployee(employeeId, workDate);
  const events = db.prepare(`
    SELECT * FROM biometric_events
    WHERE factory_id=? AND employee_code=? AND date(captured_at)=?
    ORDER BY captured_at
  `).all(factoryId, employee.employee_code, workDate);

  let firstIn = events.find(e=>e.event_type==='IN')?.captured_at || null;
  let outs = events.filter(e=>e.event_type==='OUT');
  let lastOut = outs.length ? outs[outs.length-1].captured_at : null;

  let status = firstIn ? 'PRESENT' : 'ABSENT';
  let worked = (firstIn && lastOut) ? elapsedMinutes(firstIn,lastOut) : 0;
  let late = 0;
  let ot = 0;
  let missingOut = firstIn && !lastOut ? 1 : 0;

  if (shift && firstIn) {
    const scheduled = hmToMinutes(shift.start_time);
    const actual = localMinutes(firstIn);
    let delta = actual - scheduled;
    if (delta < -720) delta += 1440;
    if (delta > shift.grace_minutes) late = delta;
    if (worked >= shift.ot_after_minutes) ot = worked - shift.ot_after_minutes;
  }
  if (shift && worked > 0 && worked < shift.min_full_day_minutes) status = 'HALF_DAY';
  if (late > 0) status = worked && worked >= (shift?.min_full_day_minutes || 480) ? 'LATE' : status;

  const leave = db.prepare(`
    SELECT 1 FROM leave_requests
    WHERE employee_id=? AND status='APPROVED' AND start_date<=? AND end_date>=? LIMIT 1
  `).get(employeeId,workDate,workDate);
  if (!firstIn && leave) status='LEAVE';

  db.prepare(`
    INSERT INTO attendance_days(employee_id,work_date,shift_id,first_in,last_out,status,
      worked_minutes,late_minutes,overtime_minutes,missing_out,source,calculated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(employee_id,work_date) DO UPDATE SET
      shift_id=excluded.shift_id, first_in=excluded.first_in, last_out=excluded.last_out,
      status=excluded.status, worked_minutes=excluded.worked_minutes,
      late_minutes=excluded.late_minutes, overtime_minutes=excluded.overtime_minutes,
      missing_out=excluded.missing_out, calculated_at=CURRENT_TIMESTAMP
  `).run(employeeId,workDate,shift?.id||null,firstIn,lastOut,status,worked,late,ot,missingOut,'BIOMETRIC');

  return db.prepare(`
    SELECT a.*, e.employee_code,e.name FROM attendance_days a
    JOIN employees e ON e.id=a.employee_id WHERE a.employee_id=? AND a.work_date=?
  `).get(employeeId,workDate);
}

export function processBiometricEvent(factoryId, event) {
  const emp = db.prepare('SELECT id FROM employees WHERE factory_id=? AND employee_code=? AND status=?')
    .get(factoryId,event.employee_code,'ACTIVE');
  if (!emp) return { accepted:false, reason:'EMPLOYEE_NOT_FOUND' };
  const result = recalculateDay(factoryId,emp.id,event.captured_at.slice(0,10));
  return { accepted:true, employee_id:emp.id, attendance:result };
}

export function recalculateFactoryDay(factoryId, workDate) {
  const employees = db.prepare('SELECT id FROM employees WHERE factory_id=? AND status=?').all(factoryId,'ACTIVE');
  const results = employees.map(e => recalculateDay(factoryId,e.id,workDate));
  return results;
}
