import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbFile = process.env.DB_FILE || './data/mannat.db';
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS factories (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, city TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, factory_id INTEGER NOT NULL, name TEXT NOT NULL,
 mobile TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('OWNER','HR_ADMIN','SUPERVISOR','DEVICE_OPERATOR')),
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS departments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, factory_id INTEGER NOT NULL, name TEXT NOT NULL,
 UNIQUE(factory_id,name), FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS employees (
 id INTEGER PRIMARY KEY AUTOINCREMENT, factory_id INTEGER NOT NULL, employee_code TEXT NOT NULL,
 name TEXT NOT NULL, mobile TEXT, address TEXT, photo_url TEXT, blood_group TEXT, dob TEXT,
 emergency_contact TEXT, department_id INTEGER, designation TEXT, joining_date TEXT,
 previous_job_details TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
 salary_monthly REAL DEFAULT 0, ot_rate REAL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(factory_id, employee_code), FOREIGN KEY(factory_id) REFERENCES factories(id),
 FOREIGN KEY(department_id) REFERENCES departments(id)
);
CREATE TABLE IF NOT EXISTS employee_verifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('AADHAAR','OTHER')),
 status TEXT NOT NULL CHECK(status IN ('PENDING','VERIFIED','FAILED','REVIEW')),
 reference TEXT, verified_at TEXT, FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS biometric_credentials (
 id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, device_id TEXT NOT NULL,
 modality TEXT NOT NULL CHECK(modality IN ('FACE','FINGERPRINT')),
 vendor_credential_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS devices (
 id INTEGER PRIMARY KEY AUTOINCREMENT, factory_id INTEGER NOT NULL, device_code TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, vendor TEXT, location TEXT, status TEXT NOT NULL DEFAULT 'ONLINE',
 last_seen_at TEXT, FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS biometric_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, factory_id INTEGER NOT NULL, device_code TEXT NOT NULL,
 employee_code TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE,
 event_type TEXT NOT NULL CHECK(event_type IN ('IN','OUT')), captured_at TEXT NOT NULL,
 received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS shifts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, factory_id INTEGER NOT NULL, name TEXT NOT NULL,
 start_time TEXT NOT NULL, end_time TEXT NOT NULL, grace_minutes INTEGER NOT NULL DEFAULT 10,
 min_full_day_minutes INTEGER NOT NULL DEFAULT 480, ot_after_minutes INTEGER NOT NULL DEFAULT 480,
 active INTEGER NOT NULL DEFAULT 1, UNIQUE(factory_id,name), FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS employee_shift_assignments (
 employee_id INTEGER NOT NULL, shift_id INTEGER NOT NULL, effective_from TEXT NOT NULL,
 effective_to TEXT, PRIMARY KEY(employee_id,effective_from),
 FOREIGN KEY(employee_id) REFERENCES employees(id), FOREIGN KEY(shift_id) REFERENCES shifts(id)
);
CREATE TABLE IF NOT EXISTS leave_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, start_date TEXT NOT NULL,
 end_date TEXT NOT NULL, leave_type TEXT NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'PENDING',
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS attendance_days (
 id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, work_date TEXT NOT NULL,
 shift_id INTEGER, first_in TEXT, last_out TEXT, status TEXT NOT NULL DEFAULT 'ABSENT',
 worked_minutes INTEGER NOT NULL DEFAULT 0, late_minutes INTEGER NOT NULL DEFAULT 0,
 overtime_minutes INTEGER NOT NULL DEFAULT 0, missing_out INTEGER NOT NULL DEFAULT 0,
 source TEXT NOT NULL DEFAULT 'BIOMETRIC', calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(employee_id, work_date), FOREIGN KEY(employee_id) REFERENCES employees(id),
 FOREIGN KEY(shift_id) REFERENCES shifts(id)
);
CREATE TABLE IF NOT EXISTS payroll_runs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, factory_id INTEGER NOT NULL, period TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(factory_id,period), FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS payroll_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, payroll_run_id INTEGER NOT NULL, employee_id INTEGER NOT NULL,
 basic_salary REAL NOT NULL DEFAULT 0, ot_minutes INTEGER NOT NULL DEFAULT 0,
 ot_amount REAL NOT NULL DEFAULT 0, leave_deduction REAL NOT NULL DEFAULT 0,
 net_amount REAL NOT NULL DEFAULT 0, FOREIGN KEY(payroll_run_id) REFERENCES payroll_runs(id),
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS documents (
 id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, type TEXT NOT NULL,
 file_ref TEXT, expiry_date TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS red_flags (
 id INTEGER PRIMARY KEY AUTOINCREMENT, factory_id INTEGER NOT NULL, employee_id INTEGER,
 category TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 summary TEXT NOT NULL, evidence TEXT, status TEXT NOT NULL DEFAULT 'OPEN',
 created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(factory_id) REFERENCES factories(id), FOREIGN KEY(employee_id) REFERENCES employees(id),
 FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS associations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 city TEXT,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS association_factories (
 association_id INTEGER NOT NULL,
 factory_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'ACTIVE',
 PRIMARY KEY(association_id,factory_id),
 FOREIGN KEY(association_id) REFERENCES associations(id),
 FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS review_committees (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 association_id INTEGER NOT NULL,
 name TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(association_id) REFERENCES associations(id)
);
CREATE TABLE IF NOT EXISTS committee_members (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 committee_id INTEGER NOT NULL,
 name TEXT NOT NULL,
 role TEXT NOT NULL,
 mobile TEXT,
 active INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(committee_id) REFERENCES review_committees(id)
);
CREATE TABLE IF NOT EXISTS committee_cases (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 committee_id INTEGER NOT NULL,
 red_flag_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'QUEUED',
 severity TEXT NOT NULL,
 summary TEXT NOT NULL,
 employer_note TEXT,
 committee_note TEXT,
 resolution TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 FOREIGN KEY(committee_id) REFERENCES review_committees(id),
 FOREIGN KEY(red_flag_id) REFERENCES red_flags(id)
);
CREATE TABLE IF NOT EXISTS association_updates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 association_id INTEGER NOT NULL,
 committee_id INTEGER,
 event_type TEXT NOT NULL,
 title TEXT NOT NULL,
 message TEXT NOT NULL,
 reference_id INTEGER,
 status TEXT NOT NULL DEFAULT 'GENERATED',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 sent_at TEXT,
 FOREIGN KEY(association_id) REFERENCES associations(id),
 FOREIGN KEY(committee_id) REFERENCES review_committees(id)
);


CREATE TABLE IF NOT EXISTS employment_records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL,
 factory_id INTEGER NOT NULL,
 employment_type TEXT NOT NULL CHECK(employment_type IN ('PERMANENT','TEMPORARY')),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ENDED')),
 start_date TEXT NOT NULL,
 end_date TEXT,
 noc_required INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(employee_id) REFERENCES employees(id),
 FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS temporary_labour_profiles (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL UNIQUE,
 labour_type TEXT NOT NULL DEFAULT 'FATAK',
 active INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS noc_records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL,
 issuing_factory_id INTEGER NOT NULL,
 destination_factory_id INTEGER,
 valid_from TEXT NOT NULL,
 valid_to TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','EXPIRED','REVOKED')),
 reference TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS labour_assignments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL,
 factory_id INTEGER NOT NULL,
 work_date TEXT NOT NULL,
 assignment_type TEXT NOT NULL CHECK(assignment_type IN ('TEMPORARY','PERMANENT')),
 in_event_id INTEGER,
 out_event_id INTEGER,
 status TEXT NOT NULL DEFAULT 'ACTIVE',
 FOREIGN KEY(employee_id) REFERENCES employees(id),
 FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS association_penalties (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 association_id INTEGER NOT NULL,
 factory_id INTEGER NOT NULL,
 employee_id INTEGER,
 committee_case_id INTEGER,
 reason TEXT NOT NULL,
 amount REAL NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','CONFIRMED','WAIVED','PAID')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(association_id) REFERENCES associations(id),
 FOREIGN KEY(factory_id) REFERENCES factories(id),
 FOREIGN KEY(employee_id) REFERENCES employees(id),
 FOREIGN KEY(committee_case_id) REFERENCES committee_cases(id)
);


CREATE TABLE IF NOT EXISTS biometric_devices (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 factory_id INTEGER NOT NULL,
 gate_name TEXT NOT NULL,
 device_name TEXT NOT NULL,
 device_type TEXT NOT NULL CHECK(device_type IN ('FACE','FINGERPRINT','FACE_FINGERPRINT')),
 serial_number TEXT,
 status TEXT NOT NULL DEFAULT 'OFFLINE',
 last_seen TEXT,
 firmware TEXT,
 ip_address TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(factory_id) REFERENCES factories(id)
);


CREATE TABLE IF NOT EXISTS employee_documents (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL,
 document_type TEXT NOT NULL,
 document_number_masked TEXT,
 verification_status TEXT NOT NULL DEFAULT 'PENDING',
 verified_at TEXT,
 verified_by INTEGER,
 file_ref TEXT,
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS biometric_identities (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL,
 device_type TEXT NOT NULL CHECK(device_type IN ('FACE','FINGERPRINT')),
 biometric_ref TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ACTIVE',
 enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(device_type,biometric_ref),
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS employment_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL,
 factory_name TEXT NOT NULL,
 factory_id INTEGER,
 employment_type TEXT NOT NULL,
 role_name TEXT,
 start_date TEXT,
 end_date TEXT,
 exit_reason TEXT,
 verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS employee_profile_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL,
 event_type TEXT NOT NULL,
 summary TEXT NOT NULL,
 actor_user_id INTEGER,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);


CREATE TABLE IF NOT EXISTS salary_profiles (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL UNIQUE,
 pay_type TEXT NOT NULL CHECK(pay_type IN ('MONTHLY','DAILY','HOURLY')),
 base_salary REAL NOT NULL DEFAULT 0,
 overtime_rate REAL NOT NULL DEFAULT 0,
 effective_from TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS payroll_periods (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 factory_id INTEGER NOT NULL,
 period_start TEXT NOT NULL,
 period_end TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CALCULATED','APPROVED','PAID')),
 approved_by INTEGER,
 approved_at TEXT,
 FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS payroll_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 period_id INTEGER NOT NULL,
 employee_id INTEGER NOT NULL,
 payable_days REAL NOT NULL DEFAULT 0,
 regular_hours REAL NOT NULL DEFAULT 0,
 overtime_hours REAL NOT NULL DEFAULT 0,
 base_amount REAL NOT NULL DEFAULT 0,
 overtime_amount REAL NOT NULL DEFAULT 0,
 advance_deduction REAL NOT NULL DEFAULT 0,
 loan_deduction REAL NOT NULL DEFAULT 0,
 other_deduction REAL NOT NULL DEFAULT 0,
 gross_amount REAL NOT NULL DEFAULT 0,
 net_amount REAL NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'CALCULATED',
 FOREIGN KEY(period_id) REFERENCES payroll_periods(id),
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS employee_advances (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL,
 amount REAL NOT NULL,
 advance_date TEXT NOT NULL,
 reason TEXT,
 outstanding REAL NOT NULL,
 status TEXT NOT NULL DEFAULT 'OUTSTANDING' CHECK(status IN ('OUTSTANDING','CLOSED','CANCELLED')),
 approved_by INTEGER,
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS employee_loans (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 employee_id INTEGER NOT NULL,
 principal REAL NOT NULL,
 outstanding REAL NOT NULL,
 monthly_deduction REAL NOT NULL DEFAULT 0,
 start_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CLOSED','CANCELLED')),
 approved_by INTEGER,
 FOREIGN KEY(employee_id) REFERENCES employees(id)
);


CREATE TABLE IF NOT EXISTS association_memberships (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 factory_id INTEGER NOT NULL UNIQUE,
 association_name TEXT NOT NULL,
 membership_status TEXT NOT NULL DEFAULT 'ACTIVE',
 joined_at TEXT,
 FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS review_committee_members (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 association_id INTEGER NOT NULL,
 member_name TEXT NOT NULL,
 role_name TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(association_id) REFERENCES association_memberships(id)
);
CREATE TABLE IF NOT EXISTS review_cases (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 association_id INTEGER NOT NULL,
 red_flag_id INTEGER,
 case_type TEXT NOT NULL,
 priority TEXT NOT NULL DEFAULT 'NORMAL',
 status TEXT NOT NULL DEFAULT 'OPEN',
 opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 assigned_member_id INTEGER,
 resolution TEXT,
 resolved_at TEXT,
 FOREIGN KEY(association_id) REFERENCES association_memberships(id),
 FOREIGN KEY(red_flag_id) REFERENCES red_flags(id),
 FOREIGN KEY(assigned_member_id) REFERENCES review_committee_members(id)
);
CREATE TABLE IF NOT EXISTS association_updates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 association_id INTEGER NOT NULL,
 update_type TEXT NOT NULL,
 title TEXT NOT NULL,
 summary TEXT NOT NULL,
 source_case_id INTEGER,
 generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 audience TEXT NOT NULL DEFAULT 'ASSOCIATION',
 FOREIGN KEY(association_id) REFERENCES association_memberships(id),
 FOREIGN KEY(source_case_id) REFERENCES review_cases(id)
);


CREATE TABLE IF NOT EXISTS roles_permissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 role_name TEXT NOT NULL,
 permission TEXT NOT NULL,
 UNIQUE(role_name,permission)
);
CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 factory_id INTEGER,
 notification_type TEXT NOT NULL,
 title TEXT NOT NULL,
 message TEXT NOT NULL,
 severity TEXT NOT NULL DEFAULT 'INFO',
 read_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS security_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 factory_id INTEGER,
 event_type TEXT NOT NULL,
 entity_type TEXT,
 entity_id TEXT,
 result TEXT NOT NULL,
 metadata TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS device_registry (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 factory_id INTEGER NOT NULL,
 device_code TEXT NOT NULL UNIQUE,
 device_type TEXT NOT NULL CHECK(device_type IN ('FACE','FINGERPRINT','FACE_FINGERPRINT','GATE')),
 status TEXT NOT NULL DEFAULT 'ACTIVE',
 last_seen_at TEXT,
 firmware_version TEXT,
 FOREIGN KEY(factory_id) REFERENCES factories(id)
);


CREATE TABLE IF NOT EXISTS workforce_types(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL);
INSERT OR IGNORE INTO workforce_types(code,name) VALUES ('PERMANENT','Permanent Employee'),('DAILY','Daily/Fatak Labour'),('HAMAL_TOLI','Hamal Toli');
CREATE TABLE IF NOT EXISTS hamal_teams(id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,team_code TEXT NOT NULL,team_name TEXT NOT NULL,leader_employee_id INTEGER,member_limit INTEGER NOT NULL DEFAULT 15,status TEXT NOT NULL DEFAULT 'ACTIVE',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(factory_id,team_code),FOREIGN KEY(factory_id) REFERENCES factories(id));
CREATE TABLE IF NOT EXISTS hamal_team_members(id INTEGER PRIMARY KEY AUTOINCREMENT,team_id INTEGER NOT NULL,employee_id INTEGER NOT NULL,joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,left_at TEXT,status TEXT NOT NULL DEFAULT 'ACTIVE',UNIQUE(team_id,employee_id),FOREIGN KEY(team_id) REFERENCES hamal_teams(id),FOREIGN KEY(employee_id) REFERENCES employees(id));
CREATE TABLE IF NOT EXISTS hamal_team_attendance(id INTEGER PRIMARY KEY AUTOINCREMENT,team_id INTEGER NOT NULL,attendance_date TEXT NOT NULL,required_count INTEGER NOT NULL DEFAULT 0,present_count INTEGER NOT NULL DEFAULT 0,absent_count INTEGER NOT NULL DEFAULT 0,assignment_type TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(team_id,attendance_date),FOREIGN KEY(team_id) REFERENCES hamal_teams(id));
CREATE TABLE IF NOT EXISTS hamal_work_assignments(id INTEGER PRIMARY KEY AUTOINCREMENT,team_id INTEGER NOT NULL,assignment_date TEXT NOT NULL,job_type TEXT NOT NULL,location TEXT,start_time TEXT,end_time TEXT,rate_type TEXT NOT NULL DEFAULT 'TEAM',rate_amount REAL,status TEXT NOT NULL DEFAULT 'ASSIGNED',FOREIGN KEY(team_id) REFERENCES hamal_teams(id));


CREATE TABLE IF NOT EXISTS daily_requirements(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,requirement_date TEXT NOT NULL,
 required_count INTEGER NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT 'OWNER',
 notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(factory_id,requirement_date),FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS daily_labour_entries(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER,entry_date TEXT NOT NULL,
 entry_time TEXT NOT NULL,verification_method TEXT,verification_status TEXT NOT NULL DEFAULT 'PENDING',
 employment_check TEXT NOT NULL DEFAULT 'NOT_CHECKED',noc_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
 gate_decision TEXT NOT NULL DEFAULT 'PENDING',daily_rate REAL DEFAULT 0,advance_amount REAL DEFAULT 0,
 notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(factory_id) REFERENCES factories(id)
);
CREATE TABLE IF NOT EXISTS labour_alerts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER,entry_id INTEGER,
 alert_type TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'RED',status TEXT NOT NULL DEFAULT 'OPEN',
 message TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(factory_id) REFERENCES factories(id)
);


CREATE TABLE IF NOT EXISTS worker_time_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER,workforce_type TEXT NOT NULL,
 event_date TEXT NOT NULL,in_time TEXT,out_time TEXT,source TEXT NOT NULL DEFAULT 'BIOMETRIC',
 status TEXT NOT NULL DEFAULT 'OPEN',notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS worker_advance_ledger(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER,entry_date TEXT NOT NULL,
 entry_type TEXT NOT NULL CHECK(entry_type IN ('ADVANCE','RECOVERY','ADJUSTMENT')),
 amount REAL NOT NULL,reference TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pay_periods(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'OPEN',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(factory_id,period_start,period_end)
);
CREATE TABLE IF NOT EXISTS pay_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT,pay_period_id INTEGER NOT NULL,worker_id INTEGER,workforce_type TEXT NOT NULL,
 present_days REAL NOT NULL DEFAULT 0,total_hours REAL NOT NULL DEFAULT 0,ot_hours REAL NOT NULL DEFAULT 0,
 base_amount REAL NOT NULL DEFAULT 0,ot_amount REAL NOT NULL DEFAULT 0,advance_amount REAL NOT NULL DEFAULT 0,
 deduction_amount REAL NOT NULL DEFAULT 0,net_amount REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'CALCULATED',
 FOREIGN KEY(pay_period_id) REFERENCES pay_periods(id)
);


CREATE TABLE IF NOT EXISTS app_roles(
 id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,description TEXT,system_role INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS app_permissions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,module TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS role_permissions(
 role_id INTEGER NOT NULL,permission_id INTEGER NOT NULL,allowed INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(role_id,permission_id),FOREIGN KEY(role_id) REFERENCES app_roles(id),FOREIGN KEY(permission_id) REFERENCES app_permissions(id)
);
CREATE TABLE IF NOT EXISTS app_users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,employee_id INTEGER,username TEXT NOT NULL,display_name TEXT NOT NULL,
 role_id INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1,pin_hash TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(factory_id,username),FOREIGN KEY(factory_id) REFERENCES factories(id),FOREIGN KEY(employee_id) REFERENCES employees(id),FOREIGN KEY(role_id) REFERENCES app_roles(id)
);
CREATE TABLE IF NOT EXISTS user_permission_overrides(
 user_id INTEGER NOT NULL,permission_id INTEGER NOT NULL,allowed INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,permission_id),FOREIGN KEY(user_id) REFERENCES app_users(id),FOREIGN KEY(permission_id) REFERENCES app_permissions(id)
);
CREATE TABLE IF NOT EXISTS user_limits(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,limit_code TEXT NOT NULL,limit_value TEXT NOT NULL,
 UNIQUE(user_id,limit_code),FOREIGN KEY(user_id) REFERENCES app_users(id)
);
CREATE TABLE IF NOT EXISTS security_audit_log(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,user_id INTEGER,action TEXT NOT NULL,target_type TEXT,target_id INTEGER,details TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS attendance_corrections(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER,event_id INTEGER,
 field_name TEXT NOT NULL,original_value TEXT,new_value TEXT,reason TEXT NOT NULL,requested_by INTEGER,
 approved_by INTEGER,approval_status TEXT NOT NULL DEFAULT 'PENDING',requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 decided_at TEXT,decision_note TEXT
);
CREATE TABLE IF NOT EXISTS attendance_locks(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,lock_date TEXT NOT NULL,locked_by INTEGER,
 locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(factory_id,lock_date)
);
CREATE TABLE IF NOT EXISTS attendance_security_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,user_id INTEGER,worker_id INTEGER,
 event_type TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'INFO',details TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS worker_identity_profiles(
 id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER UNIQUE NOT NULL,identity_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
 id_type TEXT,id_last4 TEXT,aadhaar_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED',
 face_status TEXT NOT NULL DEFAULT 'NOT_ENROLLED',fingerprint_status TEXT NOT NULL DEFAULT 'NOT_ENROLLED',
 mobile TEXT,address TEXT,city TEXT,state TEXT,emergency_contact TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employment_history(
 id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER NOT NULL,factory_id INTEGER NOT NULL,employment_type TEXT NOT NULL,
 start_date TEXT NOT NULL,end_date TEXT,status TEXT NOT NULL DEFAULT 'ACTIVE',noc_required INTEGER NOT NULL DEFAULT 0,
 noc_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',role_title TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS worker_assignments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER NOT NULL,factory_id INTEGER NOT NULL,assignment_type TEXT NOT NULL,
 team_name TEXT,valid_from TEXT NOT NULL,valid_to TEXT,status TEXT NOT NULL DEFAULT 'ACTIVE',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS miller_associations(
 id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,city TEXT,state TEXT,country TEXT DEFAULT 'India',status TEXT NOT NULL DEFAULT 'ACTIVE',
 review_committee_name TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS association_memberships(
 id INTEGER PRIMARY KEY AUTOINCREMENT,association_id INTEGER NOT NULL,factory_id INTEGER NOT NULL,member_status TEXT NOT NULL DEFAULT 'ACTIVE',
 joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(association_id,factory_id)
);
CREATE TABLE IF NOT EXISTS association_committee_members(
 id INTEGER PRIMARY KEY AUTOINCREMENT,association_id INTEGER NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS association_notices(
 id INTEGER PRIMARY KEY AUTOINCREMENT,association_id INTEGER NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'INFO',
 source_type TEXT NOT NULL DEFAULT 'SYSTEM',published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS network_worker_checks(
 id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER NOT NULL,requesting_factory_id INTEGER NOT NULL,
 result TEXT NOT NULL,permanent_factory_id INTEGER,requires_noc INTEGER NOT NULL DEFAULT 0,reason TEXT,
 checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS daily_labour_requirements(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,work_date TEXT NOT NULL,required_count INTEGER NOT NULL DEFAULT 0,
 reported_present INTEGER NOT NULL DEFAULT 0,reported_absent INTEGER NOT NULL DEFAULT 0,additional_required INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'OPEN',created_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(factory_id,work_date)
);
CREATE TABLE IF NOT EXISTS fatak_entries(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER,work_date TEXT NOT NULL,entry_type TEXT NOT NULL DEFAULT 'DAILY',
 checkin_at TEXT,checkout_at TEXT,assignment TEXT,rate REAL NOT NULL DEFAULT 0,advance REAL NOT NULL DEFAULT 0,
 eligibility TEXT NOT NULL DEFAULT 'PENDING',noc_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
 status TEXT NOT NULL DEFAULT 'ACTIVE',entered_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS daily_labour_settlements(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,fatak_entry_id INTEGER NOT NULL,worker_id INTEGER,work_date TEXT NOT NULL,
 hours REAL NOT NULL DEFAULT 0,base_pay REAL NOT NULL DEFAULT 0,ot_pay REAL NOT NULL DEFAULT 0,advance REAL NOT NULL DEFAULT 0,
 net_pay REAL NOT NULL DEFAULT 0,approved_by INTEGER,approval_status TEXT NOT NULL DEFAULT 'PENDING',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS factory_alerts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,alert_type TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'INFO',
 title TEXT NOT NULL,message TEXT,entity_type TEXT,entity_id INTEGER,status TEXT NOT NULL DEFAULT 'OPEN',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,acknowledged_by INTEGER,acknowledged_at TEXT
);
CREATE TABLE IF NOT EXISTS dashboard_snapshots(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,snapshot_date TEXT NOT NULL,
 present_count INTEGER NOT NULL DEFAULT 0,absent_count INTEGER NOT NULL DEFAULT 0,daily_labour_count INTEGER NOT NULL DEFAULT 0,
 hamal_present_count INTEGER NOT NULL DEFAULT 0,open_red_flags INTEGER NOT NULL DEFAULT 0,noc_cases INTEGER NOT NULL DEFAULT 0,
 pending_advances REAL NOT NULL DEFAULT 0,pending_payroll REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(factory_id,snapshot_date)
);


CREATE TABLE IF NOT EXISTS attendance_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER NOT NULL,event_date TEXT NOT NULL,
 event_time TEXT NOT NULL,event_type TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'MANUAL',device_id TEXT,latitude REAL,longitude REAL,
 created_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance_corrections(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER NOT NULL,attendance_id INTEGER,
 correction_type TEXT NOT NULL,old_value TEXT,new_value TEXT,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',
 requested_by INTEGER,reviewed_by INTEGER,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance_shifts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,name TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,
 grace_minutes INTEGER NOT NULL DEFAULT 0,overtime_after_minutes INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE IF NOT EXISTS attendance_daily_summary(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER NOT NULL,work_date TEXT NOT NULL,
 first_in TEXT,last_out TEXT,total_minutes INTEGER NOT NULL DEFAULT 0,late_minutes INTEGER NOT NULL DEFAULT 0,overtime_minutes INTEGER NOT NULL DEFAULT 0,
 source_quality TEXT NOT NULL DEFAULT 'RECORDED',status TEXT NOT NULL DEFAULT 'CALCULATED',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(factory_id,worker_id,work_date)
);


CREATE TABLE IF NOT EXISTS worker_documents(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER NOT NULL,
 document_type TEXT NOT NULL,document_number_masked TEXT,verification_status TEXT NOT NULL DEFAULT 'PENDING',
 verified_by INTEGER,verified_at TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS worker_employment_history(
 id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER NOT NULL,factory_id INTEGER NOT NULL,
 employer_name TEXT NOT NULL,employment_type TEXT NOT NULL DEFAULT 'PERMANENT',start_date TEXT,end_date TEXT,
 status TEXT NOT NULL DEFAULT 'HISTORICAL',noc_status TEXT,source TEXT NOT NULL DEFAULT 'SYSTEM',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS worker_noc_records(
 id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER NOT NULL,factory_id INTEGER NOT NULL,
 from_factory_id INTEGER,to_factory_id INTEGER,issue_date TEXT,status TEXT NOT NULL DEFAULT 'PENDING',
 approved_by INTEGER,reason TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS worker_employment_status(
 id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER NOT NULL,factory_id INTEGER NOT NULL,
 employment_type TEXT NOT NULL DEFAULT 'TEMPORARY',status TEXT NOT NULL DEFAULT 'ACTIVE',
 start_date TEXT NOT NULL,end_date TEXT,noc_required INTEGER NOT NULL DEFAULT 0,noc_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
 source TEXT NOT NULL DEFAULT 'SYSTEM',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS redflag_cases(
 id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER NOT NULL,reported_factory_id INTEGER NOT NULL,
 permanent_factory_id INTEGER,case_type TEXT NOT NULL,rule_code TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'HIGH',
 status TEXT NOT NULL DEFAULT 'OPEN',detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_by INTEGER,reviewed_at TEXT,resolution TEXT,penalty_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
 association_case_id INTEGER
);
CREATE TABLE IF NOT EXISTS association_cases(
 id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER,reporting_factory_id INTEGER,target_factory_id INTEGER,
 case_type TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'HIGH',status TEXT NOT NULL DEFAULT 'OPEN',
 penalty_status TEXT NOT NULL DEFAULT 'PENDING',penalty_amount REAL NOT NULL DEFAULT 0,notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,closed_at TEXT
);
CREATE TABLE IF NOT EXISTS worker_gate_decisions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER NOT NULL,factory_id INTEGER NOT NULL,decision_date TEXT NOT NULL,
 decision TEXT NOT NULL,reason TEXT,redflag_case_id INTEGER,noc_id INTEGER,decided_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS role_profiles(
 id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,description TEXT,level INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS user_role_assignments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,role_code TEXT NOT NULL,factory_id INTEGER,association_id INTEGER,status TEXT NOT NULL DEFAULT 'ACTIVE',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,role_code,factory_id,association_id)
);
CREATE TABLE IF NOT EXISTS role_permissions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,role_code TEXT NOT NULL,permission_code TEXT NOT NULL,scope TEXT NOT NULL DEFAULT 'FACTORY',
 allowed INTEGER NOT NULL DEFAULT 1,UNIQUE(role_code,permission_code,scope)
);


CREATE TABLE IF NOT EXISTS user_preferences(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,language TEXT NOT NULL DEFAULT 'en',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id)
);


CREATE TABLE IF NOT EXISTS auth_users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,email TEXT,phone TEXT,
 password_hash TEXT,auth_status TEXT NOT NULL DEFAULT 'PENDING',last_login_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS auth_sessions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,session_token_hash TEXT UNIQUE NOT NULL,
 expires_at TEXT NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS login_audit(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,username TEXT,success INTEGER NOT NULL,reason TEXT,ip_hash TEXT,device_hash TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS system_devices(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,device_type TEXT NOT NULL,name TEXT NOT NULL,device_identifier TEXT,
 status TEXT NOT NULL DEFAULT 'PENDING',last_seen_at TEXT,config_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notification_queue(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER,user_id INTEGER,channel TEXT NOT NULL,event_type TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'QUEUED',attempts INTEGER NOT NULL DEFAULT 0,last_attempt_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sync_queue(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,device_id INTEGER,entity_type TEXT NOT NULL,entity_id INTEGER,payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,processed_at TEXT
);


CREATE TABLE IF NOT EXISTS mobile_attendance_devices(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,user_id INTEGER,device_label TEXT NOT NULL,device_fingerprint TEXT,
 status TEXT NOT NULL DEFAULT 'ACTIVE',last_seen_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mobile_attendance_attempts(
 id INTEGER PRIMARY KEY AUTOINCREMENT,factory_id INTEGER NOT NULL,worker_id INTEGER,user_id INTEGER,device_id INTEGER,
 verification_method TEXT NOT NULL,action TEXT NOT NULL,result TEXT NOT NULL,reason TEXT,client_event_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(factory_id,client_event_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, factory_id INTEGER NOT NULL, actor_user_id INTEGER,
 action TEXT NOT NULL, resource TEXT NOT NULL, resource_id TEXT, metadata TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(factory_id) REFERENCES factories(id),
 FOREIGN KEY(actor_user_id) REFERENCES users(id)
);
`);
