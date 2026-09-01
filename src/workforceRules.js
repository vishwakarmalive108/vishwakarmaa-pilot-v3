import { db } from './db.js';

function activePermanent(employeeId, workDate) {
  return db.prepare(`
    SELECT er.*, f.name factory_name
    FROM employment_records er JOIN factories f ON f.id=er.factory_id
    WHERE er.employee_id=? AND er.employment_type='PERMANENT' AND er.status='ACTIVE'
      AND er.start_date<=? AND (er.end_date IS NULL OR er.end_date>=?)
    LIMIT 1
  `).get(employeeId,workDate,workDate);
}

function validNoc(employeeId, issuingFactoryId, destinationFactoryId, workDate) {
  return db.prepare(`
    SELECT * FROM noc_records
    WHERE employee_id=? AND issuing_factory_id=?
      AND (destination_factory_id IS NULL OR destination_factory_id=?)
      AND status='ACTIVE' AND valid_from<=? AND valid_to>=?
    LIMIT 1
  `).get(employeeId,issuingFactoryId,destinationFactoryId,workDate,workDate);
}

export function evaluateTemporaryEntry({employeeId,destinationFactoryId,workDate}) {
  const permanent=activePermanent(employeeId,workDate);
  if(!permanent) return {
    allowed:true, flag:false, reason:'FREE_TEMPORARY_LABOUR'
  };

  const noc=validNoc(employeeId,permanent.factory_id,destinationFactoryId,workDate);
  if(noc) return {
    allowed:true, flag:false, reason:'VALID_NOC', permanent_factory_id:permanent.factory_id, noc_id:noc.id
  };

  return {
    allowed:false, flag:true, reason:'PERMANENT_WORKER_WITHOUT_NOC',
    permanent_factory_id:permanent.factory_id,
    permanent_factory_name:permanent.factory_name
  };
}

export function createCrossMillFlag(factoryId,employeeId,summary,evidence) {
  const owner=db.prepare(
    `SELECT id FROM users WHERE factory_id=? AND role='OWNER' ORDER BY id LIMIT 1`
  ).get(factoryId);
  if(!owner) throw new Error('Factory owner not found');

  const r=db.prepare(`
    INSERT INTO red_flags(factory_id,employee_id,category,severity,summary,evidence,status,created_by)
    VALUES(?,?,?,?,?,?,?,?)
  `).run(factoryId,employeeId,'PERMANENT_WORKER_WITHOUT_NOC','HIGH',summary,evidence||null,'OPEN',owner.id);

  return Number(r.lastInsertRowid);
}
