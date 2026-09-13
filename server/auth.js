const jwt = require('jsonwebtoken');

const SECRET = process.env.SESSION_SECRET || 'insecure-dev-secret-change-me';
const ADMIN_COOKIE = 'admin_session';

function issueAdminToken() {
  return jwt.sign({ role: 'admin' }, SECRET, { expiresIn: '12h' });
}

function requireAdmin(req, res, next) {
  const token = req.cookies[ADMIN_COOKIE];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.role !== 'admin') throw new Error('bad role');
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

module.exports = { issueAdminToken, requireAdmin, ADMIN_COOKIE, SECRET };
