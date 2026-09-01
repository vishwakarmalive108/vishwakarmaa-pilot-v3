import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { auth, roles, signUser } from './auth.js';
import { audit } from './audit.js';
import { processBiometricEvent, recalculateFactoryDay } from './attendanceEngine.js';
import { calculatePayroll, finalizePayroll } from './payrollEngine.js';
import { committeeForFactory, createCommitteeCase, reviewCase } from './reviewCommittee.js';
import { evaluateTemporaryEntry, createCrossMillFlag } from './workforceRules.js';
import { listDevices, heartbeat, deviceHealth } from './deviceManager.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'mannat-attendance-api' }));

app.post('/api/dev/login', (req, res) => {
  const { mobile, role = 'OWNER', name = 'Demo User' } = req.body;
  let user = db.prepare('SELECT * FROM users WHERE mobile=?').get(mobile || '9999999999');
  if (!user) {
    let factory = db.prepare('SELECT * FROM factories LIMIT 1').get();
    if (!factory) {
      const r = db.prepare('INSERT INTO factories(name, city) VALUES (?, ?)').run('Mannat Industries', 'Bhatapara');
      factory = { id: r.lastInsertRowid, name: 'Mannat Industries', city: 'Bhatapara' };
    }
    const r = db.prepare('INSERT INTO users(factory_id,name,mobile,role) VALUES (?,?,?,?)')
      .run(factory.id, name, mobile || '9999999999', role);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
  }
  res.json({ token: signUser(user), user });
});

app.use('/api', auth);

app.get('/api/me', (req, res) => res.json({ user: req.user }));

app.get('/api/employees', (req, res) => {
  const rows = db.prepare('SELECT * FROM employees WHERE factory_id=? ORDER BY id DESC').all(req.user.factory_id);
  res.json(rows);
});

app.post('/api/employees', roles('OWNER','HR_ADMIN'), (req, res) => {
  const x = req.body;
  if (!x.employee_code || !x.name) return res.status(400).json({ error: 'employee_code and name are required' });
  const r = db.prepare(`
    INSERT INTO employees(factory_id,employee_code,name,mobile,address,photo_url,blood_group,dob,
      emergency_contact,department,designation,joining_date,previous_job_details)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(req.user.factory_id,x.employee_code,x.name,x.mobile||null,x.address||null,x.photo_url||null,
    x.blood_group||null,x.dob||null,x.emergency_contact||null,x.department||null,x.designation||null,
    x.joining_date||null,x.previous_job_details||null);
  audit(req,'CREATE','employee',String(r.lastInsertRowid));
  res.status(201).json(db.prepare('SELECT * FROM employees WHERE id=?').get(r.lastInsertRowid));
});

app.post('/api/biometric-events', roles('OWNER','HR_ADMIN','DEVICE_OPERATOR'), (req, res) => {
  const { device_code, employee_code, event_id, event_type, captured_at } = req.body;
  if (!device_code || !employee_code || !event_id || !event_type || !captured_at)
    return res.status(400).json({ error: 'device_code, employee_code, event_id, event_type and captured_at are required' });

  try {
    const r = db.prepare(`
      INSERT INTO biometric_events(factory_id,device_code,employee_code,event_id,event_type,captured_at)
      VALUES (?,?,?,?,?,?)
    `).run(req.user.factory_id,device_code,employee_code,event_id,event_type,captured_at);
    const attendance = processBiometricEvent(req.user.factory_id, {device_code,employee_code,event_id,event_type,captured_at});
    audit(req,'INGEST','biometric_event',String(r.lastInsertRowid),{device_code,employee_code,event_type});
    res.status(201).json({ accepted:true, id:r.lastInsertRowid, attendance });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error:'Duplicate event_id' });
    res.status(400).json({ error:e.message });
  }
});

app.get('/api/attendance/today', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  const rows = db.prepare(`
    SELECT e.employee_code,e.name,e.department,a.work_date,a.first_in,a.last_out,a.status,a.late_minutes,a.overtime_minutes
    FROM employees e LEFT JOIN attendance_days a ON a.employee_id=e.id AND a.work_date=date('now')
    WHERE e.factory_id=? AND e.status='ACTIVE' ORDER BY e.name
  `).all(req.user.factory_id);
  res.json(rows);
});

app.get('/api/red-flags', roles('OWNER','HR_ADMIN'), (req,res) => {
  const rows = db.prepare(`
    SELECT r.*, e.employee_code, e.name
    FROM red_flags r LEFT JOIN employees e ON e.id=r.employee_id
    WHERE r.factory_id=? ORDER BY r.created_at DESC
  `).all(req.user.factory_id);
  audit(req,'VIEW','red_flags');
  res.json(rows);
});

app.post('/api/red-flags', roles('OWNER','HR_ADMIN'), (req,res) => {
  const x=req.body;
  if (!x.category || !x.severity || !x.summary)
    return res.status(400).json({error:'category, severity and summary are required'});
  const r=db.prepare(`
    INSERT INTO red_flags(factory_id,employee_id,category,severity,summary,evidence,created_by)
    VALUES (?,?,?,?,?,?,?)
  `).run(req.user.factory_id,x.employee_id||null,x.category,x.severity,x.summary,x.evidence||null,req.user.sub);
  const committeeCase=createCommitteeCase(req.user.factory_id,Number(r.lastInsertRowid));
  audit(req,'CREATE','red_flag',String(r.lastInsertRowid),{category:x.category,severity:x.severity,committee_case_id:committeeCase?.id||null});
  res.status(201).json({
    red_flag:db.prepare('SELECT * FROM red_flags WHERE id=?').get(r.lastInsertRowid),
    committee_case:committeeCase
  });
});

app.get('/api/audit-logs', roles('OWNER'), (req,res) => {
  res.json(db.prepare('SELECT * FROM audit_logs WHERE factory_id=? ORDER BY id DESC LIMIT 200').all(req.user.factory_id));
});


app.post('/api/shifts', roles('OWNER','HR_ADMIN'), (req,res) => {
  const { name,start_time,end_time,grace_minutes=10,min_full_day_minutes=480,ot_after_minutes=480 }=req.body;
  if(!name||!start_time||!end_time) return res.status(400).json({error:'name,start_time,end_time required'});
  const r=db.prepare(`INSERT INTO shifts(factory_id,name,start_time,end_time,grace_minutes,min_full_day_minutes,ot_after_minutes)
    VALUES(?,?,?,?,?,?,?)`).run(req.user.factory_id,name,start_time,end_time,grace_minutes,min_full_day_minutes,ot_after_minutes);
  audit(req,'CREATE','shift',String(r.lastInsertRowid));
  res.status(201).json(db.prepare('SELECT * FROM shifts WHERE id=?').get(r.lastInsertRowid));
});

app.post('/api/employees/:employeeId/shift', roles('OWNER','HR_ADMIN'), (req,res) => {
  const employeeId=Number(req.params.employeeId), {shift_id,effective_from,effective_to=null}=req.body;
  const employee=db.prepare('SELECT id FROM employees WHERE id=? AND factory_id=?').get(employeeId,req.user.factory_id);
  if(!employee) return res.status(404).json({error:'Employee not found'});
  db.prepare(`INSERT INTO employee_shift_assignments(employee_id,shift_id,effective_from,effective_to)
    VALUES(?,?,?,?)`).run(employeeId,shift_id,effective_from,effective_to);
  audit(req,'ASSIGN','employee_shift',String(employeeId),{shift_id});
  res.json({ok:true});
});

app.post('/api/attendance/recalculate', roles('OWNER','HR_ADMIN'), (req,res) => {
  const {work_date}=req.body;
  if(!work_date) return res.status(400).json({error:'work_date required'});
  const results=recalculateFactoryDay(req.user.factory_id,work_date);
  audit(req,'RECALCULATE','attendance',work_date,{count:results.length});
  res.json({work_date,count:results.length,results});
});

app.get('/api/attendance/:date', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  const rows=db.prepare(`
    SELECT a.*,e.employee_code,e.name,d.name AS department
    FROM attendance_days a JOIN employees e ON e.id=a.employee_id
    LEFT JOIN departments d ON d.id=e.department_id
    WHERE e.factory_id=? AND a.work_date=? ORDER BY e.name
  `).all(req.user.factory_id,req.params.date);
  res.json(rows);
});

app.get('/api/attendance/summary/:date', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  const rows=db.prepare(`
    SELECT status,COUNT(*) count,SUM(worked_minutes) worked_minutes,SUM(overtime_minutes) overtime_minutes,
           SUM(late_minutes) late_minutes,SUM(missing_out) missing_out
    FROM attendance_days a JOIN employees e ON e.id=a.employee_id
    WHERE e.factory_id=? AND a.work_date=? GROUP BY status
  `).all(req.user.factory_id,req.params.date);
  res.json({work_date:req.params.date,breakdown:rows});
});


app.post('/api/payroll/calculate', roles('OWNER','HR_ADMIN'), (req,res) => {
  const {period}=req.body;
  if(!/^\d{4}-\d{2}$/.test(period||'')) return res.status(400).json({error:'period must be YYYY-MM'});
  try {
    const result=calculatePayroll(req.user.factory_id,period);
    audit(req,'CALCULATE','payroll_run',String(result.payroll_run_id),{period});
    res.json(result);
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.get('/api/payroll/:period', roles('OWNER','HR_ADMIN'), (req,res) => {
  const run=db.prepare('SELECT * FROM payroll_runs WHERE factory_id=? AND period=?')
    .get(req.user.factory_id,req.params.period);
  if(!run) return res.status(404).json({error:'Payroll run not found'});
  const items=db.prepare(`
    SELECT p.*,e.employee_code,e.name,e.department
    FROM payroll_items p JOIN employees e ON e.id=p.employee_id
    WHERE p.payroll_run_id=? ORDER BY e.name
  `).all(run.id);
  res.json({run,items});
});

app.post('/api/payroll/:period/finalize', roles('OWNER'), (req,res) => {
  try {
    const run=finalizePayroll(req.user.factory_id,req.params.period);
    audit(req,'LOCK','payroll_run',String(run.id),{period:req.params.period});
    res.json(run);
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.get('/api/payroll/:period/summary', roles('OWNER','HR_ADMIN'), (req,res) => {
  const run=db.prepare('SELECT * FROM payroll_runs WHERE factory_id=? AND period=?')
    .get(req.user.factory_id,req.params.period);
  if(!run) return res.status(404).json({error:'Payroll run not found'});
  const s=db.prepare(`
    SELECT COUNT(*) employees,
      COALESCE(SUM(basic_salary),0) gross_basic,
      COALESCE(SUM(ot_amount),0) total_ot,
      COALESCE(SUM(leave_deduction),0) total_deductions,
      COALESCE(SUM(net_amount),0) net_payable
    FROM payroll_items WHERE payroll_run_id=?
  `).get(run.id);
  res.json({period:req.params.period,status:run.status,...s});
});


app.get('/api/committee', roles('OWNER','HR_ADMIN'), (req,res) => {
  const c=committeeForFactory(req.user.factory_id);
  if(!c) return res.status(404).json({error:'No active association committee linked to this factory'});
  const cases=db.prepare(`
    SELECT cc.*,r.category,r.employee_id
    FROM committee_cases cc JOIN red_flags r ON r.id=cc.red_flag_id
    WHERE cc.committee_id=? ORDER BY cc.created_at DESC
  `).all(c.id);
  res.json({committee:c,cases});
});

app.get('/api/association/updates', roles('OWNER','HR_ADMIN'), (req,res) => {
  const c=committeeForFactory(req.user.factory_id);
  if(!c) return res.status(404).json({error:'No active association committee'});
  const updates=db.prepare(`
    SELECT * FROM association_updates
    WHERE association_id=? ORDER BY created_at DESC LIMIT 100
  `).all(c.association_id);
  res.json(updates);
});

app.post('/api/committee/cases/:caseId/review', roles('OWNER','HR_ADMIN'), (req,res) => {
  const c=committeeForFactory(req.user.factory_id);
  if(!c) return res.status(404).json({error:'No active committee'});
  const row=db.prepare(`
    SELECT cc.* FROM committee_cases cc
    WHERE cc.id=? AND cc.committee_id=?
  `).get(Number(req.params.caseId),c.id);
  if(!row) return res.status(404).json({error:'Committee case not found'});
  const result=reviewCase(row.id,req.body.status,req.body.note,req.body.resolution||null);
  audit(req,'REVIEW','committee_case',String(row.id),{status:req.body.status});
  res.json(result);
});


app.post('/api/daily-labour/register', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  const {employee_code,name,mobile,address,photo_url,blood_group,work_date,labour_type='FATAK'}=req.body;
  if(!employee_code||!name||!work_date) return res.status(400).json({error:'employee_code,name,work_date required'});
  const existing=db.prepare('SELECT * FROM employees WHERE factory_id=? AND employee_code=?')
    .get(req.user.factory_id,employee_code);
  const employee=existing || (() => {
    const r=db.prepare(`INSERT INTO employees(factory_id,employee_code,name,mobile,address,photo_url,blood_group,status)
      VALUES(?,?,?,?,?,?,?,?)`).run(req.user.factory_id,employee_code,name,mobile||null,address||null,photo_url||null,blood_group||null,'ACTIVE');
    return db.prepare('SELECT * FROM employees WHERE id=?').get(r.lastInsertRowid);
  })();
  db.prepare(`INSERT OR IGNORE INTO temporary_labour_profiles(employee_id,labour_type) VALUES(?,?)`)
    .run(employee.id,labour_type);
  const check=evaluateTemporaryEntry({employeeId:employee.id,destinationFactoryId:req.user.factory_id,workDate:work_date});
  const assignment=db.prepare(`INSERT INTO labour_assignments(employee_id,factory_id,work_date,assignment_type,status)
    VALUES(?,?,?,?,?)`).run(employee.id,req.user.factory_id,work_date,'TEMPORARY',check.allowed?'ACTIVE':'BLOCKED');
  let flagId=null, committeeCase=null;
  if(check.flag){
    flagId=createCrossMillFlag(req.user.factory_id,employee.id,
      `Temporary labour entry blocked: worker has an active permanent employment record at ${check.permanent_factory_name} and no valid NOC.`,
      JSON.stringify({work_date,permanent_factory_id:check.permanent_factory_id,employee_code}));
    committeeCase=createCommitteeCase(req.user.factory_id,flagId);
  }
  audit(req,'REGISTER','daily_labour',String(assignment.lastInsertRowid),{employee_id:employee.id,allowed:check.allowed,flag_id:flagId});
  res.status(check.allowed?201:409).json({employee,decision:check,assignment_id:assignment.lastInsertRowid,red_flag_id:flagId,committee_case:committeeCase});
});

app.get('/api/daily-labour/check/:employeeId/:date', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  const check=evaluateTemporaryEntry({employeeId:Number(req.params.employeeId),destinationFactoryId:req.user.factory_id,workDate:req.params.date});
  res.json(check);
});

app.post('/api/noc', roles('OWNER','HR_ADMIN'), (req,res) => {
  const {employee_id,destination_factory_id=null,valid_from,valid_to,reference}=req.body;
  const emp=db.prepare('SELECT * FROM employees WHERE id=? AND factory_id=?').get(employee_id,req.user.factory_id);
  if(!emp) return res.status(404).json({error:'Employee not found in issuing factory'});
  const r=db.prepare(`INSERT INTO noc_records(employee_id,issuing_factory_id,destination_factory_id,valid_from,valid_to,reference)
    VALUES(?,?,?,?,?,?)`).run(employee_id,req.user.factory_id,destination_factory_id,valid_from,valid_to,reference||null);
  audit(req,'CREATE','noc',String(r.lastInsertRowid),{employee_id,destination_factory_id});
  res.status(201).json(db.prepare('SELECT * FROM noc_records WHERE id=?').get(r.lastInsertRowid));
});

app.get('/api/daily-labour/today', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  const date=req.query.date || new Date().toISOString().slice(0,10);
  const rows=db.prepare(`
    SELECT la.*,e.employee_code,e.name,e.mobile,e.photo_url
    FROM labour_assignments la JOIN employees e ON e.id=la.employee_id
    WHERE la.factory_id=? AND la.work_date=? ORDER BY la.id DESC
  `).all(req.user.factory_id,date);
  res.json(rows);
});


app.get('/api/devices', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  res.json(deviceHealth(req.user.factory_id));
});

app.post('/api/devices/:deviceId/heartbeat', (req,res) => {
  try {
    const result=heartbeat(req.user.factory_id,Number(req.params.deviceId),req.body||{});
    res.json(result);
  } catch(e) { res.status(404).json({error:e.message}); }
});

app.get('/api/gates/live', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  const devices=deviceHealth(req.user.factory_id);
  const events=db.prepare(`
    SELECT be.*,e.employee_code,e.name
    FROM biometric_events be
    LEFT JOIN employees e ON e.id=be.employee_id
    WHERE be.factory_id=?
    ORDER BY be.event_time DESC LIMIT 30
  `).all(req.user.factory_id);
  res.json({devices,events});
});

app.post('/api/devices/register', roles('OWNER','HR_ADMIN'), (req,res) => {
  const {gate_name,device_name,device_type,serial_number}=req.body;
  if(!gate_name||!device_name||!device_type) return res.status(400).json({error:'gate_name, device_name and device_type required'});
  const r=db.prepare(`
    INSERT INTO biometric_devices(factory_id,gate_name,device_name,device_type,serial_number)
    VALUES(?,?,?,?,?)
  `).run(req.user.factory_id,gate_name,device_name,device_type,serial_number||null);
  audit(req,'REGISTER','biometric_device',String(r.lastInsertRowid),{gate_name,device_name,device_type});
  res.status(201).json(db.prepare('SELECT * FROM biometric_devices WHERE id=?').get(r.lastInsertRowid));
});


app.get('/api/employees/:id/profile', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  const id=Number(req.params.id);
  const e=db.prepare('SELECT * FROM employees WHERE id=? AND factory_id=?').get(id,req.user.factory_id);
  if(!e) return res.status(404).json({error:'Employee not found'});
  const employment=db.prepare(`
    SELECT er.*,f.name factory_name FROM employment_records er
    LEFT JOIN factories f ON f.id=er.factory_id
    WHERE er.employee_id=? ORDER BY er.start_date DESC
  `).all(id);
  const history=db.prepare('SELECT * FROM employment_history WHERE employee_id=? ORDER BY start_date DESC').all(id);
  const docs=db.prepare('SELECT * FROM employee_documents WHERE employee_id=? ORDER BY id DESC').all(id);
  const biometrics=db.prepare('SELECT id,device_type,biometric_ref,status,enrolled_at FROM biometric_identities WHERE employee_id=?').all(id);
  const nocs=db.prepare('SELECT * FROM noc_records WHERE employee_id=? ORDER BY valid_from DESC').all(id);
  const flags=db.prepare('SELECT id,category,severity,summary,status,created_at FROM red_flags WHERE employee_id=? ORDER BY created_at DESC').all(id);
  const events=db.prepare('SELECT * FROM employee_profile_events WHERE employee_id=? ORDER BY created_at DESC LIMIT 100').all(id);
  res.json({employee:e,employment,history,documents:docs,biometrics,nocs,red_flags:flags,events});
});

app.post('/api/employees/:id/documents', roles('OWNER','HR_ADMIN'), (req,res) => {
  const id=Number(req.params.id);
  const e=db.prepare('SELECT id FROM employees WHERE id=? AND factory_id=?').get(id,req.user.factory_id);
  if(!e) return res.status(404).json({error:'Employee not found'});
  const {document_type,document_number_masked,file_ref}=req.body;
  if(!document_type) return res.status(400).json({error:'document_type required'});
  const r=db.prepare(`
    INSERT INTO employee_documents(employee_id,document_type,document_number_masked,file_ref)
    VALUES(?,?,?,?)
  `).run(id,document_type,document_number_masked||null,file_ref||null);
  db.prepare(`INSERT INTO employee_profile_events(employee_id,event_type,summary,actor_user_id)
    VALUES(?,?,?,?)`).run(id,'DOCUMENT_ADDED',`Added ${document_type}`,req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM employee_documents WHERE id=?').get(r.lastInsertRowid));
});

app.post('/api/employees/:id/biometric', roles('OWNER','HR_ADMIN'), (req,res) => {
  const id=Number(req.params.id);
  const e=db.prepare('SELECT id FROM employees WHERE id=? AND factory_id=?').get(id,req.user.factory_id);
  if(!e) return res.status(404).json({error:'Employee not found'});
  const {device_type,biometric_ref}=req.body;
  if(!['FACE','FINGERPRINT'].includes(device_type)||!biometric_ref)
    return res.status(400).json({error:'device_type and biometric_ref required'});
  try {
    const r=db.prepare(`
      INSERT INTO biometric_identities(employee_id,device_type,biometric_ref)
      VALUES(?,?,?)
    `).run(id,device_type,biometric_ref);
    db.prepare(`INSERT INTO employee_profile_events(employee_id,event_type,summary,actor_user_id)
      VALUES(?,?,?,?)`).run(id,'BIOMETRIC_ENROLLED',`${device_type} identity enrolled`,req.user.id);
    res.status(201).json(db.prepare('SELECT * FROM biometric_identities WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(409).json({error:'Biometric reference already assigned'}); }
});

app.post('/api/employees/:id/employment-history', roles('OWNER','HR_ADMIN'), (req,res) => {
  const id=Number(req.params.id);
  const e=db.prepare('SELECT id FROM employees WHERE id=? AND factory_id=?').get(id,req.user.factory_id);
  if(!e) return res.status(404).json({error:'Employee not found'});
  const {factory_name,factory_id=null,employment_type,role_name,start_date,end_date,exit_reason,verification_status='UNVERIFIED'}=req.body;
  if(!factory_name||!employment_type) return res.status(400).json({error:'factory_name and employment_type required'});
  const r=db.prepare(`
    INSERT INTO employment_history(employee_id,factory_name,factory_id,employment_type,role_name,start_date,end_date,exit_reason,verification_status)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(id,factory_name,factory_id,employment_type,role_name||null,start_date||null,end_date||null,exit_reason||null,verification_status);
  db.prepare(`INSERT INTO employee_profile_events(employee_id,event_type,summary,actor_user_id)
    VALUES(?,?,?,?)`).run(id,'HISTORY_ADDED',`Employment history added: ${factory_name}`,req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM employment_history WHERE id=?').get(r.lastInsertRowid));
});


app.get('/api/employees/search', roles('OWNER','HR_ADMIN','SUPERVISOR'), async (req,res) => {
  const { searchEmployees } = await import('./employeeSearch.js');
  const q=String(req.query.q||'').trim();
  if(q.length<2) return res.status(400).json({error:'Enter at least 2 characters'});
  res.json(searchEmployees(req.user.factory_id,q,req.user.role));
});

app.get('/api/employees/:id/eligibility', roles('OWNER','HR_ADMIN','SUPERVISOR'), async (req,res) => {
  const id=Number(req.params.id);
  const workDate=String(req.query.date || new Date().toISOString().slice(0,10));
  const destination=req.user.factory_id;
  const { evaluateTemporaryEntry } = await import('./workforceRules.js');
  res.json(evaluateTemporaryEntry({employeeId:id,destinationFactoryId:destination,workDate}));
});


app.get('/api/payroll/summary', roles('OWNER','HR_ADMIN'), (req,res) => {
  const period=db.prepare(`SELECT * FROM payroll_periods WHERE factory_id=? ORDER BY id DESC LIMIT 1`).get(req.user.factory_id);
  if(!period) return res.json({period:null,items:[],totals:{gross:0,net:0,overtime:0,deductions:0}});
  const items=db.prepare(`
    SELECT pi.*,e.employee_code,e.name FROM payroll_items pi JOIN employees e ON e.id=pi.employee_id
    WHERE pi.period_id=? ORDER BY e.name
  `).all(period.id);
  const totals=items.reduce((a,x)=>({
    gross:a.gross+x.gross_amount,net:a.net+x.net_amount,
    overtime:a.overtime+x.overtime_amount,
    deductions:a.deductions+x.advance_deduction+x.loan_deduction+x.other_deduction
  }),{gross:0,net:0,overtime:0,deductions:0});
  res.json({period,items,totals});
});

app.post('/api/payroll/advance', roles('OWNER','HR_ADMIN'), (req,res) => {
  const {employee_id,amount,advance_date,reason}=req.body;
  if(!employee_id||!amount||!advance_date) return res.status(400).json({error:'employee_id, amount and advance_date required'});
  const e=db.prepare('SELECT id FROM employees WHERE id=? AND factory_id=?').get(employee_id,req.user.factory_id);
  if(!e) return res.status(404).json({error:'Employee not found'});
  const r=db.prepare(`INSERT INTO employee_advances(employee_id,amount,advance_date,reason,outstanding,approved_by)
    VALUES(?,?,?,?,?,?)`).run(employee_id,Number(amount),advance_date,reason||null,Number(amount),req.user.id);
  audit(req,'CREATE','employee_advance',String(r.lastInsertRowid),{employee_id,amount});
  res.status(201).json(db.prepare('SELECT * FROM employee_advances WHERE id=?').get(r.lastInsertRowid));
});

app.post('/api/payroll/loan', roles('OWNER','HR_ADMIN'), (req,res) => {
  const {employee_id,principal,monthly_deduction,start_date}=req.body;
  if(!employee_id||!principal||!monthly_deduction||!start_date) return res.status(400).json({error:'employee_id, principal, monthly_deduction and start_date required'});
  const e=db.prepare('SELECT id FROM employees WHERE id=? AND factory_id=?').get(employee_id,req.user.factory_id);
  if(!e) return res.status(404).json({error:'Employee not found'});
  const r=db.prepare(`INSERT INTO employee_loans(employee_id,principal,outstanding,monthly_deduction,start_date,approved_by)
    VALUES(?,?,?,?,?,?)`).run(employee_id,Number(principal),Number(principal),Number(monthly_deduction),start_date,req.user.id);
  audit(req,'CREATE','employee_loan',String(r.lastInsertRowid),{employee_id,principal});
  res.status(201).json(db.prepare('SELECT * FROM employee_loans WHERE id=?').get(r.lastInsertRowid));
});

app.get('/api/payroll/employee/:id', roles('OWNER','HR_ADMIN'), (req,res) => {
  const id=Number(req.params.id);
  const e=db.prepare('SELECT id,employee_code,name FROM employees WHERE id=? AND factory_id=?').get(id,req.user.factory_id);
  if(!e) return res.status(404).json({error:'Employee not found'});
  const salary=db.prepare('SELECT * FROM salary_profiles WHERE employee_id=? AND active=1').get(id);
  const advances=db.prepare('SELECT * FROM employee_advances WHERE employee_id=? ORDER BY advance_date DESC').all(id);
  const loans=db.prepare('SELECT * FROM employee_loans WHERE employee_id=? ORDER BY start_date DESC').all(id);
  const payroll=db.prepare(`SELECT pi.*,pp.period_start,pp.period_end,pp.status period_status
    FROM payroll_items pi JOIN payroll_periods pp ON pp.id=pi.period_id
    WHERE pi.employee_id=? ORDER BY pp.period_end DESC LIMIT 12`).all(id);
  res.json({employee:e,salary,advances,loans,payroll});
});


app.get('/api/reports/factory', roles('OWNER','HR_ADMIN'), async (req,res) => {
  const { factoryReport } = await import('./reports.js');
  const end=String(req.query.end || new Date().toISOString().slice(0,10));
  const start=String(req.query.start || end);
  res.json(factoryReport(req.user.factory_id,start,end));
});


app.get('/api/association/dashboard', roles('OWNER','HR_ADMIN'), (req,res) => {
  const membership=db.prepare(`SELECT * FROM association_memberships WHERE factory_id=? AND membership_status='ACTIVE'`).get(req.user.factory_id);
  if(!membership) return res.json({member:false,cases:[],updates:[],committee:[]});
  const cases=db.prepare(`SELECT rc.*,rf.category,rf.severity,rf.summary
    FROM review_cases rc LEFT JOIN red_flags rf ON rf.id=rc.red_flag_id
    WHERE rc.association_id=? ORDER BY rc.opened_at DESC LIMIT 50`).all(membership.id);
  const updates=db.prepare(`SELECT * FROM association_updates WHERE association_id=? ORDER BY generated_at DESC LIMIT 50`).all(membership.id);
  const committee=db.prepare(`SELECT * FROM review_committee_members WHERE association_id=? AND active=1 ORDER BY role_name`).all(membership.id);
  res.json({member:true,membership,cases,updates,committee});
});

app.post('/api/association/cases', roles('OWNER','HR_ADMIN'), (req,res) => {
  const m=db.prepare(`SELECT * FROM association_memberships WHERE factory_id=? AND membership_status='ACTIVE'`).get(req.user.factory_id);
  if(!m) return res.status(403).json({error:'Factory is not an active association member'});
  const {red_flag_id=null,case_type='EMPLOYMENT_POLICY',priority='NORMAL',summary=''}=req.body;
  if(!summary) return res.status(400).json({error:'summary required'});
  const r=db.prepare(`INSERT INTO review_cases(association_id,red_flag_id,case_type,priority)
    VALUES(?,?,?,?)`).run(m.id,red_flag_id,case_type,priority);
  db.prepare(`INSERT INTO association_updates(association_id,update_type,title,summary,source_case_id)
    VALUES(?,?,?,?,?)`).run(m.id,'CASE_OPENED','New review case',summary,r.lastInsertRowid);
  audit(req,'CREATE','review_case',String(r.lastInsertRowid),{red_flag_id,case_type,priority});
  res.status(201).json(db.prepare('SELECT * FROM review_cases WHERE id=?').get(r.lastInsertRowid));
});

app.get('/api/association/updates', roles('OWNER','HR_ADMIN'), (req,res) => {
  const m=db.prepare(`SELECT id FROM association_memberships WHERE factory_id=? AND membership_status='ACTIVE'`).get(req.user.factory_id);
  if(!m) return res.json([]);
  res.json(db.prepare(`SELECT id,update_type,title,summary,generated_at FROM association_updates
    WHERE association_id=? ORDER BY generated_at DESC LIMIT 100`).all(m.id));
});


app.get('/api/security/notifications', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  res.json(db.prepare(`SELECT id,notification_type,title,message,severity,read_at,created_at
    FROM notifications WHERE (user_id=? OR (user_id IS NULL AND factory_id=?))
    ORDER BY created_at DESC LIMIT 50`).all(req.user.id,req.user.factory_id));
});

app.post('/api/security/notifications/:id/read', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res) => {
  const id=Number(req.params.id);
  const r=db.prepare(`UPDATE notifications SET read_at=CURRENT_TIMESTAMP
    WHERE id=? AND (user_id=? OR (user_id IS NULL AND factory_id=?))`).run(id,req.user.id,req.user.factory_id);
  if(!r.changes) return res.status(404).json({error:'Notification not found'});
  res.json({ok:true});
});

app.get('/api/security/devices', roles('OWNER','HR_ADMIN'), (req,res) => {
  res.json(db.prepare(`SELECT id,device_code,device_type,status,last_seen_at,firmware_version
    FROM device_registry WHERE factory_id=? ORDER BY device_code`).all(req.user.factory_id));
});

app.post('/api/security/devices', roles('OWNER'), (req,res) => {
  const {device_code,device_type,firmware_version}=req.body;
  if(!device_code||!['FACE','FINGERPRINT','FACE_FINGERPRINT','GATE'].includes(device_type))
    return res.status(400).json({error:'Valid device_code and device_type required'});
  try {
    const r=db.prepare(`INSERT INTO device_registry(factory_id,device_code,device_type,firmware_version)
      VALUES(?,?,?,?)`).run(req.user.factory_id,device_code,device_type,firmware_version||null);
    db.prepare(`INSERT INTO security_events(user_id,factory_id,event_type,entity_type,entity_id,result,metadata)
      VALUES(?,?,?,?,?,?,?)`).run(req.user.id,req.user.factory_id,'DEVICE_REGISTERED','DEVICE',String(r.lastInsertRowid),'SUCCESS',JSON.stringify({device_code,device_type}));
    res.status(201).json(db.prepare('SELECT * FROM device_registry WHERE id=?').get(r.lastInsertRowid));
  } catch(e) { res.status(409).json({error:'Device code already registered'}); }
});

app.get('/api/security/audit', roles('OWNER'), (req,res) => {
  res.json(db.prepare(`SELECT * FROM security_events WHERE factory_id=? ORDER BY created_at DESC LIMIT 100`)
    .all(req.user.factory_id));
});


app.get('/api/hamal/teams', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res)=>{
 const rows=db.prepare(`SELECT ht.*,COUNT(htm.id) member_count,SUM(CASE WHEN htm.status='ACTIVE' THEN 1 ELSE 0 END) active_members FROM hamal_teams ht LEFT JOIN hamal_team_members htm ON htm.team_id=ht.id WHERE ht.factory_id=? GROUP BY ht.id ORDER BY ht.team_name`).all(req.user.factory_id); res.json(rows);
});
app.post('/api/hamal/teams', roles('OWNER','HR_ADMIN'), (req,res)=>{
 const {team_code,team_name,member_limit=15,leader_employee_id=null}=req.body;
 if(!team_code||!team_name)return res.status(400).json({error:'team_code and team_name required'});
 try{const r=db.prepare(`INSERT INTO hamal_teams(factory_id,team_code,team_name,member_limit,leader_employee_id) VALUES(?,?,?,?,?)`).run(req.user.factory_id,team_code,team_name,Math.max(1,Math.min(100,Number(member_limit)||15)),leader_employee_id); res.status(201).json(db.prepare('SELECT * FROM hamal_teams WHERE id=?').get(r.lastInsertRowid));}catch(e){res.status(409).json({error:'Team code already exists'});}
});
app.post('/api/hamal/teams/:id/attendance', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res)=>{
 const team=db.prepare('SELECT * FROM hamal_teams WHERE id=? AND factory_id=?').get(Number(req.params.id),req.user.factory_id); if(!team)return res.status(404).json({error:'Hamal team not found'});
 const d=req.body.attendance_date||new Date().toISOString().slice(0,10), members=db.prepare("SELECT COUNT(*) c FROM hamal_team_members WHERE team_id=? AND status='ACTIVE'").get(team.id).c, present=Math.max(0,Math.min(members,Number(req.body.present_count)||0));
 db.prepare(`INSERT INTO hamal_team_attendance(team_id,attendance_date,required_count,present_count,absent_count,assignment_type,notes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(team_id,attendance_date) DO UPDATE SET present_count=excluded.present_count,absent_count=excluded.absent_count,assignment_type=excluded.assignment_type,notes=excluded.notes`).run(team.id,d,members,present,members-present,req.body.assignment_type||'MIXED',req.body.notes||'');
 res.json(db.prepare('SELECT * FROM hamal_team_attendance WHERE team_id=? AND attendance_date=?').get(team.id,d));
});
app.get('/api/workforce/overview', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res)=>{
 const f=req.user.factory_id;
 const permanent=db.prepare("SELECT COUNT(*) c FROM employees WHERE factory_id=? AND employment_status='ACTIVE'").get(f).c;
 const daily=db.prepare("SELECT COUNT(*) c FROM employees WHERE factory_id=? AND employment_status='DAILY_ACTIVE'").get(f).c;
 const teams=db.prepare(`SELECT ht.*,COUNT(htm.id) member_count FROM hamal_teams ht LEFT JOIN hamal_team_members htm ON htm.team_id=ht.id WHERE ht.factory_id=? GROUP BY ht.id`).all(f);
 res.json({permanent,daily,hamal_teams:teams});
});

app.get('/api/daily-ops/today', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res)=>{
 const f=req.user.factory_id, d=new Date().toISOString().slice(0,10);
 const reqt=db.prepare('SELECT * FROM daily_requirements WHERE factory_id=? AND requirement_date=?').get(f,d);
 const entries=db.prepare(`SELECT dle.*,e.name,e.employee_code FROM daily_labour_entries dle LEFT JOIN employees e ON e.id=dle.worker_id WHERE dle.factory_id=? AND dle.entry_date=? ORDER BY dle.entry_time DESC`).all(f,d);
 const openAlerts=db.prepare("SELECT COUNT(*) c FROM labour_alerts WHERE factory_id=? AND status='OPEN'").get(f).c;
 const permanent=db.prepare("SELECT COUNT(*) c FROM employees WHERE factory_id=? AND employment_status='ACTIVE'").get(f).c;
 const dailyPresent=entries.filter(x=>x.gate_decision==='ALLOW').length;
 res.json({date:d,permanent_present_snapshot:permanent,requirement:reqt||null,daily_entries:entries,allowed_today:dailyPresent,open_alerts:openAlerts,shortage:reqt?Math.max(0,reqt.required_count-dailyPresent):0});
});
app.post('/api/daily-ops/requirement', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res)=>{
 const d=req.body.requirement_date||new Date().toISOString().slice(0,10), n=Math.max(0,Number(req.body.required_count)||0);
 db.prepare(`INSERT INTO daily_requirements(factory_id,requirement_date,required_count,source,notes) VALUES(?,?,?,?,?)
 ON CONFLICT(factory_id,requirement_date) DO UPDATE SET required_count=excluded.required_count,notes=excluded.notes`).run(req.user.factory_id,d,n,req.body.source||'OWNER',req.body.notes||'');
 res.json(db.prepare('SELECT * FROM daily_requirements WHERE factory_id=? AND requirement_date=?').get(req.user.factory_id,d));
});
app.post('/api/daily-ops/labour-entry', roles('OWNER','HR_ADMIN','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const f=req.user.factory_id,d=req.body.entry_date||new Date().toISOString().slice(0,10),tm=req.body.entry_time||new Date().toTimeString().slice(0,8);
 const workerId=req.body.worker_id||null, method=req.body.verification_method||'MANUAL';
 let verification='PENDING',employment='NOT_CHECKED',noc='NOT_REQUIRED',decision='PENDING',alert=null;
 if(workerId){
   verification = ['FACE','FINGERPRINT','BIOMETRIC'].includes(method)?'VERIFIED':'PENDING';
   const emp=db.prepare("SELECT * FROM employees WHERE id=?").get(workerId);
   if(emp && emp.factory_id!==f){
     employment='PERMANENT_ELSEWHERE'; noc='REQUIRED'; decision='BLOCK';
     alert='Worker has a permanent employment record outside this factory. NOC is required before temporary work.';
   } else {
     employment='NO_CONFLICT'; decision='ALLOW';
   }
 } else {
   alert='Identity not linked to a worker record; manual review required.';
 }
 const r=db.prepare(`INSERT INTO daily_labour_entries(factory_id,worker_id,entry_date,entry_time,verification_method,verification_status,employment_check,noc_status,gate_decision,daily_rate,advance_amount,notes)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(f,workerId,d,tm,method,verification,employment,noc,decision,Number(req.body.daily_rate)||0,Number(req.body.advance_amount)||0,req.body.notes||'');
 if(alert) db.prepare(`INSERT INTO labour_alerts(factory_id,worker_id,entry_id,alert_type,severity,message) VALUES(?,?,?,?,?,?)`).run(f,workerId,r.lastInsertRowid,decision==='BLOCK'?'PERMANENT_CONFLICT':'IDENTITY_REVIEW',decision==='BLOCK'?'RED':'AMBER',alert);
 res.status(201).json({entry:db.prepare('SELECT * FROM daily_labour_entries WHERE id=?').get(r.lastInsertRowid),decision,alert});
});
app.get('/api/daily-ops/alerts', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res)=>{
 res.json(db.prepare(`SELECT la.*,e.name,e.employee_code FROM labour_alerts la LEFT JOIN employees e ON e.id=la.worker_id WHERE la.factory_id=? AND la.status='OPEN' ORDER BY la.created_at DESC`).all(req.user.factory_id));
});

app.post('/api/time/in', roles('OWNER','HR_ADMIN','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const d=req.body.event_date||new Date().toISOString().slice(0,10), tm=req.body.in_time||new Date().toTimeString().slice(0,8);
 const r=db.prepare(`INSERT INTO worker_time_events(factory_id,worker_id,workforce_type,event_date,in_time,source,notes) VALUES(?,?,?,?,?,?,?)`)
   .run(req.user.factory_id,req.body.worker_id||null,req.body.workforce_type||'DAILY',d,tm,req.body.source||'BIOMETRIC',req.body.notes||'');
 res.status(201).json(db.prepare('SELECT * FROM worker_time_events WHERE id=?').get(r.lastInsertRowid));
});
app.post('/api/time/out', roles('OWNER','HR_ADMIN','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const d=req.body.event_date||new Date().toISOString().slice(0,10), tm=req.body.out_time||new Date().toTimeString().slice(0,8);
 const row=db.prepare(`SELECT * FROM worker_time_events WHERE factory_id=? AND worker_id=? AND event_date=? AND out_time IS NULL ORDER BY id DESC LIMIT 1`)
   .get(req.user.factory_id,req.body.worker_id,d);
 if(!row)return res.status(404).json({error:'Open attendance event not found'});
 db.prepare('UPDATE worker_time_events SET out_time=?,status=? WHERE id=?').run(tm,'CLOSED',row.id);
 res.json(db.prepare('SELECT * FROM worker_time_events WHERE id=?').get(row.id));
});
app.post('/api/ledger/advance', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res)=>{
 const amount=Number(req.body.amount)||0;if(amount<=0)return res.status(400).json({error:'Amount must be positive'});
 const r=db.prepare(`INSERT INTO worker_advance_ledger(factory_id,worker_id,entry_date,entry_type,amount,reference,notes) VALUES(?,?,?,?,?,?,?)`)
  .run(req.user.factory_id,req.body.worker_id||null,req.body.entry_date||new Date().toISOString().slice(0,10),'ADVANCE',amount,req.body.reference||'',req.body.notes||'');
 res.status(201).json(db.prepare('SELECT * FROM worker_advance_ledger WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/ledger/:worker_id', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res)=>{
 const rows=db.prepare('SELECT * FROM worker_advance_ledger WHERE factory_id=? AND worker_id=? ORDER BY entry_date DESC,id DESC').all(req.user.factory_id,Number(req.params.worker_id));
 const outstanding=rows.reduce((a,x)=>a+(x.entry_type==='ADVANCE'?x.amount:-x.amount),0);
 res.json({rows,outstanding});
});
app.post('/api/payroll/period', roles('OWNER','HR_ADMIN'), (req,res)=>{
 const start=req.body.period_start,end=req.body.period_end;if(!start||!end)return res.status(400).json({error:'period_start and period_end required'});
 const r=db.prepare(`INSERT INTO pay_periods(factory_id,period_start,period_end) VALUES(?,?,?) ON CONFLICT(factory_id,period_start,period_end) DO UPDATE SET status='OPEN'`)
  .run(req.user.factory_id,start,end);
 res.status(201).json(db.prepare('SELECT * FROM pay_periods WHERE factory_id=? AND period_start=? AND period_end=?').get(req.user.factory_id,start,end));
});
app.post('/api/payroll/calculate/:id', roles('OWNER','HR_ADMIN'), (req,res)=>{
 const period=db.prepare('SELECT * FROM pay_periods WHERE id=? AND factory_id=?').get(Number(req.params.id),req.user.factory_id);
 if(!period)return res.status(404).json({error:'Pay period not found'});
 db.prepare('DELETE FROM pay_items WHERE pay_period_id=?').run(period.id);
 const workers=db.prepare(`SELECT id,name,employment_status FROM employees WHERE factory_id=? AND employment_status IN ('ACTIVE','DAILY_ACTIVE')`).all(req.user.factory_id);
 const ins=db.prepare(`INSERT INTO pay_items(pay_period_id,worker_id,workforce_type,present_days,total_hours,ot_hours,base_amount,ot_amount,advance_amount,deduction_amount,net_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
 for(const w of workers){
   const ev=db.prepare(`SELECT * FROM worker_time_events WHERE factory_id=? AND worker_id=? AND event_date BETWEEN ? AND ?`).all(req.user.factory_id,w.id,period.period_start,period.period_end);
   let hours=0,days=0;
   for(const e of ev){if(e.in_time)days+=1;if(e.in_time&&e.out_time){const a=new Date('2000-01-01T'+e.in_time),b=new Date('2000-01-01T'+e.out_time);let h=(b-a)/3600000;if(h<0)h+=24;hours+=h;}}
   const ot=Math.max(0,hours-days*8), rate=Number(req.body.daily_rate)||500, otRate=Number(req.body.ot_rate)||Math.round(rate/8*1.5);
   const base=days*rate, ota=ot*otRate;
   const adv=db.prepare(`SELECT COALESCE(SUM(CASE WHEN entry_type='ADVANCE' THEN amount ELSE -amount END),0) a FROM worker_advance_ledger WHERE factory_id=? AND worker_id=? AND entry_date BETWEEN ? AND ?`).get(req.user.factory_id,w.id,period.period_start,period.period_end).a;
   const net=Math.max(0,base+ota-adv);
   ins.run(period.id,w.id,w.employment_status==='DAILY_ACTIVE'?'DAILY':'PERMANENT',days,hours,ot,base,ota,adv,0,net);
 }
 db.prepare("UPDATE pay_periods SET status='CALCULATED' WHERE id=?").run(period.id);
 const total=db.prepare('SELECT COALESCE(SUM(net_amount),0) total FROM pay_items WHERE pay_period_id=?').get(period.id).total;
 res.json({period:db.prepare('SELECT * FROM pay_periods WHERE id=?').get(period.id),total,items:db.prepare('SELECT * FROM pay_items WHERE pay_period_id=? ORDER BY net_amount DESC').all(period.id)});
});
app.get('/api/payroll/:id', roles('OWNER','HR_ADMIN','SUPERVISOR'), (req,res)=>{
 const p=db.prepare('SELECT * FROM pay_periods WHERE id=? AND factory_id=?').get(Number(req.params.id),req.user.factory_id);if(!p)return res.status(404).json({error:'Pay period not found'});
 res.json({period:p,items:db.prepare('SELECT pi.*,e.name,e.employee_code FROM pay_items pi LEFT JOIN employees e ON e.id=pi.worker_id WHERE pi.pay_period_id=? ORDER BY e.name').all(p.id)});
});

const permissionSeed=[
 ['EMPLOYEE_VIEW','View employees','EMPLOYEE'],['EMPLOYEE_EDIT','Register/edit employees','EMPLOYEE'],
 ['BIOMETRIC_ENROLL','Biometric enrollment','IDENTITY'],['AADHAAR_VERIFY','Aadhaar verification','IDENTITY'],
 ['ATTENDANCE_VIEW','View attendance','ATTENDANCE'],['ATTENDANCE_EDIT','Correct attendance','ATTENDANCE'],
 ['ATTENDANCE_APPROVE','Approve attendance corrections','ATTENDANCE'],
 ['FATAK_ENTRY','Daily/Fatak labour entry','GATE'],['FATAK_APPROVE','Approve gate exceptions','GATE'],
 ['RED_FLAG_VIEW','View employer Red Flags','SECURITY'],['RED_FLAG_MANAGE','Resolve Red Flags','SECURITY'],
 ['NOC_MANAGE','Manage NOC decisions','SECURITY'],['NOTICE_BOARD_VIEW','View notice board','SECURITY'],
 ['HAMAL_MANAGE','Manage Hamal Toli','HAMAL'],['ADVANCE_VIEW','View advances','PAYROLL'],['ADVANCE_EDIT','Enter advances','PAYROLL'],
 ['PAYROLL_VIEW','View payroll','PAYROLL'],['PAYROLL_CALCULATE','Calculate payroll','PAYROLL'],['PAYROLL_APPROVE','Approve settlement','PAYROLL'],
 ['REPORT_EXPORT','Export reports','REPORTS'],['USER_MANAGE','Create/manage users','ADMIN'],['PERMISSION_MANAGE','Manage user limitations','ADMIN'],
 ['AUDIT_VIEW','View security audit','ADMIN'],['EMPLOYEE_DELETE','Deactivate employees','EMPLOYEE']
];
for(const p of permissionSeed) db.prepare('INSERT OR IGNORE INTO app_permissions(code,name,module) VALUES(?,?,?)').run(...p);
const roleSeed=[
 ['OWNER','Owner','Full factory authority',1],
 ['ADMIN','Admin / HR','People and administration',0],
 ['MANAGER','Manager','Daily operations',0],
 ['SUPERVISOR','Supervisor','Floor and workforce supervision',0],
 ['GATE_OPERATOR','Gate Operator','Entry and verification',0],
 ['ACCOUNTS','Accounts','Advances and payroll',0],
 ['VIEWER','Viewer','Read-only permitted modules',0]
];
for(const r of roleSeed) db.prepare('INSERT OR IGNORE INTO app_roles(code,name,description,system_role) VALUES(?,?,?,?)').run(...r);
const rolePerms={
 OWNER: permissionSeed.map(x=>x[0]),
 ADMIN: permissionSeed.map(x=>x[0]).filter(x=>!['PAYROLL_APPROVE','RED_FLAG_MANAGE','USER_MANAGE','PERMISSION_MANAGE','AUDIT_VIEW'].includes(x)),
 MANAGER:['EMPLOYEE_VIEW','EMPLOYEE_EDIT','BIOMETRIC_ENROLL','ATTENDANCE_VIEW','ATTENDANCE_EDIT','FATAK_ENTRY','RED_FLAG_VIEW','NOTICE_BOARD_VIEW','HAMAL_MANAGE','ADVANCE_VIEW','ADVANCE_EDIT','PAYROLL_VIEW'],
 SUPERVISOR:['EMPLOYEE_VIEW','ATTENDANCE_VIEW','FATAK_ENTRY','RED_FLAG_VIEW','NOTICE_BOARD_VIEW','HAMAL_MANAGE','ADVANCE_VIEW'],
 GATE_OPERATOR:['EMPLOYEE_VIEW','BIOMETRIC_ENROLL','AADHAAR_VERIFY','ATTENDANCE_VIEW','FATAK_ENTRY','FATAK_APPROVE','RED_FLAG_VIEW','NOTICE_BOARD_VIEW'],
 ACCOUNTS:['EMPLOYEE_VIEW','ATTENDANCE_VIEW','ADVANCE_VIEW','ADVANCE_EDIT','PAYROLL_VIEW','PAYROLL_CALCULATE','REPORT_EXPORT'],
 VIEWER:['EMPLOYEE_VIEW','ATTENDANCE_VIEW','RED_FLAG_VIEW','NOTICE_BOARD_VIEW','HAMAL_MANAGE','ADVANCE_VIEW','PAYROLL_VIEW']
};
for(const [rc,plist] of Object.entries(rolePerms)){
 const role=db.prepare('SELECT id FROM app_roles WHERE code=?').get(rc);
 for(const pc of plist){const p=db.prepare('SELECT id FROM app_permissions WHERE code=?').get(pc);if(p) db.prepare('INSERT OR REPLACE INTO role_permissions(role_id,permission_id,allowed) VALUES(?,?,1)').run(role.id,p.id)}
}


app.get('/api/security/roles', roles('OWNER','ADMIN'), (req,res)=>{
 const rolesRows=db.prepare('SELECT id,code,name,description FROM app_roles ORDER BY system_role DESC,name').all();
 const permissions=db.prepare('SELECT id,code,name,module FROM app_permissions ORDER BY module,name').all();
 const matrix=db.prepare(`SELECT ar.code role_code,ap.code permission_code,rp.allowed FROM role_permissions rp JOIN app_roles ar ON ar.id=rp.role_id JOIN app_permissions ap ON ap.id=rp.permission_id`).all();
 res.json({roles:rolesRows,permissions,matrix});
});
app.post('/api/security/users', roles('OWNER'), (req,res)=>{
 const {username,display_name,role_code='VIEWER',employee_id=null}=req.body;
 if(!username||!display_name)return res.status(400).json({error:'username and display_name required'});
 const role=db.prepare('SELECT id FROM app_roles WHERE code=?').get(role_code);if(!role)return res.status(400).json({error:'Invalid role'});
 try{const r=db.prepare('INSERT INTO app_users(factory_id,employee_id,username,display_name,role_id) VALUES(?,?,?,?,?)').run(req.user.factory_id,employee_id,username,display_name,role.id);
 db.prepare('INSERT INTO security_audit_log(factory_id,user_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)').run(req.user.factory_id,req.user.id||null,'CREATE_USER','USER',r.lastInsertRowid,`role=${role_code}`);
 res.status(201).json(db.prepare(`SELECT u.id,u.username,u.display_name,u.active,r.code role_code,r.name role_name FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE u.id=?`).get(r.lastInsertRowid));}
 catch(e){res.status(409).json({error:'Username already exists'});}
});
app.get('/api/security/users', roles('OWNER','ADMIN'), (req,res)=>{
 res.json(db.prepare(`SELECT u.id,u.username,u.display_name,u.active,e.name employee_name,r.code role_code,r.name role_name FROM app_users u JOIN app_roles r ON r.id=u.role_id LEFT JOIN employees e ON e.id=u.employee_id WHERE u.factory_id=? ORDER BY u.display_name`).all(req.user.factory_id));
});
app.post('/api/security/users/:id/limit', roles('OWNER'), (req,res)=>{
 const uid=Number(req.params.id), u=db.prepare('SELECT * FROM app_users WHERE id=? AND factory_id=?').get(uid,req.user.factory_id);if(!u)return res.status(404).json({error:'User not found'});
 const {limit_code,limit_value}=req.body;if(!limit_code)return res.status(400).json({error:'limit_code required'});
 db.prepare(`INSERT INTO user_limits(user_id,limit_code,limit_value) VALUES(?,?,?) ON CONFLICT(user_id,limit_code) DO UPDATE SET limit_value=excluded.limit_value`).run(uid,limit_code,String(limit_value??''));
 db.prepare('INSERT INTO security_audit_log(factory_id,user_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)').run(req.user.factory_id,req.user.id||null,'SET_LIMIT','USER',uid,`${limit_code}=${limit_value}`);
 res.json({ok:true,user_id:uid,limit_code,limit_value});
});
app.post('/api/security/users/:id/permission', roles('OWNER'), (req,res)=>{
 const uid=Number(req.params.id), code=req.body.permission_code, allowed=!!req.body.allowed;
 const u=db.prepare('SELECT * FROM app_users WHERE id=? AND factory_id=?').get(uid,req.user.factory_id);const p=db.prepare('SELECT * FROM app_permissions WHERE code=?').get(code);
 if(!u||!p)return res.status(404).json({error:'User or permission not found'});
 db.prepare('INSERT OR REPLACE INTO user_permission_overrides(user_id,permission_id,allowed) VALUES(?,?,?)').run(uid,p.id,allowed?1:0);
 db.prepare('INSERT INTO security_audit_log(factory_id,user_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)').run(req.user.factory_id,req.user.id||null,'SET_PERMISSION','USER',uid,`${code}=${allowed}`);
 res.json({ok:true});
});
app.get('/api/security/users/:id/effective-access', roles('OWNER','ADMIN'), (req,res)=>{
 const u=db.prepare(`SELECT u.*,r.code role_code,r.name role_name FROM app_users u JOIN app_roles r ON r.id=u.role_id WHERE u.id=? AND u.factory_id=?`).get(Number(req.params.id),req.user.factory_id);if(!u)return res.status(404).json({error:'User not found'});
 const rows=db.prepare(`SELECT ap.code,ap.name,ap.module,COALESCE(upo.allowed,rp.allowed,0) allowed FROM app_permissions ap LEFT JOIN role_permissions rp ON rp.permission_id=ap.id AND rp.role_id=? LEFT JOIN user_permission_overrides upo ON upo.permission_id=ap.id AND upo.user_id=? ORDER BY ap.module,ap.name`).all(u.role_id,u.id);
 const limits=db.prepare('SELECT limit_code,limit_value FROM user_limits WHERE user_id=?').all(u.id);
 res.json({user:{id:u.id,username:u.username,display_name:u.display_name,role:u.role_code},permissions:rows,limits});
});

function attendanceLocked(factoryId,date){return !!db.prepare('SELECT id FROM attendance_locks WHERE factory_id=? AND lock_date=?').get(factoryId,date);}
function recordSec(factoryId,userId,workerId,type,severity,details){db.prepare('INSERT INTO attendance_security_events(factory_id,user_id,worker_id,event_type,severity,details) VALUES(?,?,?,?,?,?)').run(factoryId,userId||null,workerId||null,type,severity,details||'');}

app.post('/api/attendance/lock', roles('OWNER','HR_ADMIN'), (req,res)=>{
 const date=req.body.date||new Date().toISOString().slice(0,10);
 db.prepare('INSERT OR IGNORE INTO attendance_locks(factory_id,lock_date,locked_by) VALUES(?,?,?)').run(req.user.factory_id,date,req.user.id||null);
 recordSec(req.user.factory_id,req.user.id,null,'ATTENDANCE_LOCK','INFO',`Attendance locked for ${date}`);
 res.json({locked:true,date});
});
app.get('/api/attendance/lock/:date', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','VIEWER'), (req,res)=>{
 res.json({date:req.params.date,locked:attendanceLocked(req.user.factory_id,req.params.date)});
});
app.post('/api/attendance/correction', roles('OWNER','HR_ADMIN','MANAGER','SUPERVISOR'), (req,res)=>{
 const date=req.body.date,eventId=req.body.event_id,workerId=req.body.worker_id,field=req.body.field_name;
 if(!date||!workerId||!field||!req.body.reason)return res.status(400).json({error:'date, worker_id, field_name and reason are required'});
 if(attendanceLocked(req.user.factory_id,date) && req.user.role_code!=='OWNER') {
   recordSec(req.user.factory_id,req.user.id,workerId,'EDIT_AFTER_LOCK_ATTEMPT','HIGH',`Attempted correction on locked date ${date}`);
   return res.status(403).json({error:'Attendance is locked. Submit an owner-authorized correction request.'});
 }
 let original=null;
 if(eventId) {
   const e=db.prepare('SELECT * FROM worker_time_events WHERE id=? AND factory_id=?').get(eventId,req.user.factory_id);
   if(e) original=e[field]??null;
 }
 const r=db.prepare(`INSERT INTO attendance_corrections(factory_id,worker_id,event_id,field_name,original_value,new_value,reason,requested_by) VALUES(?,?,?,?,?,?,?,?)`)
  .run(req.user.factory_id,workerId,eventId||null,field,String(original??''),String(req.body.new_value??''),req.body.reason,req.user.id||null);
 recordSec(req.user.factory_id,req.user.id,workerId,'CORRECTION_REQUEST','INFO',`Correction #${r.lastInsertRowid}: ${field}`);
 res.status(201).json(db.prepare('SELECT * FROM attendance_corrections WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/attendance/corrections', roles('OWNER','HR_ADMIN','MANAGER','SUPERVISOR'), (req,res)=>{
 const status=req.query.status||'PENDING';
 res.json(db.prepare(`SELECT ac.*,e.name,e.employee_code FROM attendance_corrections ac LEFT JOIN employees e ON e.id=ac.worker_id WHERE ac.factory_id=? AND ac.approval_status=? ORDER BY ac.requested_at DESC`).all(req.user.factory_id,status));
});
app.post('/api/attendance/corrections/:id/decision', roles('OWNER','HR_ADMIN'), (req,res)=>{
 const c=db.prepare('SELECT * FROM attendance_corrections WHERE id=? AND factory_id=?').get(Number(req.params.id),req.user.factory_id);
 if(!c)return res.status(404).json({error:'Correction not found'});
 const decision=req.body.decision==='APPROVE'?'APPROVED':req.body.decision==='REJECT'?'REJECTED':null;
 if(!decision)return res.status(400).json({error:'decision must be APPROVE or REJECT'});
 if(c.approval_status!=='PENDING')return res.status(409).json({error:'Correction already decided'});
 if(decision==='APPROVED' && c.event_id){
   if(attendanceLocked(req.user.factory_id,db.prepare('SELECT event_date FROM worker_time_events WHERE id=?').get(c.event_id)?.event_date||'')){
     recordSec(req.user.factory_id,req.user.id,c.worker_id,'APPROVED_AFTER_LOCK','HIGH',`Approved correction #${c.id} on locked attendance`);
   }
   if(['in_time','out_time','status','source','notes'].includes(c.field_name))
     db.prepare(`UPDATE worker_time_events SET ${c.field_name}=? WHERE id=? AND factory_id=?`).run(c.new_value,c.event_id,req.user.factory_id);
 }
 db.prepare('UPDATE attendance_corrections SET approval_status=?,approved_by=?,decided_at=CURRENT_TIMESTAMP,decision_note=? WHERE id=?').run(decision,req.user.id||null,req.body.decision_note||'',c.id);
 recordSec(req.user.factory_id,req.user.id,c.worker_id,'CORRECTION_DECISION',decision==='APPROVED'?'MEDIUM':'INFO',`Correction #${c.id} ${decision}`);
 res.json(db.prepare('SELECT * FROM attendance_corrections WHERE id=?').get(c.id));
});
app.get('/api/attendance/security-dashboard', roles('OWNER'), (req,res)=>{
 const corrections=db.prepare(`SELECT COUNT(*) c FROM attendance_corrections WHERE factory_id=? AND requested_at>=datetime('now','-7 day')`).get(req.user.factory_id).c;
 const pending=db.prepare(`SELECT COUNT(*) c FROM attendance_corrections WHERE factory_id=? AND approval_status='PENDING'`).get(req.user.factory_id).c;
 const high=db.prepare(`SELECT COUNT(*) c FROM attendance_security_events WHERE factory_id=? AND severity='HIGH' AND created_at>=datetime('now','-30 day')`).get(req.user.factory_id).c;
 const byUser=db.prepare(`SELECT requested_by,COUNT(*) corrections FROM attendance_corrections WHERE factory_id=? AND requested_at>=datetime('now','-7 day') GROUP BY requested_by ORDER BY corrections DESC`).all(req.user.factory_id);
 const events=db.prepare(`SELECT * FROM attendance_security_events WHERE factory_id=? ORDER BY created_at DESC LIMIT 30`).all(req.user.factory_id);
 res.json({corrections_7d:corrections,pending,high_risk_30d:high,by_user:byUser,events});
});

app.post('/api/workers/:id/identity', roles('OWNER','ADMIN','MANAGER','GATE_OPERATOR'), (req,res)=>{
 const wid=Number(req.params.id), w=db.prepare('SELECT id FROM employees WHERE id=? AND factory_id=?').get(wid,req.user.factory_id);
 if(!w)return res.status(404).json({error:'Worker not found'});
 db.prepare(`INSERT INTO worker_identity_profiles(worker_id,identity_status,id_type,id_last4,aadhaar_status,face_status,fingerprint_status,mobile,address,city,state,emergency_contact)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET identity_status=excluded.identity_status,id_type=excluded.id_type,id_last4=excluded.id_last4,aadhaar_status=excluded.aadhaar_status,face_status=excluded.face_status,fingerprint_status=excluded.fingerprint_status,mobile=excluded.mobile,address=excluded.address,city=excluded.city,state=excluded.state,emergency_contact=excluded.emergency_contact,updated_at=CURRENT_TIMESTAMP`)
 .run(wid,req.body.identity_status||'VERIFIED',req.body.id_type||'OTHER',req.body.id_last4||'',req.body.aadhaar_status||'NOT_VERIFIED',req.body.face_status||'NOT_ENROLLED',req.body.fingerprint_status||'NOT_ENROLLED',req.body.mobile||'',req.body.address||'',req.body.city||'',req.body.state||'',req.body.emergency_contact||'');
 res.json(db.prepare('SELECT * FROM worker_identity_profiles WHERE worker_id=?').get(wid));
});
app.get('/api/workers/:id/identity', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','VIEWER'), (req,res)=>{
 const wid=Number(req.params.id);
 res.json(db.prepare(`SELECT e.id,e.name,e.employee_code,e.employment_status,wip.* FROM employees e LEFT JOIN worker_identity_profiles wip ON wip.worker_id=e.id WHERE e.id=? AND e.factory_id=?`).get(wid,req.user.factory_id)||{error:'Worker not found'});
});
app.post('/api/workers/:id/employment-history', roles('OWNER','ADMIN'), (req,res)=>{
 const wid=Number(req.params.id);if(!db.prepare('SELECT id FROM employees WHERE id=? AND factory_id=?').get(wid,req.user.factory_id))return res.status(404).json({error:'Worker not found'});
 const type=req.body.employment_type||'TEMPORARY', permanent=type==='PERMANENT';
 const r=db.prepare(`INSERT INTO employment_history(worker_id,factory_id,employment_type,start_date,end_date,status,noc_required,noc_status,role_title,notes)
 VALUES(?,?,?,?,?,?,?,?,?,?)`).run(wid,req.user.factory_id,type,req.body.start_date||new Date().toISOString().slice(0,10),req.body.end_date||null,req.body.status||'ACTIVE',permanent?1:0,permanent?'NOT_REQUIRED':(req.body.noc_status||'NOT_REQUIRED'),req.body.role_title||'',req.body.notes||'');
 db.prepare('INSERT INTO security_audit_log(factory_id,user_id,action,target_type,target_id,details) VALUES(?,?,?,?,?,?)').run(req.user.factory_id,req.user.id||null,'EMPLOYMENT_HISTORY_ADD','WORKER',wid,`type=${type}`);
 res.status(201).json(db.prepare('SELECT * FROM employment_history WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/workers/:id/employment-history', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','VIEWER'), (req,res)=>{
 res.json(db.prepare(`SELECT eh.*,f.name factory_name FROM employment_history eh LEFT JOIN factories f ON f.id=eh.factory_id WHERE eh.worker_id=? ORDER BY eh.start_date DESC,eh.id DESC`).all(Number(req.params.id)));
});
app.post('/api/workers/:id/assignment', roles('OWNER','ADMIN','MANAGER','SUPERVISOR'), (req,res)=>{
 const wid=Number(req.params.id), type=req.body.assignment_type||'GENERAL';
 const r=db.prepare(`INSERT INTO worker_assignments(worker_id,factory_id,assignment_type,team_name,valid_from,valid_to,status)
 VALUES(?,?,?,?,?,?,?)`).run(wid,req.user.factory_id,type,req.body.team_name||'',req.body.valid_from||new Date().toISOString().slice(0,10),req.body.valid_to||null,req.body.status||'ACTIVE');
 res.status(201).json(db.prepare('SELECT * FROM worker_assignments WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/workers/:id/360', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','ACCOUNTS','VIEWER'), (req,res)=>{
 const wid=Number(req.params.id), factory=req.user.factory_id;
 const worker=db.prepare(`SELECT e.*,wip.* FROM employees e LEFT JOIN worker_identity_profiles wip ON wip.worker_id=e.id WHERE e.id=? AND e.factory_id=?`).get(wid,factory);
 if(!worker)return res.status(404).json({error:'Worker not found'});
 const employment=db.prepare(`SELECT eh.*,f.name factory_name FROM employment_history eh LEFT JOIN factories f ON f.id=eh.factory_id WHERE eh.worker_id=? ORDER BY eh.start_date DESC`).all(wid);
 const assignments=db.prepare('SELECT * FROM worker_assignments WHERE worker_id=? ORDER BY valid_from DESC').all(wid);
 const time=db.prepare('SELECT * FROM worker_time_events WHERE worker_id=? ORDER BY event_date DESC,id DESC LIMIT 30').all(wid);
 const advances=db.prepare('SELECT * FROM worker_advance_ledger WHERE worker_id=? ORDER BY entry_date DESC,id DESC LIMIT 30').all(wid);
 const flags=db.prepare(`SELECT * FROM labour_alerts WHERE worker_id=? ORDER BY created_at DESC LIMIT 30`).all(wid);
 res.json({worker,employment,assignments,time,advances,flags});
});

app.get('/api/association', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','VIEWER'), (req,res)=>{
 const memberships=db.prepare(`SELECT am.*,ma.name association_name,ma.city,ma.state,ma.review_committee_name FROM association_memberships am JOIN miller_associations ma ON ma.id=am.association_id WHERE am.factory_id=?`).all(req.user.factory_id);
 const notices=db.prepare(`SELECT an.* FROM association_notices an JOIN association_memberships am ON am.association_id=an.association_id WHERE am.factory_id=? AND an.active=1 ORDER BY an.published_at DESC LIMIT 50`).all(req.user.factory_id);
 res.json({memberships,notices});
});
app.post('/api/association', roles('OWNER'), (req,res)=>{
 const {name,city='',state='',review_committee_name='Special Review Committee'}=req.body;
 if(!name)return res.status(400).json({error:'name required'});
 const r=db.prepare('INSERT INTO miller_associations(name,city,state,review_committee_name) VALUES(?,?,?,?)').run(name,city,state,review_committee_name);
 db.prepare('INSERT INTO association_memberships(association_id,factory_id) VALUES(?,?)').run(r.lastInsertRowid,req.user.factory_id);
 res.status(201).json(db.prepare('SELECT * FROM miller_associations WHERE id=?').get(r.lastInsertRowid));
});
app.post('/api/association/:id/member', roles('OWNER'), (req,res)=>{
 const associationId=Number(req.params.id), factoryId=Number(req.body.factory_id);
 if(!factoryId)return res.status(400).json({error:'factory_id required'});
 db.prepare('INSERT OR IGNORE INTO association_memberships(association_id,factory_id) VALUES(?,?)').run(associationId,factoryId);
 res.json({ok:true,association_id:associationId,factory_id:factoryId});
});
app.post('/api/association/:id/notice', roles('OWNER','ADMIN'), (req,res)=>{
 const id=Number(req.params.id);if(!req.body.title||!req.body.body)return res.status(400).json({error:'title and body required'});
 const r=db.prepare('INSERT INTO association_notices(association_id,title,body,severity,source_type) VALUES(?,?,?,?,?)').run(id,req.body.title,req.body.body,req.body.severity||'INFO',req.body.source_type||'SYSTEM');
 res.status(201).json(db.prepare('SELECT * FROM association_notices WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/association/:id/committee', roles('OWNER','ADMIN','MANAGER','VIEWER'), (req,res)=>{
 res.json(db.prepare('SELECT * FROM association_committee_members WHERE association_id=? AND active=1 ORDER BY role,name').all(Number(req.params.id)));
});
app.post('/api/association/:id/committee', roles('OWNER'), (req,res)=>{
 if(!req.body.name||!req.body.role)return res.status(400).json({error:'name and role required'});
 const r=db.prepare('INSERT INTO association_committee_members(association_id,name,role) VALUES(?,?,?)').run(Number(req.params.id),req.body.name,req.body.role);
 res.status(201).json(db.prepare('SELECT * FROM association_committee_members WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/network/worker-check/:workerId', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const wid=Number(req.params.workerId), factoryId=req.user.factory_id;
 const permanent=db.prepare(`SELECT eh.*,f.name factory_name FROM employment_history eh LEFT JOIN factories f ON f.id=eh.factory_id
 WHERE eh.worker_id=? AND eh.employment_type='PERMANENT' AND eh.status='ACTIVE' LIMIT 1`).get(wid);
 let result='FREE_TO_WORK',requires=0,reason='No active permanent employment record found in the registered network.';
 if(permanent && permanent.factory_id!==factoryId){result='PERMANENT_ELSEWHERE';requires=1;reason='Active permanent employment found at another registered mill; NOC is required before outside work.'}
 else if(permanent && permanent.factory_id===factoryId){result='PERMANENT_HERE';requires=0;reason='Worker is permanently employed at this mill.'}
 const r=db.prepare('INSERT INTO network_worker_checks(worker_id,requesting_factory_id,result,permanent_factory_id,requires_noc,reason) VALUES(?,?,?,?,?,?)').run(wid,factoryId,result,permanent?.factory_id||null,requires,reason);
 res.json({check_id:r.lastInsertRowid,worker_id:wid,result,requires_noc:!!requires,reason,permanent_factory_id:permanent?.factory_id||null,permanent_factory_name:permanent?.factory_name||null});
});

app.post('/api/fatak/requirement', roles('OWNER','ADMIN','MANAGER','SUPERVISOR'), (req,res)=>{
 const date=req.body.work_date||new Date().toISOString().slice(0,10);
 const r=db.prepare(`INSERT INTO daily_labour_requirements(factory_id,work_date,required_count,reported_present,reported_absent,additional_required,status,created_by)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(factory_id,work_date) DO UPDATE SET required_count=excluded.required_count,reported_present=excluded.reported_present,reported_absent=excluded.reported_absent,additional_required=excluded.additional_required,status=excluded.status`).run(
 req.user.factory_id,date,Number(req.body.required_count||0),Number(req.body.reported_present||0),Number(req.body.reported_absent||0),Number(req.body.additional_required||0),req.body.status||'OPEN',req.user.id||null);
 res.json(db.prepare('SELECT * FROM daily_labour_requirements WHERE factory_id=? AND work_date=?').get(req.user.factory_id,date));
});
app.get('/api/fatak/requirement/:date', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','VIEWER'), (req,res)=>{
 res.json(db.prepare('SELECT * FROM daily_labour_requirements WHERE factory_id=? AND work_date=?').get(req.user.factory_id,req.params.date)||null);
});
app.post('/api/fatak/entry', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const wid=req.body.worker_id?Number(req.body.worker_id):null,date=req.body.work_date||new Date().toISOString().slice(0,10);
 let eligibility='FREE_TO_WORK',noc='NOT_REQUIRED',reason='No active permanent employment record found.';
 if(wid){
   const perm=db.prepare(`SELECT eh.*,f.name factory_name FROM employment_history eh LEFT JOIN factories f ON f.id=eh.factory_id WHERE eh.worker_id=? AND eh.employment_type='PERMANENT' AND eh.status='ACTIVE' LIMIT 1`).get(wid);
   if(perm && perm.factory_id!==req.user.factory_id){eligibility='NOC_REQUIRED';noc='REQUIRED';reason=`Permanent employment found at ${perm.factory_name||'another registered mill'}.`}
   else if(perm && perm.factory_id===req.user.factory_id){eligibility='PERMANENT_HERE';reason='Worker is permanently employed at this mill.'}
 }
 const r=db.prepare(`INSERT INTO fatak_entries(factory_id,worker_id,work_date,entry_type,checkin_at,assignment,rate,advance,eligibility,noc_status,entered_by)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.factory_id,wid,date,req.body.entry_type||'DAILY',req.body.checkin_at||new Date().toISOString(),req.body.assignment||'',Number(req.body.rate||0),Number(req.body.advance||0),eligibility,noc,req.user.id||null);
 res.status(201).json({entry:db.prepare('SELECT * FROM fatak_entries WHERE id=?').get(r.lastInsertRowid),eligibility,reason});
});
app.post('/api/fatak/:id/checkout', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const id=Number(req.params.id),e=db.prepare('SELECT * FROM fatak_entries WHERE id=? AND factory_id=?').get(id,req.user.factory_id);
 if(!e)return res.status(404).json({error:'Fatak entry not found'});
 if(e.eligibility==='NOC_REQUIRED')return res.status(403).json({error:'NOC required before this temporary work can be completed'});
 db.prepare('UPDATE fatak_entries SET checkout_at=?,status=? WHERE id=?').run(req.body.checkout_at||new Date().toISOString(),'COMPLETED',id);
 res.json(db.prepare('SELECT * FROM fatak_entries WHERE id=?').get(id));
});
app.get('/api/fatak/today/:date', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','ACCOUNTS','VIEWER'), (req,res)=>{
 const entries=db.prepare(`SELECT fe.*,e.name,e.employee_code FROM fatak_entries fe LEFT JOIN employees e ON e.id=fe.worker_id WHERE fe.factory_id=? AND fe.work_date=? ORDER BY fe.checkin_at`).all(req.user.factory_id,req.params.date);
 const reqt=db.prepare('SELECT * FROM daily_labour_requirements WHERE factory_id=? AND work_date=?').get(req.user.factory_id,req.params.date);
 res.json({requirement:reqt||null,entries});
});
app.post('/api/fatak/:id/settlement', roles('OWNER','ADMIN','ACCOUNTS'), (req,res)=>{
 const e=db.prepare('SELECT * FROM fatak_entries WHERE id=? AND factory_id=?').get(Number(req.params.id),req.user.factory_id);
 if(!e)return res.status(404).json({error:'Entry not found'});
 if(!e.checkout_at)return res.status(400).json({error:'Checkout required before settlement'});
 if(e.eligibility==='NOC_REQUIRED')return res.status(403).json({error:'NOC required'});
 const hours=Number(req.body.hours||0),base=Number(req.body.base_pay??e.rate),ot=Number(req.body.ot_pay||0),adv=Number(e.advance||0),net=base+ot-adv;
 const r=db.prepare(`INSERT INTO daily_labour_settlements(factory_id,fatak_entry_id,worker_id,work_date,hours,base_pay,ot_pay,advance,net_pay,approval_status)
 VALUES(?,?,?,?,?,?,?,?,?,'PENDING')`).run(req.user.factory_id,e.id,e.worker_id,e.work_date,hours,base,ot,adv,net);
 res.status(201).json(db.prepare('SELECT * FROM daily_labour_settlements WHERE id=?').get(r.lastInsertRowid));
});
app.post('/api/fatak/settlements/:id/approve', roles('OWNER','ADMIN'), (req,res)=>{
 const r=db.prepare('UPDATE daily_labour_settlements SET approval_status=?,approved_by=? WHERE id=? AND factory_id=?').run(req.body.approve===false?'REJECTED':'APPROVED',req.user.id||null,Number(req.params.id),req.user.factory_id);
 if(!r.changes)return res.status(404).json({error:'Settlement not found'});
 res.json(db.prepare('SELECT * FROM daily_labour_settlements WHERE id=?').get(Number(req.params.id)));
});

app.post('/api/hamal/teams', roles('OWNER','ADMIN','MANAGER'), (req,res)=>{
 const name=req.body.name||'Hamal Toli',count=Math.max(1,Math.min(15,Number(req.body.member_count||0)));
 const r=db.prepare('INSERT INTO hamal_teams(factory_id,name,team_leader_worker_id,member_count) VALUES(?,?,?,?)').run(req.user.factory_id,name,req.body.team_leader_worker_id?Number(req.body.team_leader_worker_id):null,count);
 res.status(201).json(db.prepare('SELECT * FROM hamal_teams WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/hamal/teams', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','VIEWER'), (req,res)=>{
 res.json(db.prepare(`SELECT ht.*,e.name leader_name FROM hamal_teams ht LEFT JOIN employees e ON e.id=ht.team_leader_worker_id WHERE ht.factory_id=? ORDER BY ht.name`).all(req.user.factory_id));
});
app.post('/api/hamal/teams/:id/members', roles('OWNER','ADMIN','MANAGER'), (req,res)=>{
 const tid=Number(req.params.id),team=db.prepare('SELECT * FROM hamal_teams WHERE id=? AND factory_id=?').get(tid,req.user.factory_id);
 if(!team)return res.status(404).json({error:'Team not found'});
 const active=db.prepare("SELECT COUNT(*) n FROM hamal_team_members WHERE team_id=? AND status='ACTIVE'").get(tid).n;
 if(active>=15)return res.status(400).json({error:'Hamal Toli cannot exceed 15 active members'});
 const wid=Number(req.body.worker_id);
 if(!wid)return res.status(400).json({error:'worker_id required'});
 db.prepare('INSERT OR IGNORE INTO hamal_team_members(team_id,worker_id,role) VALUES(?,?,?)').run(tid,wid,req.body.role||'HAMAL');
 db.prepare("UPDATE hamal_teams SET member_count=(SELECT COUNT(*) FROM hamal_team_members WHERE team_id=? AND status='ACTIVE') WHERE id=?").run(tid,tid);
 res.status(201).json(db.prepare(`SELECT htm.*,e.name,e.employee_code FROM hamal_team_members htm JOIN employees e ON e.id=htm.worker_id WHERE htm.id=last_insert_rowid()`).get()||{ok:true});
});
app.post('/api/hamal/attendance', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const tid=Number(req.body.team_id),wid=Number(req.body.worker_id),date=req.body.work_date||new Date().toISOString().slice(0,10);
 const team=db.prepare('SELECT * FROM hamal_teams WHERE id=? AND factory_id=?').get(tid,req.user.factory_id);
 if(!team)return res.status(404).json({error:'Team not found'});
 const member=db.prepare("SELECT * FROM hamal_team_members WHERE team_id=? AND worker_id=? AND status='ACTIVE'").get(tid,wid);
 if(!member)return res.status(400).json({error:'Worker is not an active member of this Hamal Toli'});
 db.prepare(`INSERT INTO hamal_team_attendance(team_id,worker_id,factory_id,work_date,checkin_at,present,job_type,job_location,rate,advance,notes)
 VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(team_id,worker_id,work_date) DO UPDATE SET checkin_at=excluded.checkin_at,present=excluded.present,job_type=excluded.job_type,job_location=excluded.job_location,rate=excluded.rate,advance=excluded.advance,notes=excluded.notes`)
 .run(tid,wid,req.user.factory_id,date,req.body.checkin_at||new Date().toISOString(),req.body.present===false?0:1,req.body.job_type||'',req.body.job_location||'',Number(req.body.rate||0),Number(req.body.advance||0),req.body.notes||'');
 res.json(db.prepare('SELECT * FROM hamal_team_attendance WHERE team_id=? AND worker_id=? AND work_date=?').get(tid,wid,date));
});
app.post('/api/hamal/attendance/:id/checkout', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const id=Number(req.params.id),a=db.prepare('SELECT * FROM hamal_team_attendance WHERE id=? AND factory_id=?').get(id,req.user.factory_id);
 if(!a)return res.status(404).json({error:'Attendance not found'});
 db.prepare('UPDATE hamal_team_attendance SET checkout_at=? WHERE id=?').run(req.body.checkout_at||new Date().toISOString(),id);
 res.json(db.prepare('SELECT * FROM hamal_team_attendance WHERE id=?').get(id));
});
app.post('/api/hamal/jobs', roles('OWNER','ADMIN','MANAGER','SUPERVISOR'), (req,res)=>{
 const r=db.prepare(`INSERT INTO hamal_job_orders(factory_id,team_id,work_date,job_type,location,quantity,unit,assigned_count,status)
 VALUES(?,?,?,?,?,?,?,?,?)`).run(req.user.factory_id,req.body.team_id?Number(req.body.team_id):null,req.body.work_date||new Date().toISOString().slice(0,10),req.body.job_type||'LOADING',req.body.location||'',Number(req.body.quantity||0),req.body.unit||'',Number(req.body.assigned_count||0),req.body.status||'OPEN');
 res.status(201).json(db.prepare('SELECT * FROM hamal_job_orders WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/hamal/today/:date', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','VIEWER'), (req,res)=>{
 const teams=db.prepare('SELECT * FROM hamal_teams WHERE factory_id=? AND status=? ORDER BY name').all(req.user.factory_id,'ACTIVE');
 const attendance=db.prepare(`SELECT hta.*,e.name,e.employee_code,ht.name team_name FROM hamal_team_attendance hta JOIN employees e ON e.id=hta.worker_id JOIN hamal_teams ht ON ht.id=hta.team_id WHERE hta.factory_id=? AND hta.work_date=? ORDER BY ht.name,e.name`).all(req.user.factory_id,req.params.date);
 const jobs=db.prepare('SELECT * FROM hamal_job_orders WHERE factory_id=? AND work_date=? ORDER BY id DESC').all(req.user.factory_id,req.params.date);
 res.json({teams,attendance,jobs});
});

app.post('/api/advances', roles('OWNER','ADMIN','MANAGER','SUPERVISOR'), (req,res)=>{
 const amount=Number(req.body.amount||0);if(amount<=0)return res.status(400).json({error:'amount must be positive'});
 const workerId=Number(req.body.worker_id);if(!workerId)return res.status(400).json({error:'worker_id required'});
 const r=db.prepare(`INSERT INTO worker_advance_ledger(factory_id,worker_id,entry_date,entry_type,amount,reference,reason,approval_status,created_by)
 VALUES(?,?,?,?,?,?,?,?,?)`).run(req.user.factory_id,workerId,req.body.entry_date||new Date().toISOString().slice(0,10),req.body.entry_type||'ADVANCE',amount,req.body.reference||'',req.body.reason||'',req.body.approval_status||'PENDING',req.user.id||null);
 res.status(201).json(db.prepare('SELECT * FROM worker_advance_ledger WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/advances/:workerId', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','ACCOUNTS','VIEWER'), (req,res)=>{
 res.json(db.prepare('SELECT * FROM worker_advance_ledger WHERE factory_id=? AND worker_id=? ORDER BY entry_date DESC,id DESC').all(req.user.factory_id,Number(req.params.workerId)));
});
app.post('/api/advances/:id/approve', roles('OWNER','ADMIN'), (req,res)=>{
 const status=req.body.approve===false?'REJECTED':'APPROVED';
 const r=db.prepare('UPDATE worker_advance_ledger SET approval_status=?,approved_by=? WHERE id=? AND factory_id=?').run(status,req.user.id||null,Number(req.params.id),req.user.factory_id);
 if(!r.changes)return res.status(404).json({error:'Advance not found'});
 res.json(db.prepare('SELECT * FROM worker_advance_ledger WHERE id=?').get(Number(req.params.id)));
});
app.post('/api/payroll/periods', roles('OWNER','ADMIN','ACCOUNTS'), (req,res)=>{
 const a=req.body.period_start,b=req.body.period_end;if(!a||!b)return res.status(400).json({error:'period_start and period_end required'});
 const r=db.prepare(`INSERT INTO payroll_periods(factory_id,period_start,period_end,created_by) VALUES(?,?,?,?) ON CONFLICT(factory_id,period_start,period_end) DO UPDATE SET status='OPEN'`).run(req.user.factory_id,a,b,req.user.id||null);
 res.status(201).json(db.prepare('SELECT * FROM payroll_periods WHERE factory_id=? AND period_start=? AND period_end=?').get(req.user.factory_id,a,b));
});
app.post('/api/payroll/:periodId/line', roles('OWNER','ADMIN','ACCOUNTS'), (req,res)=>{
 const pid=Number(req.params.periodId),p=db.prepare('SELECT * FROM payroll_periods WHERE id=? AND factory_id=?').get(pid,req.user.factory_id);
 if(!p)return res.status(404).json({error:'Payroll period not found'});
 const workerId=Number(req.body.worker_id),days=Number(req.body.days||0),hours=Number(req.body.hours||0),base=Number(req.body.base_pay||0),ot=Number(req.body.ot_pay||0);
 const advances=db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM worker_advance_ledger WHERE factory_id=? AND worker_id=? AND entry_date BETWEEN ? AND ? AND approval_status='APPROVED'`).get(req.user.factory_id,workerId,p.period_start,p.period_end).n;
 const deduction=Number(req.body.advance_deduction??advances),other=Number(req.body.other_deduction||0),net=base+ot-deduction-other;
 const category=req.body.worker_category||'PERMANENT';
 const r=db.prepare(`INSERT INTO payroll_lines(period_id,factory_id,worker_id,worker_category,days,hours,base_pay,ot_pay,advance_deduction,other_deduction,net_pay,status)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,'DRAFT') ON CONFLICT(period_id,worker_id,worker_category) DO UPDATE SET days=excluded.days,hours=excluded.hours,base_pay=excluded.base_pay,ot_pay=excluded.ot_pay,advance_deduction=excluded.advance_deduction,other_deduction=excluded.other_deduction,net_pay=excluded.net_pay,status='DRAFT'`)
 .run(pid,req.user.factory_id,workerId,category,days,hours,base,ot,deduction,other,net);
 res.status(201).json(db.prepare('SELECT * FROM payroll_lines WHERE period_id=? AND worker_id=? AND worker_category=?').get(pid,workerId,category));
});
app.get('/api/payroll/:periodId', roles('OWNER','ADMIN','MANAGER','ACCOUNTS','VIEWER'), (req,res)=>{
 const pid=Number(req.params.periodId),p=db.prepare('SELECT * FROM payroll_periods WHERE id=? AND factory_id=?').get(pid,req.user.factory_id);
 if(!p)return res.status(404).json({error:'Payroll period not found'});
 const lines=db.prepare(`SELECT pl.*,e.name,e.employee_code FROM payroll_lines pl LEFT JOIN employees e ON e.id=pl.worker_id WHERE pl.period_id=? ORDER BY e.name`).all(pid);
 const totals=db.prepare('SELECT COALESCE(SUM(base_pay),0) base,COALESCE(SUM(ot_pay),0) ot,COALESCE(SUM(advance_deduction),0) advances,COALESCE(SUM(other_deduction),0) other,COALESCE(SUM(net_pay),0) net FROM payroll_lines WHERE period_id=?').get(pid);
 res.json({period:p,lines,totals});
});
app.post('/api/payroll/:periodId/approve', roles('OWNER','ADMIN'), (req,res)=>{
 const pid=Number(req.params.periodId);
 const r=db.prepare("UPDATE payroll_periods SET status='APPROVED',approved_by=? WHERE id=? AND factory_id=?").run(req.user.id||null,pid,req.user.factory_id);
 if(!r.changes)return res.status(404).json({error:'Payroll period not found'});
 db.prepare("UPDATE payroll_lines SET status='APPROVED' WHERE period_id=?").run(pid);
 res.json(db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(pid));
});
app.post('/api/payroll/lines/:id/pay', roles('OWNER','ADMIN','ACCOUNTS'), (req,res)=>{
 const line=db.prepare('SELECT * FROM payroll_lines WHERE id=? AND factory_id=?').get(Number(req.params.id),req.user.factory_id);
 if(!line)return res.status(404).json({error:'Payroll line not found'});
 const period=db.prepare("SELECT * FROM payroll_periods WHERE id=?").get(line.period_id);
 if(!period||period.status!=='APPROVED')return res.status(400).json({error:'Payroll period must be approved before payment'});
 const amount=Number(req.body.amount??line.net_pay);
 const r=db.prepare(`INSERT INTO payroll_payments(payroll_line_id,factory_id,worker_id,payment_date,amount,payment_mode,reference,paid_by)
 VALUES(?,?,?,?,?,?,?,?)`).run(line.id,req.user.factory_id,line.worker_id,req.body.payment_date||new Date().toISOString().slice(0,10),amount,req.body.payment_mode||'CASH',req.body.reference||'',req.user.id||null);
 db.prepare("UPDATE payroll_lines SET status='PAID' WHERE id=?").run(line.id);
 res.status(201).json(db.prepare('SELECT * FROM payroll_payments WHERE id=?').get(r.lastInsertRowid));
});

app.get('/api/dashboard/owner/:date', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','ACCOUNTS','VIEWER'), (req,res)=>{
 const fid=req.user.factory_id,date=req.params.date;
 const employees=db.prepare("SELECT COUNT(*) n FROM employees WHERE factory_id=? AND status='ACTIVE'").get(fid).n;
 const present=db.prepare(`SELECT COUNT(DISTINCT worker_id) n FROM attendance WHERE factory_id=? AND date=? AND status='PRESENT'`).get(fid,date).n;
 const absent=Math.max(0,employees-present);
 const daily=db.prepare("SELECT COUNT(*) n FROM fatak_entries WHERE factory_id=? AND work_date=? AND status IN ('ACTIVE','COMPLETED') AND entry_type='DAILY'").get(fid,date).n;
 const hamal=db.prepare("SELECT COUNT(*) n FROM hamal_team_attendance WHERE factory_id=? AND work_date=? AND present=1").get(fid,date).n;
 const noc=db.prepare("SELECT COUNT(*) n FROM fatak_entries WHERE factory_id=? AND work_date=? AND eligibility='NOC_REQUIRED'").get(fid,date).n;
 const openAlerts=db.prepare("SELECT COUNT(*) n FROM factory_alerts WHERE factory_id=? AND status='OPEN'").get(fid).n;
 const adv=db.prepare("SELECT COALESCE(SUM(amount),0) n FROM worker_advance_ledger WHERE factory_id=? AND approval_status='PENDING'").get(fid).n;
 const payroll=db.prepare("SELECT COALESCE(SUM(net_pay),0) n FROM payroll_lines WHERE factory_id=? AND status IN ('DRAFT','APPROVED')").get(fid).n;
 const requirement=db.prepare("SELECT * FROM daily_labour_requirements WHERE factory_id=? AND work_date=?").get(fid,date)||null;
 const jobs=db.prepare("SELECT COUNT(*) n FROM hamal_job_orders WHERE factory_id=? AND work_date=? AND status IN ('OPEN','IN_PROGRESS')").get(fid,date).n;
 res.json({date,employees,present,absent,daily_labour:daily,hamal_present:hamal,noc_cases:noc,open_alerts:openAlerts,pending_advances:adv,pending_payroll:payroll,open_hamal_jobs:jobs,requirement});
});
app.get('/api/dashboard/alerts', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','ACCOUNTS','VIEWER'), (req,res)=>{
 res.json(db.prepare("SELECT * FROM factory_alerts WHERE factory_id=? AND status='OPEN' ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,created_at DESC").all(req.user.factory_id));
});
app.post('/api/dashboard/alerts', roles('OWNER','ADMIN','MANAGER'), (req,res)=>{
 const r=db.prepare(`INSERT INTO factory_alerts(factory_id,alert_type,severity,title,message,entity_type,entity_id)
 VALUES(?,?,?,?,?,?,?)`).run(req.user.factory_id,req.body.alert_type||'GENERAL',req.body.severity||'INFO',req.body.title||'Factory alert',req.body.message||'',req.body.entity_type||null,req.body.entity_id?Number(req.body.entity_id):null);
 res.status(201).json(db.prepare('SELECT * FROM factory_alerts WHERE id=?').get(r.lastInsertRowid));
});
app.post('/api/dashboard/alerts/:id/ack', roles('OWNER','ADMIN','MANAGER','SUPERVISOR'), (req,res)=>{
 const r=db.prepare("UPDATE factory_alerts SET status='ACKNOWLEDGED',acknowledged_by=?,acknowledged_at=CURRENT_TIMESTAMP WHERE id=? AND factory_id=?").run(req.user.id||null,Number(req.params.id),req.user.factory_id);
 if(!r.changes)return res.status(404).json({error:'Alert not found'});
 res.json(db.prepare('SELECT * FROM factory_alerts WHERE id=?').get(Number(req.params.id)));
});
app.post('/api/dashboard/snapshot/:date', roles('OWNER','ADMIN','MANAGER'), (req,res)=>{
 const fid=req.user.factory_id,date=req.params.date;
 const employees=db.prepare("SELECT COUNT(*) n FROM employees WHERE factory_id=? AND status='ACTIVE'").get(fid).n;
 const present=db.prepare(`SELECT COUNT(DISTINCT worker_id) n FROM attendance WHERE factory_id=? AND date=? AND status='PRESENT'`).get(fid,date).n;
 const absent=Math.max(0,employees-present),daily=db.prepare("SELECT COUNT(*) n FROM fatak_entries WHERE factory_id=? AND work_date=? AND entry_type='DAILY'").get(fid,date).n;
 const hamal=db.prepare("SELECT COUNT(*) n FROM hamal_team_attendance WHERE factory_id=? AND work_date=? AND present=1").get(fid,date).n;
 const noc=db.prepare("SELECT COUNT(*) n FROM fatak_entries WHERE factory_id=? AND work_date=? AND eligibility='NOC_REQUIRED'").get(fid,date).n;
 const flags=db.prepare("SELECT COUNT(*) n FROM factory_alerts WHERE factory_id=? AND status='OPEN' AND alert_type='RED_FLAG'").get(fid).n;
 const adv=db.prepare("SELECT COALESCE(SUM(amount),0) n FROM worker_advance_ledger WHERE factory_id=? AND approval_status='PENDING'").get(fid).n;
 const pay=db.prepare("SELECT COALESCE(SUM(net_pay),0) n FROM payroll_lines WHERE factory_id=? AND status IN ('DRAFT','APPROVED')").get(fid).n;
 db.prepare(`INSERT INTO dashboard_snapshots(factory_id,snapshot_date,present_count,absent_count,daily_labour_count,hamal_present_count,open_red_flags,noc_cases,pending_advances,pending_payroll)
 VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(factory_id,snapshot_date) DO UPDATE SET present_count=excluded.present_count,absent_count=excluded.absent_count,daily_labour_count=excluded.daily_labour_count,hamal_present_count=excluded.hamal_present_count,open_red_flags=excluded.open_red_flags,noc_cases=excluded.noc_cases,pending_advances=excluded.pending_advances,pending_payroll=excluded.pending_payroll`)
 .run(fid,date,present,absent,daily,hamal,flags,noc,adv,pay);
 res.json(db.prepare("SELECT * FROM dashboard_snapshots WHERE factory_id=? AND snapshot_date=?").get(fid,date));
});

app.post('/api/attendance/events', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const workerId=Number(req.body.worker_id),now=new Date(),date=req.body.event_date||now.toISOString().slice(0,10),time=req.body.event_time||now.toISOString();
 if(!workerId)return res.status(400).json({error:'worker_id required'});
 const type=req.body.event_type||'IN',source=req.body.source||'MANUAL';
 const r=db.prepare(`INSERT INTO attendance_events(factory_id,worker_id,event_date,event_time,event_type,source,device_id,latitude,longitude,created_by)
 VALUES(?,?,?,?,?,?,?,?,?,?)`).run(req.user.factory_id,workerId,date,time,type,source,req.body.device_id||null,req.body.latitude??null,req.body.longitude??null,req.user.id||null);
 res.status(201).json(db.prepare('SELECT * FROM attendance_events WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/attendance/worker/:workerId/:date', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','ACCOUNTS','VIEWER'), (req,res)=>{
 res.json(db.prepare('SELECT * FROM attendance_events WHERE factory_id=? AND worker_id=? AND event_date=? ORDER BY event_time').all(req.user.factory_id,Number(req.params.workerId),req.params.date));
});
app.post('/api/attendance/corrections', roles('OWNER','ADMIN','MANAGER','SUPERVISOR'), (req,res)=>{
 const r=db.prepare(`INSERT INTO attendance_corrections(factory_id,worker_id,attendance_id,correction_type,old_value,new_value,reason,requested_by)
 VALUES(?,?,?,?,?,?,?,?)`).run(req.user.factory_id,Number(req.body.worker_id),req.body.attendance_id?Number(req.body.attendance_id):null,req.body.correction_type||'TIME',String(req.body.old_value??''),String(req.body.new_value??''),req.body.reason||'',req.user.id||null);
 res.status(201).json(db.prepare('SELECT * FROM attendance_corrections WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/attendance/corrections', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','VIEWER'), (req,res)=>{
 const status=req.query.status||'PENDING';
 res.json(db.prepare('SELECT * FROM attendance_corrections WHERE factory_id=? AND status=? ORDER BY created_at DESC').all(req.user.factory_id,status));
});
app.post('/api/attendance/corrections/:id/review', roles('OWNER','ADMIN'), (req,res)=>{
 const status=req.body.approve===true?'APPROVED':'REJECTED';
 const r=db.prepare("UPDATE attendance_corrections SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND factory_id=? AND status='PENDING'").run(status,req.user.id||null,Number(req.params.id),req.user.factory_id);
 if(!r.changes)return res.status(404).json({error:'Pending correction not found'});
 res.json(db.prepare('SELECT * FROM attendance_corrections WHERE id=?').get(Number(req.params.id)));
});
app.post('/api/attendance/shifts', roles('OWNER','ADMIN'), (req,res)=>{
 const r=db.prepare(`INSERT INTO attendance_shifts(factory_id,name,start_time,end_time,grace_minutes,overtime_after_minutes)
 VALUES(?,?,?,?,?,?)`).run(req.user.factory_id,req.body.name||'General',req.body.start_time||'08:30',req.body.end_time||'17:30',Number(req.body.grace_minutes||0),Number(req.body.overtime_after_minutes||0));
 res.status(201).json(db.prepare('SELECT * FROM attendance_shifts WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/attendance/shifts', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','VIEWER'), (req,res)=>{
 res.json(db.prepare("SELECT * FROM attendance_shifts WHERE factory_id=? AND status='ACTIVE' ORDER BY start_time").all(req.user.factory_id));
});
app.post('/api/attendance/summary/:workerId/:date', roles('OWNER','ADMIN','MANAGER','SUPERVISOR'), (req,res)=>{
 const wid=Number(req.params.workerId),date=req.params.date,events=db.prepare('SELECT * FROM attendance_events WHERE factory_id=? AND worker_id=? AND event_date=? ORDER BY event_time').all(req.user.factory_id,wid,date);
 const ins=events.filter(e=>e.event_type==='IN'),outs=events.filter(e=>e.event_type==='OUT');
 const first=ins[0]?.event_time||null,last=outs.length?outs[outs.length-1].event_time:null;
 let mins=0;if(first&&last)mins=Math.max(0,Math.round((new Date(last)-new Date(first))/60000));
 const shift=db.prepare("SELECT * FROM attendance_shifts WHERE factory_id=? AND status='ACTIVE' ORDER BY id LIMIT 1").get(req.user.factory_id);
 let late=0,ot=0;
 if(shift&&first){const f=new Date(first),p=shift.start_time.split(':').map(Number);const scheduled=new Date(f);scheduled.setHours(p[0],p[1],0,0);late=Math.max(0,Math.round((f-scheduled)/60000)-shift.grace_minutes);}
 if(shift){const p=shift.end_time.split(':').map(Number);if(last){const o=new Date(last),scheduled=new Date(o);scheduled.setHours(p[0],p[1],0,0);ot=Math.max(0,Math.round((o-scheduled)/60000)-shift.overtime_after_minutes);}}
 db.prepare(`INSERT INTO attendance_daily_summary(factory_id,worker_id,work_date,first_in,last_out,total_minutes,late_minutes,overtime_minutes)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(factory_id,worker_id,work_date) DO UPDATE SET first_in=excluded.first_in,last_out=excluded.last_out,total_minutes=excluded.total_minutes,late_minutes=excluded.late_minutes,overtime_minutes=excluded.overtime_minutes,status='CALCULATED'`)
 .run(req.user.factory_id,wid,date,first,last,mins,late,ot);
 res.json(db.prepare('SELECT * FROM attendance_daily_summary WHERE factory_id=? AND worker_id=? AND work_date=?').get(req.user.factory_id,wid,date));
});
app.get('/api/attendance/summary/:date', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','ACCOUNTS','VIEWER'), (req,res)=>{
 res.json(db.prepare(`SELECT s.*,e.name,e.employee_code FROM attendance_daily_summary s LEFT JOIN employees e ON e.id=s.worker_id WHERE s.factory_id=? AND s.work_date=? ORDER BY e.name`).all(req.user.factory_id,req.params.date));
});

app.get('/api/workers/:workerId/360', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','ACCOUNTS','VIEWER'), (req,res)=>{
 const fid=req.user.factory_id,wid=Number(req.params.workerId);
 const worker=db.prepare('SELECT * FROM employees WHERE id=? AND factory_id=?').get(wid,fid);
 if(!worker)return res.status(404).json({error:'Worker not found'});
 const documents=db.prepare('SELECT * FROM worker_documents WHERE worker_id=? AND factory_id=? ORDER BY created_at DESC').all(wid,fid);
 const employment=db.prepare('SELECT * FROM worker_employment_history WHERE worker_id=? ORDER BY start_date DESC,created_at DESC').all(wid);
 const attendance=db.prepare(`SELECT * FROM attendance_daily_summary WHERE worker_id=? AND factory_id=? ORDER BY work_date DESC LIMIT 30`).all(wid,fid);
 const events=db.prepare(`SELECT * FROM attendance_events WHERE worker_id=? AND factory_id=? ORDER BY event_date DESC,event_time DESC LIMIT 50`).all(wid,fid);
 const advances=db.prepare('SELECT * FROM worker_advance_ledger WHERE worker_id=? AND factory_id=? ORDER BY entry_date DESC,id DESC LIMIT 50').all(wid,fid);
 const payroll=db.prepare(`SELECT pl.*,pp.period_start,pp.period_end,pp.status period_status FROM payroll_lines pl LEFT JOIN payroll_periods pp ON pp.id=pl.period_id WHERE pl.worker_id=? AND pl.factory_id=? ORDER BY pp.period_end DESC LIMIT 30`).all(wid,fid);
 const payments=db.prepare('SELECT * FROM payroll_payments WHERE worker_id=? AND factory_id=? ORDER BY payment_date DESC,id DESC LIMIT 30').all(wid,fid);
 const corrections=db.prepare('SELECT * FROM attendance_corrections WHERE worker_id=? AND factory_id=? ORDER BY created_at DESC LIMIT 30').all(wid,fid);
 const noc=db.prepare('SELECT * FROM worker_noc_records WHERE worker_id=? ORDER BY created_at DESC LIMIT 30').all(wid);
 const fatak=db.prepare("SELECT * FROM fatak_entries WHERE worker_id=? AND factory_id=? ORDER BY work_date DESC LIMIT 30").all(wid,fid);
 const hamal=db.prepare("SELECT * FROM hamal_team_members WHERE worker_id=? AND factory_id=? ORDER BY created_at DESC").all(wid,fid);
 const redFlags=db.prepare("SELECT * FROM factory_alerts WHERE entity_type='WORKER' AND entity_id=? AND alert_type='RED_FLAG' ORDER BY created_at DESC").all(wid);
 res.json({worker,documents,employment,attendance,events,advances,payroll,payments,corrections,noc,fatak,hamal,red_flags:redFlags});
});
app.post('/api/workers/:workerId/documents', roles('OWNER','ADMIN','MANAGER'), (req,res)=>{
 const wid=Number(req.params.workerId);
 const r=db.prepare(`INSERT INTO worker_documents(factory_id,worker_id,document_type,document_number_masked,verification_status,notes)
 VALUES(?,?,?,?,?,?)`).run(req.user.factory_id,wid,req.body.document_type||'AADHAAR',req.body.document_number_masked||'',req.body.verification_status||'PENDING',req.body.notes||'');
 res.status(201).json(db.prepare('SELECT * FROM worker_documents WHERE id=?').get(r.lastInsertRowid));
});
app.post('/api/workers/:workerId/documents/:id/verify', roles('OWNER','ADMIN'), (req,res)=>{
 const status=req.body.verify===false?'REJECTED':'VERIFIED';
 const r=db.prepare("UPDATE worker_documents SET verification_status=?,verified_by=?,verified_at=CURRENT_TIMESTAMP WHERE id=? AND worker_id=? AND factory_id=?").run(status,req.user.id||null,Number(req.params.id),Number(req.params.workerId),req.user.factory_id);
 if(!r.changes)return res.status(404).json({error:'Document not found'});
 res.json(db.prepare('SELECT * FROM worker_documents WHERE id=?').get(Number(req.params.id)));
});
app.post('/api/workers/:workerId/employment-history', roles('OWNER','ADMIN'), (req,res)=>{
 const wid=Number(req.params.workerId);
 const r=db.prepare(`INSERT INTO worker_employment_history(worker_id,factory_id,employer_name,employment_type,start_date,end_date,status,noc_status,source)
 VALUES(?,?,?,?,?,?,?,?,?)`).run(wid,req.user.factory_id,req.body.employer_name||'',req.body.employment_type||'PERMANENT',req.body.start_date||null,req.body.end_date||null,req.body.status||'HISTORICAL',req.body.noc_status||null,req.body.source||'MANUAL');
 res.status(201).json(db.prepare('SELECT * FROM worker_employment_history WHERE id=?').get(r.lastInsertRowid));
});
app.post('/api/workers/:workerId/noc', roles('OWNER','ADMIN','MANAGER'), (req,res)=>{
 const wid=Number(req.params.workerId);
 const r=db.prepare(`INSERT INTO worker_noc_records(worker_id,factory_id,from_factory_id,to_factory_id,issue_date,status,reason)
 VALUES(?,?,?,?,?, ?,?)`).run(wid,req.user.factory_id,req.body.from_factory_id?Number(req.body.from_factory_id):req.user.factory_id,req.body.to_factory_id?Number(req.body.to_factory_id):null,req.body.issue_date||new Date().toISOString().slice(0,10),req.body.status||'PENDING',req.body.reason||'');
 res.status(201).json(db.prepare('SELECT * FROM worker_noc_records WHERE id=?').get(r.lastInsertRowid));
});

app.post('/api/risk/employment-status', roles('OWNER','ADMIN'), (req,res)=>{
 const wid=Number(req.body.worker_id),type=req.body.employment_type||'PERMANENT',status=req.body.status||'ACTIVE';
 const r=db.prepare(`INSERT INTO worker_employment_status(worker_id,factory_id,employment_type,status,start_date,end_date,noc_required,noc_status)
 VALUES(?,?,?,?,?,?,?,?)`).run(wid,req.user.factory_id,type,status,req.body.start_date||new Date().toISOString().slice(0,10),req.body.end_date||null,type==='PERMANENT'?1:0,type==='PERMANENT'?'NOT_REQUIRED':'NOT_REQUIRED');
 res.status(201).json(db.prepare('SELECT * FROM worker_employment_status WHERE id=?').get(r.lastInsertRowid));
});
app.post('/api/risk/check-gate', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const wid=Number(req.body.worker_id),fid=req.user.factory_id,date=req.body.decision_date||new Date().toISOString().slice(0,10);
 const active=db.prepare(`SELECT * FROM worker_employment_status WHERE worker_id=? AND status='ACTIVE' AND employment_type='PERMANENT' AND factory_id<>? ORDER BY start_date DESC LIMIT 1`).get(wid,fid);
 if(!active){
   const r=db.prepare(`INSERT INTO worker_gate_decisions(worker_id,factory_id,decision_date,decision,reason,decided_by) VALUES(?,?,?,?,?,?)`).run(wid,fid,date,'ALLOW','No active permanent employment conflict found',req.user.id||null);
   return res.json({decision:'ALLOW',reason:'Temporary labour is free to work here when no active permanent record exists in another registered mill.',gate_decision_id:r.lastInsertRowid});
 }
 const existing=db.prepare("SELECT * FROM redflag_cases WHERE worker_id=? AND reported_factory_id=? AND status='OPEN' ORDER BY id DESC LIMIT 1").get(wid,fid);
 let caseId=existing?.id;
 if(!caseId){
   const c=db.prepare(`INSERT INTO redflag_cases(worker_id,reported_factory_id,permanent_factory_id,case_type,rule_code,severity,status,penalty_status)
   VALUES(?,?,?,?,?,'HIGH','OPEN','NOT_APPLICABLE')`).run(wid,fid,active.factory_id,'PERMANENT_EMPLOYMENT_CONFLICT','PERM-OTHER-MILL');
   caseId=c.lastInsertRowid;
   db.prepare(`INSERT INTO factory_alerts(factory_id,alert_type,severity,title,message,entity_type,entity_id)
   VALUES(?,?,?,?,?,?,?)`).run(fid,'RED_FLAG','HIGH','Permanent employment conflict','Gate check found an active permanent employment record at another registered mill. NOC required.','WORKER',wid);
 }
 const noc=db.prepare("SELECT * FROM worker_noc_records WHERE worker_id=? AND to_factory_id=? AND status='APPROVED' ORDER BY id DESC LIMIT 1").get(wid,fid);
 if(noc){
   const r=db.prepare(`INSERT INTO worker_gate_decisions(worker_id,factory_id,decision_date,decision,reason,redflag_case_id,noc_id,decided_by) VALUES(?,?,?,?,?,?,?,?)`).run(wid,fid,date,'ALLOW_WITH_NOC','Approved NOC found',caseId,noc.id,req.user.id||null);
   return res.json({decision:'ALLOW_WITH_NOC',reason:'Approved NOC permits temporary/other work under association rules.',redflag_case_id:caseId,noc_id:noc.id,gate_decision_id:r.lastInsertRowid});
 }
 const r=db.prepare(`INSERT INTO worker_gate_decisions(worker_id,factory_id,decision_date,decision,reason,redflag_case_id,decided_by) VALUES(?,?,?,?,?,?,?)`).run(wid,fid,date,'HOLD','Active permanent employment at another registered mill; NOC required before this worker can be engaged.',caseId,req.user.id||null);
 res.json({decision:'HOLD',reason:'Active permanent employment conflict. NOC required.',redflag_case_id:caseId,gate_decision_id:r.lastInsertRowid});
});
app.get('/api/risk/redflags', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','VIEWER'), (req,res)=>{
 const rows=db.prepare(`SELECT r.*,e.name,e.employee_code FROM redflag_cases r LEFT JOIN employees e ON e.id=r.worker_id WHERE r.reported_factory_id=? ORDER BY CASE r.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,r.detected_at DESC`).all(req.user.factory_id);
 res.json(rows);
});
app.post('/api/risk/redflags/:id/review', roles('OWNER','ADMIN'), (req,res)=>{
 const status=req.body.status||'RESOLVED',resolution=req.body.resolution||'';
 const r=db.prepare("UPDATE redflag_cases SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,resolution=? WHERE id=? AND reported_factory_id=?").run(status,req.user.id||null,resolution,Number(req.params.id),req.user.factory_id);
 if(!r.changes)return res.status(404).json({error:'Red flag case not found'});
 if(status!=='OPEN')db.prepare("UPDATE factory_alerts SET status='ACKNOWLEDGED',acknowledged_by=?,acknowledged_at=CURRENT_TIMESTAMP WHERE factory_id=? AND entity_type='WORKER' AND entity_id=(SELECT worker_id FROM redflag_cases WHERE id=?) AND alert_type='RED_FLAG' AND status='OPEN'").run(req.user.id||null,req.user.factory_id,Number(req.params.id));
 res.json(db.prepare('SELECT * FROM redflag_cases WHERE id=?').get(Number(req.params.id)));
});
app.post('/api/risk/noc', roles('OWNER','ADMIN'), (req,res)=>{
 const wid=Number(req.body.worker_id),toFactory=req.body.to_factory_id?Number(req.body.to_factory_id):req.user.factory_id;
 const r=db.prepare(`INSERT INTO worker_noc_records(worker_id,factory_id,from_factory_id,to_factory_id,issue_date,status,reason,approved_by)
 VALUES(?,?,?,?,?,?,?,?)`).run(wid,req.user.factory_id,req.body.from_factory_id?Number(req.body.from_factory_id):null,toFactory,req.body.issue_date||new Date().toISOString().slice(0,10),req.body.status||'APPROVED',req.body.reason||'',req.user.id||null);
 res.status(201).json(db.prepare('SELECT * FROM worker_noc_records WHERE id=?').get(r.lastInsertRowid));
});
app.post('/api/risk/association-case', roles('OWNER','ADMIN'), (req,res)=>{
 const r=db.prepare(`INSERT INTO association_cases(worker_id,reporting_factory_id,target_factory_id,case_type,severity,status,penalty_status,penalty_amount,notes)
 VALUES(?,?,?,?,?,?,?,?,?)`).run(req.body.worker_id?Number(req.body.worker_id):null,req.user.factory_id,req.body.target_factory_id?Number(req.body.target_factory_id):null,req.body.case_type||'EMPLOYMENT_RULE',req.body.severity||'HIGH','OPEN','PENDING',Number(req.body.penalty_amount||0),req.body.notes||'');
 res.status(201).json(db.prepare('SELECT * FROM association_cases WHERE id=?').get(r.lastInsertRowid));
});

app.get('/api/association/command-centre', roles('OWNER','ADMIN','ASSOCIATION_ADMIN','ASSOCIATION_REVIEWER','VIEWER'), (req,res)=>{
 const aid=Number(req.query.association_id||req.user.association_id||1);
 const association=db.prepare('SELECT * FROM associations WHERE id=?').get(aid);
 const members=db.prepare('SELECT * FROM association_members WHERE association_id=? AND status=? ORDER BY factory_id').all(aid,'ACTIVE');
 const committee=db.prepare('SELECT * FROM association_committee_members WHERE association_id=? AND status=? ORDER BY role,name').all(aid,'ACTIVE');
 const updates=db.prepare('SELECT * FROM association_updates WHERE association_id=? ORDER BY created_at DESC LIMIT 100').all(aid);
 const notices=db.prepare('SELECT * FROM association_notices WHERE association_id=? ORDER BY created_at DESC LIMIT 50').all(aid);
 const cases=db.prepare(`SELECT * FROM association_cases WHERE reporting_factory_id IN (SELECT factory_id FROM association_members WHERE association_id=?) ORDER BY created_at DESC LIMIT 100`).all(aid);
 const flags=db.prepare(`SELECT COUNT(*) n FROM redflag_cases WHERE reported_factory_id IN (SELECT factory_id FROM association_members WHERE association_id=?) AND status='OPEN'`).get(aid).n;
 const penalties=db.prepare(`SELECT COUNT(*) n FROM association_cases WHERE reporting_factory_id IN (SELECT factory_id FROM association_members WHERE association_id=?) AND penalty_status='PENDING'`).get(aid).n;
 res.json({association,members,committee,updates,notices,cases,metrics:{registered_mills:members.length,open_red_flags:flags,pending_penalties:penalties}});
});
app.post('/api/association/register', roles('OWNER','ADMIN','ASSOCIATION_ADMIN'), (req,res)=>{
 const aid=Number(req.body.association_id||req.user.association_id||1);
 db.prepare("INSERT OR IGNORE INTO associations(id,name,code) VALUES(?,?,?)").run(aid,req.body.name||'Millers Association',req.body.code||('ASSOC-'+aid));
 const fid=Number(req.body.factory_id||req.user.factory_id);
 db.prepare('INSERT OR IGNORE INTO association_members(association_id,factory_id,role) VALUES(?,?,?)').run(aid,fid,req.body.role||'MILLER');
 res.status(201).json(db.prepare('SELECT * FROM association_members WHERE association_id=? AND factory_id=?').get(aid,fid));
});
app.post('/api/association/committee', roles('OWNER','ADMIN','ASSOCIATION_ADMIN'), (req,res)=>{
 const aid=Number(req.body.association_id||req.user.association_id||1);
 const r=db.prepare('INSERT INTO association_committee_members(association_id,name,role) VALUES(?,?,?)').run(aid,req.body.name||'',req.body.role||'REVIEWER');
 res.status(201).json(db.prepare('SELECT * FROM association_committee_members WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/association/committee', roles('OWNER','ADMIN','ASSOCIATION_ADMIN','ASSOCIATION_REVIEWER','VIEWER'), (req,res)=>res.json(db.prepare("SELECT * FROM association_committee_members WHERE association_id=? AND status='ACTIVE' ORDER BY role,name").all(Number(req.query.association_id||req.user.association_id||1))));
app.post('/api/association/notices', roles('OWNER','ADMIN','ASSOCIATION_ADMIN'), (req,res)=>{
 const aid=Number(req.body.association_id||req.user.association_id||1),pub=!!req.body.publish;
 const r=db.prepare('INSERT INTO association_notices(association_id,title,message,audience,status,published_by,published_at) VALUES(?,?,?,?,?,?,?)').run(aid,req.body.title||'',req.body.message||'',req.body.audience||'ALL_MILLERS',pub?'PUBLISHED':'DRAFT',pub?(req.user.id||null):null,pub?new Date().toISOString():null);
 res.status(201).json(db.prepare('SELECT * FROM association_notices WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/association/notices', roles('OWNER','ADMIN','ASSOCIATION_ADMIN','ASSOCIATION_REVIEWER','VIEWER'), (req,res)=>res.json(db.prepare('SELECT * FROM association_notices WHERE association_id=? ORDER BY created_at DESC').all(Number(req.query.association_id||req.user.association_id||1))));
app.post('/api/association/sync', roles('OWNER','ADMIN','ASSOCIATION_ADMIN'), (req,res)=>{
 const aid=Number(req.body.association_id||req.user.association_id||1);
 const flags=db.prepare(`SELECT id,severity FROM redflag_cases WHERE reported_factory_id IN (SELECT factory_id FROM association_members WHERE association_id=?) AND status='OPEN' ORDER BY detected_at DESC LIMIT 100`).all(aid);
 const insert=db.prepare("INSERT INTO association_updates(association_id,update_type,title,message,severity,source_id) VALUES(?,?,?,?,?,?)");
 const tx=db.transaction(rows=>{for(const f of rows) insert.run(aid,'AUTO_RED_FLAG','System-generated red flag update','An open employer-sensitive rule case was detected for a registered mill.',f.severity||'HIGH',f.id)});
 tx(flags);
 res.json({generated_updates:flags.length});
});

app.get('/api/access/me', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','ACCOUNTS','ASSOCIATION_ADMIN','ASSOCIATION_REVIEWER','VIEWER'), (req,res)=>{
 const rolesForUser=db.prepare('SELECT * FROM user_role_assignments WHERE user_id=? AND status=?').all(req.user.id,'ACTIVE');
 const codes=rolesForUser.map(r=>r.role_code);
 const perms=db.prepare(`SELECT role_code,permission_code,scope FROM role_permissions WHERE allowed=1 AND role_code IN (${codes.map(()=>'?').join(',')||"''"})`).all(...codes);
 res.json({user_id:req.user.id,roles:rolesForUser,permissions:perms});
});
app.get('/api/access/roles', roles('OWNER','ADMIN','ASSOCIATION_ADMIN'), (req,res)=>{
 res.json(db.prepare('SELECT * FROM role_profiles WHERE active=1 ORDER BY level DESC,name').all());
});
app.post('/api/access/assign', roles('OWNER','ADMIN'), (req,res)=>{
 const r=db.prepare(`INSERT OR REPLACE INTO user_role_assignments(user_id,role_code,factory_id,association_id,status)
 VALUES(?,?,?,?,?)`).run(Number(req.body.user_id),req.body.role_code,req.body.factory_id?Number(req.body.factory_id):null,req.body.association_id?Number(req.body.association_id):null,req.body.status||'ACTIVE');
 res.status(201).json(db.prepare('SELECT * FROM user_role_assignments WHERE id=?').get(r.lastInsertRowid));
});
app.post('/api/access/seed', roles('OWNER','ADMIN'), (req,res)=>{
 const rolesSeed=[
 ['OWNER','Owner','Full factory control',100],
 ['ADMIN','Admin','System administration',90],
 ['MANAGER','Manager','Day-to-day factory operations',70],
 ['SUPERVISOR','Supervisor','Floor and workforce supervision',55],
 ['GATE_OPERATOR','Gate Operator','Worker identity and entry/exit',45],
 ['ACCOUNTS','Accounts','Advances, payroll and payments',45],
 ['ASSOCIATION_ADMIN','Association Admin','Association governance',80],
 ['ASSOCIATION_REVIEWER','Association Reviewer','Committee case review',60],
 ['VIEWER','Viewer','Read-only permitted views',10]
 ];
 const perms=[
 ['OWNER','ALL','FACTORY'],['ADMIN','ALL','FACTORY'],['MANAGER','WORKFORCE_READ','FACTORY'],['MANAGER','FATAK_MANAGE','FACTORY'],['MANAGER','HAMAL_MANAGE','FACTORY'],['MANAGER','ATTENDANCE_CORRECTION_REQUEST','FACTORY'],['MANAGER','PAYROLL_READ','FACTORY'],
 ['SUPERVISOR','WORKFORCE_READ','FACTORY'],['SUPERVISOR','ATTENDANCE_EVENT','FACTORY'],['SUPERVISOR','FATAK_MANAGE','FACTORY'],['SUPERVISOR','HAMAL_MANAGE','FACTORY'],
 ['GATE_OPERATOR','WORKER_VERIFY','FACTORY'],['GATE_OPERATOR','ATTENDANCE_EVENT','FACTORY'],['GATE_OPERATOR','FATAK_GATE','FACTORY'],
 ['ACCOUNTS','PAYROLL_READ','FACTORY'],['ACCOUNTS','ADVANCE_READ','FACTORY'],['ACCOUNTS','PAYMENT_CREATE','FACTORY'],
 ['ASSOCIATION_ADMIN','ASSOCIATION_NETWORK','ASSOCIATION'],['ASSOCIATION_ADMIN','ASSOCIATION_NOTICE','ASSOCIATION'],['ASSOCIATION_REVIEWER','ASSOCIATION_CASE_REVIEW','ASSOCIATION'],['VIEWER','DASHBOARD_READ','FACTORY']
 ];
 const tx=db.transaction(()=>{for(const r of rolesSeed)db.prepare('INSERT OR IGNORE INTO role_profiles(code,name,description,level) VALUES(?,?,?,?)').run(...r);for(const p of perms)db.prepare('INSERT OR IGNORE INTO role_permissions(role_code,permission_code,scope) VALUES(?,?,?)').run(...p)});
 tx();res.json({seeded:true,roles:rolesSeed.length,permissions:perms.length});
});
app.get('/api/access/role-matrix', roles('OWNER','ADMIN'), (req,res)=>{
 res.json(db.prepare(`SELECT rp.code,rp.name,rp.description,rp.level,rperm.permission_code,rperm.scope
 FROM role_profiles rp LEFT JOIN role_permissions rperm ON rperm.role_code=rp.code AND rperm.allowed=1 WHERE rp.active=1 ORDER BY rp.level DESC,rp.code,rperm.permission_code`).all());
});

app.get('/api/settings/language', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','ACCOUNTS','ASSOCIATION_ADMIN','ASSOCIATION_REVIEWER','VIEWER'), (req,res)=>{
 const p=db.prepare('SELECT language FROM user_preferences WHERE user_id=?').get(req.user.id);
 res.json({language:p?.language||'en',options:[{code:'en',label:'English'},{code:'hi',label:'हिन्दी'}]});
});
app.post('/api/settings/language', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','ACCOUNTS','ASSOCIATION_ADMIN','ASSOCIATION_REVIEWER','VIEWER'), (req,res)=>{
 const lang=req.body.language;
 if(!['en','hi'].includes(lang))return res.status(400).json({error:'Only English and Hindi are supported'});
 db.prepare(`INSERT INTO user_preferences(user_id,language) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET language=excluded.language,updated_at=CURRENT_TIMESTAMP`).run(req.user.id,lang);
 res.json({language:lang});
});

app.get('/api/system/health', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','ACCOUNTS','ASSOCIATION_ADMIN','ASSOCIATION_REVIEWER','VIEWER'), (req,res)=>{
 res.json({ok:true,version:'V57',system:'Mannat Workforce OS',modules:'integrated',timestamp:new Date().toISOString()});
});
app.get('/api/system/module-status', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','ACCOUNTS','ASSOCIATION_ADMIN','ASSOCIATION_REVIEWER','VIEWER'), (req,res)=>{
 res.json({version:'V57',modules:[
 {id:'command_centre',status:'integrated'},{id:'worker_360',status:'integrated'},{id:'attendance',status:'integrated'},
 {id:'fatak',status:'integrated'},{id:'hamal',status:'integrated'},{id:'finance',status:'integrated'},
 {id:'redflag',status:'integrated'},{id:'association',status:'integrated'},{id:'access',status:'integrated'},{id:'language',status:'integrated'}
 ],deferred:['labour_network_phase_2']});
});

app.get('/api/system/production-status', roles('OWNER','ADMIN'), (req,res)=>{
 const tables=['auth_users','auth_sessions','login_audit','system_devices','notification_queue','sync_queue'];
 const status={}; for(const t of tables) status[t]=!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
 res.json({version:'V58',status:'FOUNDATION_READY',tables:status,production_integrations:{
  authentication:'adapter-ready',biometric_face:'device-adapter-pending',aadhaar:'provider-pending',notifications:'queue-ready',offline_sync:'queue-ready',hosting:'deployment-pending'
 }});
});
app.post('/api/devices/register', roles('OWNER','ADMIN'), (req,res)=>{
 const r=db.prepare(`INSERT INTO system_devices(factory_id,device_type,name,device_identifier,config_json) VALUES(?,?,?,?,?)`).run(req.user.factory_id,req.body.device_type||'BIOMETRIC',req.body.name||'Gate Device',req.body.device_identifier||null,JSON.stringify(req.body.config||{}));
 res.status(201).json(db.prepare('SELECT * FROM system_devices WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/devices', roles('OWNER','ADMIN','MANAGER','GATE_OPERATOR'), (req,res)=>res.json(db.prepare('SELECT id,device_type,name,device_identifier,status,last_seen_at,created_at FROM system_devices WHERE factory_id=? ORDER BY id DESC').all(req.user.factory_id)));
app.post('/api/notifications/queue', roles('OWNER','ADMIN','MANAGER'), (req,res)=>{
 const r=db.prepare(`INSERT INTO notification_queue(factory_id,user_id,channel,event_type,title,message) VALUES(?,?,?,?,?,?)`).run(req.user.factory_id,req.body.user_id?Number(req.body.user_id):null,req.body.channel||'PUSH',req.body.event_type||'GENERAL',req.body.title||'',req.body.message||'');
 res.status(201).json(db.prepare('SELECT * FROM notification_queue WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/notifications/queue', roles('OWNER','ADMIN','MANAGER'), (req,res)=>res.json(db.prepare('SELECT * FROM notification_queue WHERE factory_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.factory_id)));
app.post('/api/sync/queue', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const r=db.prepare(`INSERT INTO sync_queue(factory_id,device_id,entity_type,entity_id,payload_json) VALUES(?,?,?,?,?)`).run(req.user.factory_id,req.body.device_id?Number(req.body.device_id):null,req.body.entity_type||'ATTENDANCE_EVENT',req.body.entity_id?Number(req.body.entity_id):null,JSON.stringify(req.body.payload||{}));
 res.status(201).json(db.prepare('SELECT * FROM sync_queue WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/sync/queue', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>res.json(db.prepare("SELECT * FROM sync_queue WHERE factory_id=? AND status='PENDING' ORDER BY created_at LIMIT 100").all(req.user.factory_id)));

app.post('/api/mobile-attendance/device/register', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const r=db.prepare(`INSERT INTO mobile_attendance_devices(factory_id,user_id,device_label,device_fingerprint) VALUES(?,?,?,?)`).run(req.user.factory_id,req.user.id||null,req.body.device_label||'Android Phone',req.body.device_fingerprint||null);
 res.status(201).json(db.prepare('SELECT id,factory_id,user_id,device_label,status,created_at FROM mobile_attendance_devices WHERE id=?').get(r.lastInsertRowid));
});
app.get('/api/mobile-attendance/devices', roles('OWNER','ADMIN','MANAGER'), (req,res)=>res.json(db.prepare('SELECT id,device_label,status,last_seen_at,created_at FROM mobile_attendance_devices WHERE factory_id=? ORDER BY id DESC').all(req.user.factory_id)));
app.post('/api/mobile-attendance/mark', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>{
 const wid=Number(req.body.worker_id),action=req.body.action==='OUT'?'OUT':'IN',method=req.body.verification_method||'MANUAL',clientId=req.body.client_event_id||null;
 if(!wid)return res.status(400).json({error:'worker_id required'});
 if(!['ANDROID_BIOMETRIC','FACE_CAMERA','MANUAL'].includes(method))return res.status(400).json({error:'Unsupported verification method'});
 const today=new Date().toISOString().slice(0,10);
 const last=db.prepare('SELECT * FROM attendance_events WHERE factory_id=? AND worker_id=? AND event_date=? ORDER BY event_time DESC LIMIT 1').get(req.user.factory_id,wid,today);
 if((action==='IN' && last?.event_type==='IN') || (action==='OUT' && (!last || last.event_type!=='IN'))){
   if(clientId)db.prepare(`INSERT OR IGNORE INTO mobile_attendance_attempts(factory_id,worker_id,user_id,device_id,verification_method,action,result,reason,client_event_id) VALUES(?,?,?,?,?,?,?,?,?)`).run(req.user.factory_id,wid,req.user.id||null,req.body.device_id?Number(req.body.device_id):null,method,action,'REJECTED','Duplicate or invalid IN/OUT sequence',clientId);
   return res.status(409).json({result:'REJECTED',reason:'Invalid or duplicate attendance sequence'});
 }
 const now=new Date().toISOString();
 const ev=db.prepare(`INSERT INTO attendance_events(factory_id,worker_id,event_date,event_time,event_type,source,device_id,created_by) VALUES(?,?,?,?,?,?,?,?)`).run(req.user.factory_id,wid,today,now,action,method,req.body.device_id?Number(req.body.device_id):null,req.user.id||null);
 db.prepare(`INSERT OR IGNORE INTO mobile_attendance_attempts(factory_id,worker_id,user_id,device_id,verification_method,action,result,reason,client_event_id) VALUES(?,?,?,?,?,?,?,?,?)`).run(req.user.factory_id,wid,req.user.id||null,req.body.device_id?Number(req.body.device_id):null,method,action,'ACCEPTED','Attendance event recorded',clientId);
 res.status(201).json({result:'ACCEPTED',attendance_event:db.prepare('SELECT * FROM attendance_events WHERE id=?').get(ev.lastInsertRowid)});
});
app.get('/api/mobile-attendance/today/:workerId', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR','ACCOUNTS','VIEWER'), (req,res)=>{
 const d=new Date().toISOString().slice(0,10);
 res.json(db.prepare('SELECT * FROM attendance_events WHERE factory_id=? AND worker_id=? AND event_date=? ORDER BY event_time').all(req.user.factory_id,Number(req.params.workerId),d));
});
app.get('/api/mobile-attendance/mode', roles('OWNER','ADMIN','MANAGER','SUPERVISOR','GATE_OPERATOR'), (req,res)=>res.json({mode:'MOBILE',methods:['ANDROID_BIOMETRIC','FACE_CAMERA','MANUAL'],offline_queue:'/api/sync/queue',dedupe:true}));

app.get('/api/onboarding/status', roles('OWNER','ADMIN'), (req,res)=>{
 const fid=req.user.factory_id;
 const factory=db.prepare('SELECT * FROM factories WHERE id=?').get(fid);
 const devices=db.prepare("SELECT COUNT(*) n FROM system_devices WHERE factory_id=? AND status='ACTIVE'").get(fid).n;
 const workers=db.prepare("SELECT COUNT(*) n FROM employees WHERE factory_id=?").get(fid).n;
 const users=db.prepare("SELECT COUNT(*) n FROM user_role_assignments WHERE factory_id=? AND status='ACTIVE'").get(fid).n;
 res.json({factory,steps:{
  factory_profile:!!factory,
  owner_account:true,
  sub_users:users>0,
  workforce:workers>0,
  mobile_device:devices>0,
  language:true,
  attendance_engine:true
 },ready_for_manual_pilot:!!factory&&workers>0});
});
app.post('/api/onboarding/mobile-device', roles('OWNER','ADMIN'), (req,res)=>{
 const r=db.prepare(`INSERT INTO system_devices(factory_id,device_type,name,device_identifier,status,config_json) VALUES(?,?,?,?,?,?)`)
 .run(req.user.factory_id,'ANDROID_PHONE',req.body.name||'Android Gate Phone',req.body.device_identifier||null,'ACTIVE',JSON.stringify({mode:'MOBILE_ATTENDANCE'}));
 res.status(201).json(db.prepare('SELECT * FROM system_devices WHERE id=?').get(r.lastInsertRowid));
});
app.listen(process.env.PORT || 4000, () => {
  console.log(`Mannat Attendance API running on http://localhost:${process.env.PORT || 4000}`);
});
