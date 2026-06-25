'use strict';
/**
 * auth.js (middleware)
 *
 * Verifies the JWT on every protected route, then populates the
 * AsyncLocalStorage context with { tenantId, db } so that all dbService
 * functions run against the correct tenant's database automatically.
 */
const jwt = require('jsonwebtoken');
const { getTenantDatabase } = require('../services/tenantService');
const { tenantStorage } = require('../services/tenantContext');

const JWT_SECRET = process.env.JWT_SECRET;

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing token' });
  }

  const token = authHeader.slice(7); // strip "Bearer "
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }

  try {
    const db = await getTenantDatabase(decoded.tenantId);
    req.tenant = { tenantId: decoded.tenantId, companyName: decoded.companyName };

    // Run the rest of the request inside the tenant's async context
    tenantStorage.run({ tenantId: decoded.tenantId, db }, () => next());
  } catch (err) {
    console.error('[authMiddleware] failed to get tenant DB:', err.message);
    return res.status(500).json({ error: 'Could not connect to tenant database' });
  }
}

module.exports = authMiddleware;
