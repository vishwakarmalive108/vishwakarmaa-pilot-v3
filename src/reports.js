import { db } from './db.js';

export function factoryReport(factoryId, startDate, endDate) {
  const attendance = db.prepare(`
    SELECT COUNT(*) events,
      SUM(CASE WHEN event_type='IN' THEN 1 ELSE 0 END) checkins,
      SUM(CASE WHEN event_type='OUT' THEN 1 ELSE 0 END) checkouts
    FROM biometric_events
    WHERE factory_id=? AND date(event_time) BETWEEN date(?) AND date(?)
  `).get(factoryId,startDate,endDate);

  const workforce = db.prepare(`
    SELECT
      COUNT(DISTINCT e.id) employees,
      SUM(CASE WHEN er.employment_type='PERMANENT' THEN 1 ELSE 0 END) permanent,
      SUM(CASE WHEN er.employment_type='TEMPORARY' THEN 1 ELSE 0 END) temporary
    FROM employees e
    LEFT JOIN employment_records er ON er.employee_id=e.id AND er.status='ACTIVE'
    WHERE e.factory_id=?
  `).get(factoryId);

  const flags = db.prepare(`
    SELECT severity,status,COUNT(*) count
    FROM red_flags WHERE factory_id=? AND date(created_at) BETWEEN date(?) AND date(?)
    GROUP BY severity,status ORDER BY severity
  `).all(factoryId,startDate,endDate);

  const payroll = db.prepare(`
    SELECT COALESCE(SUM(pi.gross_amount),0) gross,
           COALESCE(SUM(pi.net_amount),0) net,
           COALESCE(SUM(pi.overtime_amount),0) overtime
    FROM payroll_items pi JOIN payroll_periods pp ON pp.id=pi.period_id
    WHERE pp.factory_id=? AND date(pp.period_start)>=date(?) AND date(pp.period_end)<=date(?)
  `).get(factoryId,startDate,endDate);

  const dailyLabour = db.prepare(`
    SELECT work_date,COUNT(*) total,
      SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) allowed,
      SUM(CASE WHEN status='BLOCKED' THEN 1 ELSE 0 END) blocked
    FROM labour_assignments WHERE factory_id=? AND date(work_date) BETWEEN date(?) AND date(?)
    GROUP BY work_date ORDER BY work_date
  `).all(factoryId,startDate,endDate);

  return {range:{startDate,endDate},attendance,workforce,flags,payroll,dailyLabour};
}
