import { db } from './db.js';

export function audit(req, action, resource, resourceId = null, metadata = {}) {
  db.prepare(`
    INSERT INTO audit_logs(factory_id, actor_user_id, action, resource, resource_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.user.factory_id,
    req.user.sub,
    action,
    resource,
    resourceId,
    JSON.stringify(metadata)
  );
}
