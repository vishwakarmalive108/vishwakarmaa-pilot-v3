import { db } from './db.js';

export function committeeForFactory(factoryId) {
  return db.prepare(`
    SELECT c.*,a.name association_name
    FROM association_factories af
    JOIN associations a ON a.id=af.association_id
    JOIN review_committees c ON c.association_id=a.id AND c.active=1
    WHERE af.factory_id=? AND af.status='ACTIVE' AND a.active=1
    LIMIT 1
  `).get(factoryId);
}

export function createCommitteeCase(factoryId, redFlagId) {
  const committee=committeeForFactory(factoryId);
  if(!committee) return null;

  const flag=db.prepare(`
    SELECT r.* FROM red_flags r
    WHERE r.id=? AND r.factory_id=?
  `).get(redFlagId,factoryId);
  if(!flag) throw new Error('Red flag not found');

  const exists=db.prepare(
    'SELECT * FROM committee_cases WHERE red_flag_id=?'
  ).get(redFlagId);
  if(exists) return exists;

  const r=db.prepare(`
    INSERT INTO committee_cases(committee_id,red_flag_id,status,severity,summary)
    VALUES(?,?,?,?,?)
  `).run(committee.id,redFlagId,'QUEUED',flag.severity,flag.summary);

  db.prepare(`
    INSERT INTO association_updates(association_id,committee_id,event_type,title,message,reference_id)
    VALUES(?,?,?,?,?,?)
  `).run(
    committee.association_id,committee.id,'RED_FLAG_QUEUED',
    'New employer review case',
    `A new ${flag.severity} employer red-flag case has been queued for committee review. Case #${r.lastInsertRowid}.`,
    r.lastInsertRowid
  );

  return db.prepare('SELECT * FROM committee_cases WHERE id=?').get(r.lastInsertRowid);
}

export function reviewCase(caseId, status, note, resolution=null) {
  const allowed=['UNDER_REVIEW','CLEARED','CONFIRMED','DISPUTED','CLOSED'];
  if(!allowed.includes(status)) throw new Error('Invalid committee status');
  db.prepare(`
    UPDATE committee_cases
    SET status=?,committee_note=?,resolution=?,reviewed_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(status,note||null,resolution||null,caseId);
  return db.prepare('SELECT * FROM committee_cases WHERE id=?').get(caseId);
}
