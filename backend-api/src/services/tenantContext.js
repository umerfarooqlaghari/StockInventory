'use strict';
/**
 * tenantContext.js
 *
 * Uses Node's AsyncLocalStorage so that every request automatically
 * carries its tenantId + db handle without passing them through every
 * function call.  The auth middleware populates the store; all DB helpers
 * read from it via getTenantDb() / getTenantId().
 */
const { AsyncLocalStorage } = require('async_hooks');

const tenantStorage = new AsyncLocalStorage();

/** Returns the MongoDB Db instance for the current request's tenant. */
function getTenantDb() {
  return tenantStorage.getStore()?.db;
}

/** Returns the tenantId string for the current request. */
function getTenantId() {
  return tenantStorage.getStore()?.tenantId;
}

module.exports = { tenantStorage, getTenantDb, getTenantId };
