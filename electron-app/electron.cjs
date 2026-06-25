'use strict';
require('./main/env.cjs').loadEnv();

// Suppress the AWS SDK NodeVersionSupportWarning before it reaches stderr
const _emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const type = (typeof rest[0] === 'string' ? rest[0] : rest[0]?.type) || '';
  if (type === 'NodeVersionSupportWarning') return;
  _emitWarning(warning, ...rest);
};

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const cron = require('node-cron');

// ── Local helpers that do NOT need the DB ────────────────────────────────────
const { generateInvoicePdf } = require('./main/pdf.cjs');
const {
  importInventoryFromExcel, importClientsFromExcel,
  exportInventoryToExcel,  exportSalesToExcel,
  generateInventoryTemplate, generateClientsTemplate,
} = require('./main/excel.cjs');
const {
  sendEmail, sendPaymentReminder, sendOwnerDailyDigest,
  DEFAULT_SUBJECT_TEMPLATE, DEFAULT_BODY_TEMPLATE,
} = require('./main/email.cjs');
const { sendOwnerWhatsAppDigest } = require('./main/whatsapp.cjs');

// NOTE: db.cjs (production DB) is intentionally NOT imported here.
// All data operations go through apiRpc() → backend-api → tenant database.

const isDev = process.env.NODE_ENV === 'development';
let win         = null;
let shuttingDown = false;

// ─── BACKEND API ─────────────────────────────────────────────────────────────
const API_BASE = process.env.API_URL || 'http://localhost:4000/api';
let _jwtToken = null;

/**
 * Sends an authenticated RPC call to the backend-api.
 * The backend verifies the JWT, resolves the tenant DB from it,
 * and executes the named dbService function in the tenant's context.
 */
async function apiRpc(method, ...args) {
  if (!_jwtToken) throw new Error('Not authenticated — please sign in first.');
  const res = await fetch(`${API_BASE}/rpc/${method}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${_jwtToken}`,
    },
    body: JSON.stringify({ args }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `RPC error [${method}]`);
  return data.result;
}

// ─── LOGO HELPERS ────────────────────────────────────────────────────────────
function getDefaultLogoPath() {
  const candidates = [
    path.join(__dirname, 'public', 'logo.png'),
    path.join(__dirname, 'dist',   'logo.png'),
    path.join(__dirname, 'public', 'logo.jpeg'),
    path.join(__dirname, 'dist',   'logo.jpeg'),
    path.join(__dirname, 'public', 'logo.jpg'),
    path.join(__dirname, 'dist',   'logo.jpg'),
    path.join(__dirname, 'public', 'logo.webp'),
    path.join(__dirname, 'dist',   'logo.webp'),
    path.join(__dirname, 'public', 'Artboard 1@2x.png'),
    path.join(__dirname, 'dist',   'Artboard 1@2x.png'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function resolveLogoPath(config) {
  if (config?.CompanyLogo && fs.existsSync(config.CompanyLogo)) return config.CompanyLogo;
  return getDefaultLogoPath();
}

// ─── ALERT SERVICE (tenant-aware — uses apiRpc with current user's token) ─────

let _clientTask = null;
let _ownerTask  = null;

function sameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

async function processAlerts() {
  if (!_jwtToken) return { processed: 0, sent: 0, error: 'Not authenticated' };
  try {
    const config  = await apiRpc('getConfig');
    const pending = await apiRpc('getPendingAlerts', config.AlertDays);
    let sent = 0;
    for (const sale of pending) {
      const ok = await sendPaymentReminder(sale, config);
      if (ok) { await apiRpc('markAlertSent', sale._id.toString()); sent++; }
    }
    console.log(`Client alerts: ${sent}/${pending.length} sent`);
    return { processed: pending.length, sent };
  } catch (err) {
    console.error('[processAlerts]', err.message);
    return { processed: 0, sent: 0, error: err.message };
  }
}

async function processOwnerDailyDigest({ force = false } = {}) {
  if (!_jwtToken) return { skipped: true, reason: 'Not authenticated' };
  try {
    const config   = await apiRpc('getConfig');
    const emails   = (config.OwnerEmails             || []).map(e => String(e).trim()).filter(Boolean);
    const phones   = (config.OwnerWhatsAppNumbers    || []).map(p => String(p).trim()).filter(Boolean);
    const doEmail  = force ? emails.length > 0 : config.OwnerDailyReminderEnabled       && emails.length > 0;
    const doWA     = force ? phones.length > 0 : config.OwnerWhatsAppReminderEnabled     && phones.length > 0;

    if (!doEmail && !doWA) {
      return { skipped: true, reason: 'No recipients configured or digest disabled' };
    }
    if (!force && config.OwnerLastDigestSentAt) {
      if (sameCalendarDay(new Date(config.OwnerLastDigestSentAt), new Date())) {
        return { skipped: true, reason: 'Already sent today' };
      }
    }

    const sales = await apiRpc('getPendingPaymentSales');
    let emailOk = false;
    let waResult = { sent: false, count: 0, errors: [] };

    if (doEmail)  emailOk  = await sendOwnerDailyDigest(config, sales, emails);
    if (doWA)     waResult = await sendOwnerWhatsAppDigest(config, sales, phones);

    const sent = emailOk || waResult.sent;
    if (sent) await apiRpc('markOwnerDigestSent');

    return {
      sent, emailSent: emailOk, whatsappSent: waResult.sent,
      invoiceCount: sales.length, forced: force,
      whatsappErrors: waResult.errors,
    };
  } catch (err) {
    console.error('[processOwnerDailyDigest]', err.message);
    return { sent: false, error: err.message };
  }
}

function startAlertService() {
  _clientTask = cron.schedule('0 */6 * * *', processAlerts);
  _ownerTask  = cron.schedule('0 9 * * *',   () => processOwnerDailyDigest());
  console.log('Alert service started (client alerts every 6h, owner digest daily at 09:00)');
}

function stopAlertService() {
  if (_clientTask) { _clientTask.destroy(); _clientTask = null; }
  if (_ownerTask)  { _ownerTask.destroy();  _ownerTask  = null; }
}

// ─── APP LIFECYCLE ────────────────────────────────────────────────────────────
async function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopAlertService();
  console.log('App closed cleanly.');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 700,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.cjs'),
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,
    },
    show: false,
  });
  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
  win.once('ready-to-show', () => win.show());
}

// No db.connect() at startup — backend handles all DB connections after auth.
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', (e) => {
  if (shuttingDown) return;
  e.preventDefault();
  gracefulShutdown().then(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => gracefulShutdown().then(() => process.exit(0)));
});

// ─── IPC HELPER ───────────────────────────────────────────────────────────────
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const result = await fn(...args);
      return { ok: true, data: JSON.parse(JSON.stringify(result ?? null)) };
    } catch (err) {
      console.error(`[${channel}]`, err.message);
      return { ok: false, error: err.message };
    }
  });
}

// ─── AUTH IPC ─────────────────────────────────────────────────────────────────
ipcMain.handle('auth:login', async (_event, email, password) => {
  try {
    const res  = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    _jwtToken = data.token;
    startAlertService();            // start crons for this tenant
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('auth:register', async (_event, email, password, companyName) => {
  try {
    const res  = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password, companyName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('auth:logout', () => {
  _jwtToken = null;
  stopAlertService();              // stop crons on logout
  return { ok: true };
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
handle('dashboard:get',              ()        => apiRpc('getDashboardMetrics'));
handle('alerts:runNow',              ()        => processAlerts());
handle('alerts:runOwnerDigestNow',   ()        => processOwnerDailyDigest({ force: true }));

// ─── INVENTORY ────────────────────────────────────────────────────────────────
handle('inventory:getAll',           (search)  => apiRpc('getAllInventory',         search));
handle('inventory:getLowStock',      ()        => apiRpc('getLowStock'));
handle('inventory:create',           (item)    => apiRpc('createItem',              item));
handle('inventory:update',           (item)    => apiRpc('updateItem',              item));
handle('inventory:delete',           (id)      => apiRpc('deleteItem',              id));
handle('inventory:getHistory',       (id)      => apiRpc('getInventoryHistory',     id));
handle('inventory:rebuildHistory',   (id)      => apiRpc('rebuildInventoryHistory', id));
handle('inventory:importExcel', async (filePath) => {
  const { items, errors } = await importInventoryFromExcel(filePath);
  let success = 0;
  for (const item of items) {
    try { await apiRpc('createItem', item); success++; } catch (e) { errors.push(e.message); }
  }
  return { success, errors };
});
handle('inventory:exportExcel', async () => {
  const items = await apiRpc('getAllInventory');
  const buf   = await exportInventoryToExcel(items);
  const p     = path.join(os.homedir(), 'Downloads', `inventory_${Date.now()}.xlsx`);
  fs.writeFileSync(p, buf);
  shell.showItemInFolder(p);
  return p;
});

// ─── CLIENTS ─────────────────────────────────────────────────────────────────
handle('clients:getAll',             (search)   => apiRpc('getAllClients',   search));
handle('clients:create',             (client)   => apiRpc('createClient',    client));
handle('clients:update',             (client)   => apiRpc('updateClient',    client));
handle('clients:delete',             (id)       => apiRpc('deleteClient',    id));
handle('clients:getLedger',          (clientId) => apiRpc('getClientLedger', clientId));
handle('clients:importExcel', async (filePath) => {
  const { clients, errors } = await importClientsFromExcel(filePath);
  let success = 0;
  for (const client of clients) {
    try { await apiRpc('createClient', client); success++; } catch (e) { errors.push(e.message); }
  }
  return { success, errors };
});

// ─── SALES ───────────────────────────────────────────────────────────────────
handle('sales:getAll',         (search, status) => apiRpc('getAllSales',       search, status));
handle('sales:create',         (sale)           => apiRpc('createSale',        sale));
handle('sales:update',         (sale)           => apiRpc('updateSale',        sale));
handle('sales:recordPayment',  (saleId, entry)  => apiRpc('recordPayment',     saleId, entry));
handle('sales:markReturned',   (id)             => apiRpc('markSaleReturned',  id));
handle('sales:delete',         (id)             => apiRpc('deleteSale',        id));
handle('sales:notifyNow', async (saleId) => {
  const sales  = await apiRpc('getAllSales');
  const sale   = sales.find((s) => s._id.toString() === saleId);
  if (!sale) throw new Error('Sale not found');
  const config = await apiRpc('getConfig');
  const ok     = await sendPaymentReminder(sale, config);
  return { sent: ok, clientEmail: sale.ClientEmail };
});
handle('sales:generatePdf', async (saleId) => {
  const sales  = await apiRpc('getAllSales');
  const sale   = sales.find((s) => s._id.toString() === saleId);
  if (!sale) throw new Error('Sale not found');
  const config = await apiRpc('getConfig');
  const logoPath = resolveLogoPath(config);
  const pdfBuf   = await generateInvoicePdf(sale, config, logoPath);
  const defaultName = `${sale.InvoiceNumber || 'invoice'}.pdf`;
  const saveResult  = await dialog.showSaveDialog(win, {
    title: 'Save Invoice PDF',
    defaultPath: path.join(os.homedir(), 'Downloads', defaultName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (saveResult.canceled || !saveResult.filePath) return { canceled: true };
  fs.writeFileSync(saveResult.filePath, pdfBuf);
  return { saved: true, filePath: saveResult.filePath };
});
handle('sales:exportExcel', async () => {
  const sales = await apiRpc('getAllSales');
  const buf   = await exportSalesToExcel(sales);
  const p     = path.join(os.homedir(), 'Downloads', `sales_${Date.now()}.xlsx`);
  fs.writeFileSync(p, buf);
  shell.showItemInFolder(p);
  return p;
});

// ─── PURCHASES ───────────────────────────────────────────────────────────────
handle('purchases:getAll',       ()                                          => apiRpc('getAllPurchases'));
handle('purchases:getSummary',   ()                                          => apiRpc('getPurchaseSummary'));
handle('purchases:create',       (purchase)                                  => apiRpc('createPurchase',      purchase));
handle('purchases:update',       (purchase)                                  => apiRpc('updatePurchase',      purchase));
handle('purchases:updateStatus', (id, status, statusNotes, receivedItems)   => apiRpc('updatePurchaseStatus', id, status, statusNotes, receivedItems));
handle('purchases:delete',       (id)                                        => apiRpc('deletePurchase',      id));

// ─── SUPPLIERS ───────────────────────────────────────────────────────────────
handle('suppliers:getAll',   (search) => apiRpc('getAllSuppliers',   search));
handle('suppliers:create',   (s)      => apiRpc('createSupplier',    s));
handle('suppliers:update',   (s)      => apiRpc('updateSupplier',    s));
handle('suppliers:delete',   (id)     => apiRpc('deleteSupplier',    id));

// ─── MASTER DATA ─────────────────────────────────────────────────────────────
handle('masterData:getAll',  (type)  => apiRpc('getMasterData',           type));
handle('masterData:getLists',()      => apiRpc('getMasterDataLists'));
handle('masterData:create',  (entry) => apiRpc('createMasterDataEntry',   entry));
handle('masterData:update',  (entry) => apiRpc('updateMasterDataEntry',   entry));
handle('masterData:delete',  (id)    => apiRpc('deleteMasterDataEntry',   id));

// ─── CONFIG ──────────────────────────────────────────────────────────────────
handle('config:get',     ()       => apiRpc('getConfig'));
handle('config:save',    (config) => apiRpc('saveConfig', config));
handle('config:getLogoSrc', async () => {
  const config   = await apiRpc('getConfig');
  const logoPath = resolveLogoPath(config);
  if (!logoPath) return null;
  const data = fs.readFileSync(logoPath);
  const ext  = path.extname(logoPath).slice(1).toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext] || 'image/png';
  return `data:${mime};base64,${data.toString('base64')}`;
});
handle('config:uploadLogo', async (sourcePath) => {
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Logo file not found');
  const ext     = path.extname(sourcePath).toLowerCase() || '.png';
  const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  if (!allowed.includes(ext)) throw new Error('Logo must be PNG, JPG, WEBP, or GIF');
  const destDir = path.join(app.getPath('userData'), 'assets');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `company-logo-${Date.now()}${ext}`);
  fs.copyFileSync(sourcePath, dest);
  const config = await apiRpc('getConfig');
  await apiRpc('saveConfig', { ...config, CompanyLogo: dest });
  return dest;
});
handle('config:resetLogo', async () => {
  const config = await apiRpc('getConfig');
  await apiRpc('saveConfig', { ...config, CompanyLogo: '' });
  return true;
});
handle('config:defaultEmailTemplate', () => ({
  subject: DEFAULT_SUBJECT_TEMPLATE,
  body:    DEFAULT_BODY_TEMPLATE,
}));
handle('email:sendTest', async (toEmail) => {
  const config = await apiRpc('getConfig');
  const ok = await sendEmail(
    toEmail,
    `[TEST] Payment Reminder — ${config.CompanyName || 'Stock Inventory'}`,
    `This is a test email from ${config.CompanyName || 'your stock inventory system'}.\n\nYour AWS SES integration is working correctly.`,
    `<div style="font-family:Arial,sans-serif;padding:24px;background:#F3F4F6"><div style="max-width:500px;margin:auto;background:#fff;border-radius:8px;overflow:hidden"><div style="background:#1A2B4A;padding:20px 24px"><h2 style="color:#fff;margin:0">Test Email</h2></div><div style="padding:20px 24px"><p>Test from <strong>${config.CompanyName || 'your stock inventory system'}</strong>.</p><p style="color:#16A34A;font-weight:600">✓ AWS SES is working correctly.</p></div></div></div>`
  );
  return { sent: ok };
});

// ─── EXCEL TEMPLATES ─────────────────────────────────────────────────────────
handle('template:inventory', async () => {
  const buf = await generateInventoryTemplate();
  const p   = path.join(os.homedir(), 'Downloads', 'inventory_template.xlsx');
  fs.writeFileSync(p, buf);
  shell.showItemInFolder(p);
  return p;
});
handle('template:clients', async () => {
  const buf = await generateClientsTemplate();
  const p   = path.join(os.homedir(), 'Downloads', 'clients_template.xlsx');
  fs.writeFileSync(p, buf);
  shell.showItemInFolder(p);
  return p;
});

// ─── S3 UPLOAD (via backend presigned URL — tenant-isolated prefix) ───────────
handle('upload:paymentProof', async (localFilePath, invoiceNumber) => {
  if (!_jwtToken) throw new Error('Not authenticated');
  const ext         = path.extname(localFilePath).toLowerCase() || '.png';
  const MIME        = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                        '.gif': 'image/gif',  '.webp': 'image/webp',  '.pdf': 'application/pdf' };
  const contentType = MIME[ext] || 'application/octet-stream';
  const filename    = `${invoiceNumber || 'unknown'}_${Date.now()}${ext}`;

  // Get a short-lived presigned PUT URL scoped to this tenant's prefix
  const urlRes = await fetch(`${API_BASE}/s3/presigned`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_jwtToken}` },
    body:    JSON.stringify({ subfolder: 'payment-proofs', filename, contentType }),
  });
  const { uploadUrl, objectUrl } = await urlRes.json();
  if (!urlRes.ok) throw new Error('Failed to get presigned upload URL');

  // Upload directly to S3 — AWS credentials never leave the backend
  const putRes = await fetch(uploadUrl, {
    method:  'PUT',
    headers: { 'Content-Type': contentType },
    body:    fs.readFileSync(localFilePath),
  });
  if (!putRes.ok) throw new Error('S3 upload failed');
  return objectUrl;
});

// ─── FILE DIALOGS ─────────────────────────────────────────────────────────────
ipcMain.handle('dialog:openFile', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, opts || { properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:saveFile', async (_e, opts) => {
  const r = await dialog.showSaveDialog(win, opts || {});
  return r.canceled ? null : r.filePath;
});
