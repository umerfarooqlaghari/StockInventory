'use strict';
/**
 * tenantService.js
 *
 * Manages per-tenant MongoDB database connections.
 * Strategy: Database-per-Tenant on the SAME Atlas cluster.
 *   - Admin data (users/tenants) → StockInventory_Admin (new cluster from env.ADMIN_MONGO_URI)
 *   - Each tenant's app data   → StockInventory_<tenantId>
 *
 * The production DB (StockInventoryDB on the old cluster) is never touched.
 */
const { MongoClient } = require('mongodb');

const ADMIN_MONGO_URI = process.env.ADMIN_MONGO_URI;
if (!ADMIN_MONGO_URI) {
  throw new Error('ADMIN_MONGO_URI is not set in backend-api/.env');
}

// One MongoClient shared for the entire admin cluster (connection pooled)
let adminClient = null;

async function getAdminClient() {
  if (adminClient) return adminClient;
  adminClient = new MongoClient(ADMIN_MONGO_URI);
  await adminClient.connect();
  return adminClient;
}

/** Returns the admin database (users + tenants registry). */
async function getAdminDb() {
  const client = await getAdminClient();
  return client.db('StockInventory_Admin');
}

// Cache of per-tenant MongoClient instances (same Atlas cluster → same client)
const tenantDbs = new Map();

/**
 * Returns (or lazily opens) the MongoDB Db for a given tenant.
 * Each tenant gets their own database: SIM_<tenantId>
 */
async function getTenantDatabase(tenantId) {
  if (tenantDbs.has(tenantId)) {
    return tenantDbs.get(tenantId);
  }
  // Reuse the admin client — all DBs live on the same Atlas cluster
  const client = await getAdminClient();
  const db = client.db(`SIM_${tenantId}`);
  tenantDbs.set(tenantId, db);
  return db;
}

module.exports = { getAdminDb, getTenantDatabase };
