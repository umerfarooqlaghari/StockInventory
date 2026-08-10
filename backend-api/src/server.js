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

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
if (process.env.ENABLE_CUSTOM_DNS === '1') {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch (e) {
    console.warn('Failed to set custom DNS servers:', e.message);
  }
}

const express = require('express');
const cors = require('cors');

const authMiddleware = require('./middleware/auth');
const { register, login } = require('./controllers/authController');
const dbService = require('./services/dbService');
const { getPresignedUploadUrl } = require('./services/s3Service');
const { getTenantId } = require('./services/tenantContext');

const app = express();
const corsOrigin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : true;
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '10mb' }));

// ─── PUBLIC ROUTES ─────────────────────────────────────────────────────────

app.post('/api/auth/register', register);
app.post('/api/auth/login', login);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ─── PROTECTED ROUTES ──────────────────────────────────────────────────────

// Generic RPC proxy — maps POST /api/rpc/:method → dbService[method](...args)
// Tenant context is already set by authMiddleware.
const ALLOWED_METHODS = new Set([
  'getConfig', 'saveConfig', 'getVatConfig', 'updateVatConfig',
  'getAllInventory', 'getItemByBarcode', 'getLowStock', 'createItem', 'updateItem', 'deleteItem',
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

// ─── VAT API ROUTES ────────────────────────────────────────────────────────
app.get('/api/vat', authMiddleware, async (_req, res) => {
  try {
    const data = await dbService.getVatConfig();
    return res.json({ ok: true, vat: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/vat', authMiddleware, async (req, res) => {
  try {
    const { vatRate, region } = req.body;
    const data = await dbService.updateVatConfig(vatRate, region);
    return res.json({ ok: true, vat: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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

// ─── FILE & NOTIFICATION SERVICES (copied from Electron main) ─────────────
const multer = require('multer');
const fs = require('fs');
fs.mkdirSync('uploads', { recursive: true });
const upload = multer({ dest: 'uploads/' });

const { exportInventoryToExcel, exportSalesToExcel, generateInventoryTemplate, generateClientsTemplate, importInventoryFromExcel, importClientsFromExcel } = require('./services/excel');
const { generateInvoicePdf } = require('./services/pdf');
const { sendEmail, sendPaymentReminder, sendOwnerDailyDigest } = require('./services/email');
const { sendOwnerWhatsAppDigest } = require('./services/whatsapp');

// PDF invoice download
app.get('/api/sales/:saleId/pdf', authMiddleware, async (req, res) => {
  try {
    const { saleId } = req.params;
    const sales = await dbService.getAllSales();
    const sale = sales.find((s) => s._id.toString() === saleId);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    const config = await dbService.getConfig();
    
    let logoBuffer = null;
    const logoUrlOrPath = config?.CompanyLogo;
    if (logoUrlOrPath) {
      if (logoUrlOrPath.startsWith('http')) {
        try {
          const fetchRes = await fetch(logoUrlOrPath);
          if (fetchRes.ok) {
            logoBuffer = Buffer.from(await fetchRes.arrayBuffer());
          }
        } catch (err) {
          console.warn('Failed to fetch S3 logo for PDF:', err.message);
        }
      } else if (fs.existsSync(logoUrlOrPath)) {
        logoBuffer = fs.readFileSync(logoUrlOrPath);
      }
    }
    
    const pdfBuf = await generateInvoicePdf(sale, config, logoBuffer);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${sale.InvoiceNumber || 'invoice'}.pdf`);
    return res.send(pdfBuf);
  } catch (err) {
    console.error('[pdf-gen-error]', err);
    return res.status(500).json({ error: err.message });
  }
});

// Excel exports
app.get('/api/inventory/export', authMiddleware, async (req, res) => {
  try {
    const items = await dbService.getAllInventory();
    const buf = await exportInventoryToExcel(items);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=inventory_${Date.now()}.xlsx`);
    return res.send(buf);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales/export', authMiddleware, async (req, res) => {
  try {
    const sales = await dbService.getAllSales();
    const buf = await exportSalesToExcel(sales);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=sales_${Date.now()}.xlsx`);
    return res.send(buf);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Excel templates
app.get('/api/templates/:type', authMiddleware, async (req, res) => {
  try {
    const { type } = req.params;
    let buf;
    if (type === 'inventory') {
      buf = await generateInventoryTemplate();
    } else if (type === 'clients') {
      buf = await generateClientsTemplate();
    } else {
      return res.status(404).json({ error: 'Unknown template type' });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_template.xlsx`);
    return res.send(buf);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Excel imports
app.post('/api/inventory/import', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { items, errors } = await importInventoryFromExcel(req.file.path);
    let success = 0;
    for (const item of items) {
      try {
        await dbService.createItem(item);
        success++;
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.json({ success, errors });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients/import', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { clients, errors } = await importClientsFromExcel(req.file.path);
    let success = 0;
    for (const client of clients) {
      try {
        await dbService.createClient(client);
        success++;
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.json({ success, errors });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(500).json({ error: err.message });
  }
});

// Notifications and Manual Alert execution
app.post('/api/sales/:saleId/notify', authMiddleware, async (req, res) => {
  try {
    const { saleId } = req.params;
    const sales = await dbService.getAllSales();
    const sale = sales.find((s) => s._id.toString() === saleId);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    const config = await dbService.getConfig();
    const ok = await sendPaymentReminder(sale, config);
    return res.json({ sent: ok, clientEmail: sale.ClientEmail });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/alerts/run', authMiddleware, async (req, res) => {
  try {
    const config = await dbService.getConfig();
    const pending = await dbService.getPendingAlerts(config.AlertDays);
    let sent = 0;
    const errors = [];
    for (const sale of pending) {
      const ok = await sendPaymentReminder(sale, config);
      if (ok) {
        await dbService.markAlertSent(sale._id.toString());
        sent++;
      } else {
        errors.push(`Failed to send reminder for invoice ${sale.InvoiceNumber}`);
      }
    }
    return res.json({ processed: pending.length, sent, errors });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/alerts/run-owner', authMiddleware, async (req, res) => {
  try {
    const config = await dbService.getConfig();
    const emails = (config.OwnerEmails || []).map(e => String(e).trim()).filter(Boolean);
    const phones = (config.OwnerWhatsAppNumbers || []).map(p => String(p).trim()).filter(Boolean);
    
    if (emails.length === 0 && phones.length === 0) {
      return res.json({ skipped: true, reason: 'No email or WhatsApp destinations configured.' });
    }

    let emailSent = false;
    let whatsappSent = false;
    let whatsappCount = 0;
    const whatsappErrors = [];
    
    const allSales = await dbService.getAllSales('', 'All');
    const pendingSales = (allSales || []).filter(s => s.PaymentStatus !== 'Paid' && !s.IsReturned);
    const invoiceCount = pendingSales.length;

    if (emails.length > 0) {
      emailSent = await sendOwnerDailyDigest(config, pendingSales, emails);
    }
    
    if (phones.length > 0) {
      const waResult = await sendOwnerWhatsAppDigest(config, pendingSales, phones);
      whatsappSent = waResult.sent;
      whatsappCount = waResult.count;
      if (waResult.errors) whatsappErrors.push(...waResult.errors);
    }

    await dbService.markOwnerDigestSent();
    return res.json({
      sent: emailSent || whatsappSent,
      emailSent,
      whatsappSent,
      whatsappCount,
      recipients: emails.length,
      invoiceCount,
      whatsappErrors
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/email/send-test', authMiddleware, async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'to email is required' });
    const config = await dbService.getConfig();
    const ok = await sendEmail(
      to,
      `[TEST] Payment Reminder — ${config.CompanyName || 'Stock Inventory'}`,
      `This is a test email from ${config.CompanyName || 'your stock inventory system'}.\n\nYour AWS SES integration is working correctly.`,
      `<div style="font-family:Arial,sans-serif;padding:24px;background:#F3F4F6"><div style="max-width:500px;margin:auto;background:#fff;border-radius:8px;overflow:hidden"><div style="background:#1A2B4A;padding:20px 24px"><h2 style="color:#fff;margin:0">Test Email</h2></div><div style="padding:20px 24px"><p>Test from <strong>${config.CompanyName || 'your stock inventory system'}</strong>.</p><p style="color:#16A34A;font-weight:600">✓ AWS SES is working correctly.</p></div></div></div>`
    );
    return res.json({ sent: ok });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── BACKGROUND CRON JOBS (Multi-tenant Alert Scheduling) ──────────────────
const cron = require('node-cron');
const { getAdminDb, getTenantDatabase } = require('./services/tenantService');
const { tenantStorage } = require('./services/tenantContext');

async function runGlobalAlerts() {
  console.log('[cron] Starting global alerts check for all tenants...');
  try {
    const adminDb = await getAdminDb();
    const tenants = await adminDb.collection('tenants').find({}).toArray();
    for (const tenant of tenants) {
      const tenantId = tenant._id;
      const tenantDb = await getTenantDatabase(tenantId);
      await tenantStorage.run({ tenantId, db: tenantDb }, async () => {
        try {
          const config = await dbService.getConfig();
          const pending = await dbService.getPendingAlerts(config.AlertDays);
          let sent = 0;
          for (const sale of pending) {
            const ok = await sendPaymentReminder(sale, config);
            if (ok) {
              await dbService.markAlertSent(sale._id.toString());
              sent++;
            }
          }
          if (pending.length > 0) {
            console.log(`[cron] Tenant ${tenant.companyName || tenantId}: client alerts: ${sent}/${pending.length} sent`);
          }
        } catch (err) {
          console.error(`[cron-error] Failed client alerts for tenant ${tenantId}:`, err.message);
        }
      });
    }
  } catch (err) {
    console.error('[cron-error] Global client alerts failed:', err.message);
  }
}

async function runGlobalOwnerDigests() {
  console.log('[cron] Starting global owner digests check for all tenants...');
  try {
    const adminDb = await getAdminDb();
    const tenants = await adminDb.collection('tenants').find({}).toArray();
    for (const tenant of tenants) {
      const tenantId = tenant._id;
      const tenantDb = await getTenantDatabase(tenantId);
      await tenantStorage.run({ tenantId, db: tenantDb }, async () => {
        try {
          const config = await dbService.getConfig();
          const emails = (config.OwnerEmails || []).map(e => String(e).trim()).filter(Boolean);
          const phones = (config.OwnerWhatsAppNumbers || []).map(p => String(p).trim()).filter(Boolean);
          
          if (!config.OwnerDailyReminderEnabled || (emails.length === 0 && phones.length === 0)) {
            return;
          }

          const now = new Date();
          if (config.OwnerLastDigestSentAt && new Date(config.OwnerLastDigestSentAt).toDateString() === now.toDateString()) {
            return;
          }

          const allSales = await dbService.getAllSales('', 'All');
          const pendingSales = (allSales || []).filter(s => s.PaymentStatus !== 'Paid' && !s.IsReturned);

          let emailSent = false;
          let whatsappSent = false;

          if (emails.length > 0) {
            emailSent = await sendOwnerDailyDigest(config, pendingSales, emails);
          }
          if (phones.length > 0) {
            const waResult = await sendOwnerWhatsAppDigest(config, pendingSales, phones);
            whatsappSent = waResult.sent;
          }

          if (emailSent || whatsappSent) {
            await dbService.markOwnerDigestSent();
            console.log(`[cron] Tenant ${tenant.companyName || tenantId}: owner digest sent`);
          }
        } catch (err) {
          console.error(`[cron-error] Failed owner digest for tenant ${tenantId}:`, err.message);
        }
      });
    }
  } catch (err) {
    console.error('[cron-error] Global owner digests failed:', err.message);
  }
}

// Client alerts every 6 hours, owner digests daily at 9:00 AM
cron.schedule('0 */6 * * *', runGlobalAlerts);
cron.schedule('0 9 * * *', runGlobalOwnerDigests);

// ─── START ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[backend-api] listening on http://localhost:${PORT}`);
});
