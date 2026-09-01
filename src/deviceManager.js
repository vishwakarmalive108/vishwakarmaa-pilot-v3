import { db } from './db.js';

export function listDevices(factoryId) {
  return db.prepare(`
    SELECT * FROM biometric_devices
    WHERE factory_id=? ORDER BY gate_name,device_name
  `).all(factoryId);
}

export function heartbeat(factoryId, deviceId, payload={}) {
  const d=db.prepare(`
    SELECT * FROM biometric_devices WHERE id=? AND factory_id=?
  `).get(deviceId,factoryId);
  if(!d) throw new Error('Device not found');

  db.prepare(`
    UPDATE biometric_devices
    SET status='ONLINE',last_seen=CURRENT_TIMESTAMP,
        firmware=COALESCE(?,firmware),ip_address=COALESCE(?,ip_address)
    WHERE id=?
  `).run(payload.firmware||null,payload.ip_address||null,deviceId);

  return db.prepare('SELECT * FROM biometric_devices WHERE id=?').get(deviceId);
}

export function deviceHealth(factoryId) {
  const devices=listDevices(factoryId);
  const now=Date.now();
  return devices.map(d=>{
    const last=d.last_seen ? new Date(d.last_seen).getTime() : 0;
    const online=last && (now-last)<120000;
    return {...d,status:online?'ONLINE':'OFFLINE',health:online?'GOOD':'CHECK'};
  });
}
