import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET || 'development-only-secret';

export function signUser(user) {
  return jwt.sign(
    { sub: user.id, factory_id: user.factory_id, role: user.role, name: user.name },
    secret,
    { expiresIn: '8h' }
  );
}

export function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function roles(...allowed) {
  return (req, res, next) => {
    if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}
