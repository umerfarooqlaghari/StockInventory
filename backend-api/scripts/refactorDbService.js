const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '../src/services/dbService.js');
let code = fs.readFileSync(dbPath, 'utf8');

code = code.replace(/require\('\.\/env\.cjs'\)\.loadEnv\(\);\n/, '');
code = code.replace(/const { MongoClient, ObjectId } = require\('mongodb'\);/, 'const { ObjectId } = require(\'mongodb\');\nconst { getTenantDb } = require(\'./tenantContext.js\');');

// Remove global vars and connect/disconnect/getMongoUri
code = code.replace(/const DB_NAME =[\s\S]*?async function disconnect\(\) {[\s\S]*?}\n/m, `
function requireDb() {
  const db = getTenantDb();
  if (!db) throw new Error('Database not connected for this tenant');
  return db;
}
`);

// fix ensureIndexes
code = code.replace(/async function ensureIndexes\(\) {/g, 'async function ensureIndexes(db) {');
code = code.replace(/await migrateLegacySchema\(\);/g, 'await migrateLegacySchema(db);');

// fix migrateLegacySchema
code = code.replace(/async function migrateLegacySchema\(\) {/g, 'async function migrateLegacySchema(db) {');

// replace db.collection with db.collection in ensureIndexes/migrateLegacySchema
// since db is passed as argument, db.collection is fine.
// But wait, ensureMasterDataSeed doesn't take db and uses col(). So it's fine.

// remove export of connect, disconnect, getLastConnectError
code = code.replace(/connect,\s*disconnect,\s*getLastConnectError,\s*/, 'ensureIndexes,\n  ensureMasterDataSeed,\n  ');

fs.writeFileSync(dbPath, code);
console.log('Refactored dbService.js');
