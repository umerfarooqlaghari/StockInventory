'use strict';
/**
 * server.js — Backend API entry point
 *
 * Architecture:
 *  POST /api/auth/register  — create tenant + user account
 *  POST /api/auth/login     — get JWT
 *  POST /api/rpc/:method    — (auth required) proxy to dbService function
 *  POST /api/s3/presigned   — (auth required) get pre-signed upload URL
 *                              using tenant-isolated prefix in single bucket
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const authMiddleware = require('./middleware/auth');
const { register, login } = require('./controllers/authController');
const dbService = require('./services/dbService');
const { getPresignedUploadUrl } = require('./services/s3Service');
const { getTenantId } = require('./services/tenantContext');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── PUBLIC ROUTES ─────────────────────────────────────────────────────────

app.post('/api/auth/register', register);
app.post('/api/auth/login', login);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ─── PROTECTED ROUTES ──────────────────────────────────────────────────────

// Generic RPC proxy — maps POST /api/rpc/:method → dbService[method](...args)
// Tenant context is already set by authMiddleware.
const ALLOWED_METHODS = new Set([
  'getConfig', 'saveConfig',
  'getAllInventory', 'getLowStock', 'createItem', 'updateItem', 'deleteItem',
  'updateStock', 'getInventoryHistory', 'rebuildInventoryHistory',
  'getAllClients', 'createClient', 'updateClient', 'deleteClient',
  'getClientLedger', 'getClientBalance',
  'getAllSales', 'createSale', 'updateSale', 'recordPayment',
  'markSaleReturned', 'deleteSale',
  'getTotalSales', 'getTotalProfit', 'getTotalOutstanding',
  'getOverdueSales', 'getPendingAlerts', 'markAlertSent',
  'getPendingPaymentSales', 'markOwnerDigestSent',
  'getAllPurchases', 'createPurchase', 'updatePurchase',
  'updatePurchaseStatus', 'deletePurchase', 'getPurchaseSummary',
  'getAllSuppliers', 'createSupplier', 'updateSupplier', 'deleteSupplier',
  'getMasterData', 'getMasterDataLists',
  'createMasterDataEntry', 'updateMasterDataEntry', 'deleteMasterDataEntry',
  'getDashboardMetrics',
]);

app.post('/api/rpc/:method', authMiddleware, async (req, res) => {
  const { method } = req.params;

  if (!ALLOWED_METHODS.has(method)) {
    return res.status(404).json({ error: `Unknown method: ${method}` });
  }

  const fn = dbService[method];
  if (typeof fn !== 'function') {
    return res.status(500).json({ error: `Method not implemented: ${method}` });
  }

  try {
    const args = Array.isArray(req.body.args) ? req.body.args : [];
    const result = await fn(...args);
    // Serialize BSON ObjectIds → plain strings for the client
    return res.json({ result: JSON.parse(JSON.stringify(result ?? null)) });
  } catch (err) {
    console.error(`[rpc:${method}]`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// S3 pre-signed URL — tenant gets isolated prefix: tenants/<tenantId>/<subfolder>/
app.post('/api/s3/presigned', authMiddleware, async (req, res) => {
  const { subfolder, filename, contentType } = req.body;
  if (!subfolder || !filename || !contentType) {
    return res.status(400).json({ error: 'subfolder, filename and contentType are required' });
  }

  const tenantId = getTenantId();
  try {
    const result = await getPresignedUploadUrl(tenantId, subfolder, filename, contentType);
    return res.json(result); // { uploadUrl, objectUrl, key }
  } catch (err) {
    console.error('[s3/presigned]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── START ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[backend-api] listening on http://localhost:${PORT}`);
});
