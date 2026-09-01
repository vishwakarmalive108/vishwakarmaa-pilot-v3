import { db } from './db.js';

function daysInMonth(period) {
  const [y,m] = period.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function approvedLeaveDays(employeeId, period) {
  const [y,m] = period.split('-').map(Number);
  const start = `${period}-01`;
  const end = `${period}-${String(daysInMonth(period)).padStart(2,'0')}`;
  const rows = db.prepare(`
    SELECT start_date,end_date FROM leave_requests
    WHERE employee_id=? AND status='APPROVED'
      AND start_date<=? AND end_date>=?
  `).all(employeeId,end,start);
  let total=0;
  for (const r of rows) {
    const a=new Date(Math.max(new Date(r.start_date),new Date(start)));
    const b=new Date(Math.min(new Date(r.end_date),new Date(end)));
    total += Math.floor((b-a)/86400000)+1;
  }
  return total;
}

export function calculatePayroll(factoryId, period) {
  const employees=db.prepare(`
    SELECT * FROM employees WHERE factory_id=? AND status='ACTIVE'
  `).all(factoryId);

  const existing=db.prepare('SELECT * FROM payroll_runs WHERE factory_id=? AND period=?')
    .get(factoryId,period);
  const runId=existing?.id || db.prepare(
    `INSERT INTO payroll_runs(factory_id,period,status) VALUES(?,?,?)`
  ).run(factoryId,period,'DRAFT').lastInsertRowid;

  const days=daysInMonth(period);
  const results=[];

  const insert=db.prepare(`
    INSERT INTO payroll_items(payroll_run_id,employee_id,basic_salary,ot_minutes,ot_amount,leave_deduction,net_amount)
    VALUES(?,?,?,?,?,?,?)
  `);
  const clear=db.prepare('DELETE FROM payroll_items WHERE payroll_run_id=?');
  clear.run(runId);

  const tx=db.transaction(()=>{
    for(const e of employees){
      const attendance=db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('PRESENT','LATE') THEN 1 ELSE 0 END),0) present_days,
          COALESCE(SUM(CASE WHEN status='HALF_DAY' THEN 1 ELSE 0 END),0) half_days,
          COALESCE(SUM(overtime_minutes),0) ot_minutes
        FROM attendance_days
        WHERE employee_id=? AND work_date LIKE ?
      `).get(e.id,`${period}%`);

      const leaveDays=approvedLeaveDays(e.id,period);
      const monthly=Number(e.salary_monthly||0);
      const daily=days ? monthly/days : 0;
      const halfDeduction=daily*0.5*Number(attendance.half_days||0);
      const paidPresent=Number(attendance.present_days||0);
      const absentDays=Math.max(0,days-paidPresent-Number(attendance.half_days||0)-leaveDays);
      const leaveDeduction=Math.max(0,daily*absentDays)+halfDeduction;
      const otMinutes=Number(attendance.ot_minutes||0);
      const otAmount=(otMinutes/60)*Number(e.ot_rate||0);
      const net=Math.max(0,monthly+otAmount-leaveDeduction);

      const r=insert.run(runId,e.id,monthly,otMinutes,otAmount,leaveDeduction,net);
      results.push({
        employee_id:e.id, employee_code:e.employee_code, name:e.name,
        basic_salary:monthly, present_days:paidPresent,
        half_days:Number(attendance.half_days||0), leave_days:leaveDays,
        absent_days:absentDays, ot_minutes:otMinutes, ot_amount:otAmount,
        leave_deduction:leaveDeduction, net_amount:net, item_id:r.lastInsertRowid
      });
    }
  });
  tx();

  return { payroll_run_id:Number(runId), period, days, status:'DRAFT', results };
}

export function finalizePayroll(factoryId, period) {
  const run=db.prepare('SELECT * FROM payroll_runs WHERE factory_id=? AND period=?').get(factoryId,period);
  if(!run) throw new Error('Payroll run not found');
  if(run.status==='LOCKED') throw new Error('Payroll already locked');
  db.prepare('UPDATE payroll_runs SET status=? WHERE id=?').run('LOCKED',run.id);
  return db.prepare('SELECT * FROM payroll_runs WHERE id=?').get(run.id);
}
