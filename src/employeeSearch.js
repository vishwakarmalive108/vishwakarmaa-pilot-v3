import { db } from './db.js';

export function searchEmployees(factoryId, q, role='OWNER') {
  const term=(q||'').trim();
  if(!term) return [];

  const like=`%${term}%`;
  const rows=db.prepare(`
    SELECT e.id,e.employee_code,e.name,e.mobile,e.photo_url,e.status,
           er.employment_type,er.start_date,
           f.name AS current_factory,
           EXISTS(
             SELECT 1 FROM red_flags rf
             WHERE rf.employee_id=e.id AND rf.status='OPEN'
           ) AS has_open_flag
    FROM employees e
    LEFT JOIN employment_records er
      ON er.employee_id=e.id AND er.status='ACTIVE'
    LEFT JOIN factories f ON f.id=er.factory_id
    WHERE (
      e.factory_id=? OR
      EXISTS (
        SELECT 1 FROM employment_history eh
        WHERE eh.employee_id=e.id
      )
    )
    AND (
      e.name LIKE ? OR e.employee_code LIKE ? OR e.mobile LIKE ?
      OR EXISTS(
        SELECT 1 FROM biometric_identities bi
        WHERE bi.employee_id=e.id AND bi.biometric_ref LIKE ?
      )
    )
    ORDER BY CASE WHEN e.factory_id=? THEN 0 ELSE 1 END, e.name
    LIMIT 50
  `).all(factoryId,like,like,like,like,factoryId);

  return rows.map(r => {
    // Cross-factory searches expose eligibility/status, not sensitive profile fields.
    const own=r.current_factory && r.employment_type==='PERMANENT' &&
      db.prepare(`SELECT 1 FROM employment_records WHERE employee_id=? AND factory_id=? AND status='ACTIVE' LIMIT 1`)
        .get(r.id,factoryId);
    return {
      ...r,
      visibility: own ? 'FULL' : 'LIMITED',
      sensitive_fields_hidden: !own,
      action: own ? 'OPEN_PROFILE' : 'CHECK_ELIGIBILITY'
    };
  });
}
