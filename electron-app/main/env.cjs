'use strict';
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

let loaded = false;

function loadEnv() {
  if (loaded) return null;
  loaded = true;

  const candidates = [
    process.env.STOCK_INVENTORY_ENV,
    process.resourcesPath && path.join(process.resourcesPath, '.env'),
    path.join(__dirname, '..', '.env'),
  ].filter(Boolean);

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true });
      return envPath;
    }
  }
  return null;
}

module.exports = { loadEnv };
