'use strict';
// Suppress the AWS SDK NodeVersionSupportWarning before it reaches stderr
const _emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const type = (typeof rest[0] === 'string' ? rest[0] : rest[0]?.type) || '';
  if (type === 'NodeVersionSupportWarning') return;
  _emitWarning(warning, ...rest);
};

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const db = require('./main/db.cjs');
const { generateInvoicePdf } = require('./main/pdf.cjs');
const { importInventoryFromExcel, importClientsFromExcel, exportInventoryToExcel, exportSalesToExcel, generateInventoryTemplate, generateClientsTemplate } = require('./main/excel.cjs');

const { startAlertService, stopAlertService, processAlerts } = require('./main/alerts.cjs');
const { sendEmail, DEFAULT_SUBJECT_TEMPLATE, DEFAULT_BODY_TEMPLATE } = require('./main/email.cjs');

const isDev = process.env.NODE_ENV === 'development';
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
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

app.whenReady().then(async () => {
  try {
    await db.connect();
    startAlertService();
  } catch (err) {
    console.error('DB connection failed:', err.message);
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  stopAlertService();
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC HANDLERS ────────────────────────────────────────────────────────────

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const result = await fn(...args);
      // JSON round-trip converts BSON ObjectId → plain hex string so the renderer
      // receives serialisable data instead of opaque structured-clone objects.
      return { ok: true, data: JSON.parse(JSON.stringify(result)) };
    } catch (err) {
      console.error(`[${channel}]`, err.message);
      return { ok: false, error: err.message };
    }
  });
}

// Dashboard
handle('dashboard:get', () => db.getDashboardMetrics());
handle('alerts:runNow', () => processAlerts());

// Inventory
handle('inventory:getAll', (search) => db.getAllInventory(search));
handle('inventory:getLowStock', () => db.getLowStock());
handle('inventory:create', (item) => db.createItem(item));
handle('inventory:update', (item) => db.updateItem(item));
handle('inventory:delete', (id) => db.deleteItem(id));
handle('inventory:importExcel', async (filePath) => {
  const { items, errors } = await importInventoryFromExcel(filePath);
  let success = 0;
  for (const item of items) {
    try { await db.createItem(item); success++; } catch (e) { errors.push(e.message); }
  }
  return { success, errors };
});
handle('inventory:exportExcel', async () => {
  const items = await db.getAllInventory();
  const buf = await exportInventoryToExcel(items);
  const savePath = path.join(os.homedir(), 'Downloads', `inventory_${Date.now()}.xlsx`);
  fs.writeFileSync(savePath, buf);
  shell.showItemInFolder(savePath);
  return savePath;
});

// Clients
handle('clients:getAll', (search) => db.getAllClients(search));
handle('clients:create', (client) => db.createClient(client));
handle('clients:update', (client) => db.updateClient(client));
handle('clients:delete', (id) => db.deleteClient(id));
handle('clients:getLedger', (clientId) => db.getClientLedger(clientId));
handle('clients:importExcel', async (filePath) => {
  const { clients, errors } = await importClientsFromExcel(filePath);
  let success = 0;
  for (const client of clients) {
    try { await db.createClient(client); success++; } catch (e) { errors.push(e.message); }
  }
  return { success, errors };
});

// Sales
handle('sales:getAll', (search, status) => db.getAllSales(search, status));
handle('sales:create', (sale) => db.createSale(sale));
handle('sales:updatePayment', (id, amount) => db.updatePayment(id, amount));
handle('sales:markReturned', (id) => db.markSaleReturned(id));
handle('sales:notifyNow', async (saleId) => {
  const sales = await db.getAllSales();
  const sale = sales.find((s) => s._id.toString() === saleId);
  if (!sale) throw new Error('Sale not found');
  const config = await db.getConfig();
  const { sendPaymentReminder } = require('./main/email.cjs');
  const ok = await sendPaymentReminder(sale, config);
  return { sent: ok, clientEmail: sale.ClientEmail };
});
handle('sales:delete', (id) => db.deleteSale(id));
handle('sales:generatePdf', async (saleId) => {
  const sales = await db.getAllSales();
  const sale = sales.find((s) => s._id.toString() === saleId);
  if (!sale) throw new Error('Sale not found');
  const config = await db.getConfig();
  const pdfBuf = await generateInvoicePdf(sale, config);
  const invoicesDir = path.join(os.homedir(), 'Documents', 'StockInventory', 'Invoices');
  fs.mkdirSync(invoicesDir, { recursive: true });
  const filePath = path.join(invoicesDir, `${sale.InvoiceNumber}.pdf`);
  fs.writeFileSync(filePath, pdfBuf);
  shell.openPath(filePath);
  return filePath;
});
handle('sales:exportExcel', async () => {
  const sales = await db.getAllSales();
  const buf = await exportSalesToExcel(sales);
  const savePath = path.join(os.homedir(), 'Downloads', `sales_${Date.now()}.xlsx`);
  fs.writeFileSync(savePath, buf);
  shell.showItemInFolder(savePath);
  return savePath;
});

// Purchases
handle('purchases:getAll', () => db.getAllPurchases());
handle('purchases:create', (purchase) => db.createPurchase(purchase));
handle('purchases:update', (purchase) => db.updatePurchase(purchase));
handle('purchases:delete', (id) => db.deletePurchase(id));

// Suppliers
handle('suppliers:getAll', (search) => db.getAllSuppliers(search));
handle('suppliers:create', (s) => db.createSupplier(s));
handle('suppliers:update', (s) => db.updateSupplier(s));
handle('suppliers:delete', (id) => db.deleteSupplier(id));

// Config
handle('config:get', () => db.getConfig());
handle('config:save', (config) => db.saveConfig(config));
handle('config:defaultEmailTemplate', () => ({
  subject: DEFAULT_SUBJECT_TEMPLATE,
  body: DEFAULT_BODY_TEMPLATE,
}));
handle('email:sendTest', async (toEmail) => {
  const config = await db.getConfig();
  const ok = await sendEmail(
    toEmail,
    `[TEST] Payment Reminder — ${config.CompanyName || 'Printing Plates Inventory'}`,
    `This is a test email from ${config.CompanyName || 'your stock inventory system'}.\n\nYour AWS SES integration is working correctly.`,
    `<div style="font-family:Arial,sans-serif;padding:24px;background:#F3F4F6"><div style="max-width:500px;margin:auto;background:#fff;border-radius:8px;overflow:hidden"><div style="background:#1A2B4A;padding:20px 24px"><h2 style="color:#fff;margin:0">Test Email</h2></div><div style="padding:20px 24px"><p>This is a test email from <strong>${config.CompanyName || 'your stock inventory system'}</strong>.</p><p style="color:#16A34A;font-weight:600">✓ Your AWS SES integration is working correctly.</p></div></div></div>`
  );
  return { sent: ok };
});

// Excel templates
handle('template:inventory', async () => {
  const buf = await generateInventoryTemplate();
  const p = path.join(os.homedir(), 'Downloads', 'inventory_template.xlsx');
  fs.writeFileSync(p, buf);
  shell.showItemInFolder(p);
  return p;
});
handle('template:clients', async () => {
  const buf = await generateClientsTemplate();
  const p = path.join(os.homedir(), 'Downloads', 'clients_template.xlsx');
  fs.writeFileSync(p, buf);
  shell.showItemInFolder(p);
  return p;
});

// File dialogs
ipcMain.handle('dialog:openFile', async (_e, opts) => {
  const result = await dialog.showOpenDialog(win, opts || { properties: ['openFile'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('dialog:saveFile', async (_e, opts) => {
  const result = await dialog.showSaveDialog(win, opts || {});
  return result.canceled ? null : result.filePath;
});
