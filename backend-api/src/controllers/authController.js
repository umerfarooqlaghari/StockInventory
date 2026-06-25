'use strict';
/**
 * authController.js
 *
 * Handles tenant registration and login.
 * - Register: creates a new tenant record + user in StockInventory_Admin,
 *   provisions their per-tenant MongoDB database (new cluster), and seeds
 *   the master data defaults.
 * - Login: validates credentials, returns a signed JWT.
 *
 * NO changes are ever made to the original production cluster/DB.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

const { getAdminDb, getTenantDatabase } = require('../services/tenantService');
const { tenantStorage } = require('../services/tenantContext');
const { ensureIndexes, ensureMasterDataSeed, saveConfig, getConfig } = require('../services/dbService');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set in backend-api/.env');

// ─── REGISTER ────────────────────────────────────────────────────────────────

async function register(req, res) {
  try {
    const { email, password, companyName } = req.body;

    if (!email || !password || !companyName) {
      return res.status(400).json({ error: 'email, password and companyName are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const adminDb = await getAdminDb();

    const existing = await adminDb.collection('users').findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Tenant ID is a simple hex string derived from a new ObjectId
    const tenantId = new ObjectId().toHexString();

    // Provision the tenant database and seed master data
    const tenantDb = await getTenantDatabase(tenantId);
    await tenantStorage.run({ tenantId, db: tenantDb }, async () => {
      await ensureIndexes();
      const config = await getConfig();
      config.CompanyName = companyName;
      config.TenantId = tenantId;
      await saveConfig(config);
    });

    // Store tenant record
    await adminDb.collection('tenants').insertOne({
      _id: tenantId,
      companyName,
      email: email.toLowerCase(),
      createdAt: new Date(),
    });

    // Store user
    const passwordHash = await bcrypt.hash(password, 12);
    await adminDb.collection('users').insertOne({
      tenantId,
      email: email.toLowerCase(),
      passwordHash,
      role: 'admin',
      createdAt: new Date(),
    });

    return res.status(201).json({ message: 'Registration successful. You can now sign in.' });
  } catch (err) {
    console.error('[register]', err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const adminDb = await getAdminDb();
    const user = await adminDb.collection('users').findOne({ email: email.toLowerCase() });

    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const tenant = await adminDb.collection('tenants').findOne({ _id: user.tenantId });

    const payload = {
      userId: user._id.toString(),
      tenantId: user.tenantId,
      companyName: tenant?.companyName || '',
      role: user.role,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      token,
      tenantId: user.tenantId,
      companyName: tenant?.companyName || '',
    });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { register, login };
