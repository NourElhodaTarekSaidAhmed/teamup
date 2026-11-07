const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret';

const sign = user => jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' });
const verify = token => jwt.verify(token, SECRET);

function requireAuth(req, res, next) {
  try {
    req.userId = verify((req.headers.authorization || '').replace('Bearer ', '')).id;
    next();
  } catch { res.status(401).json({ error: 'Please sign in again.' }); }
}

module.exports = { sign, verify, requireAuth };
