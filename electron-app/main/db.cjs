'use strict';
require('./env.cjs').loadEnv();
const { MongoClient, ObjectId } = require('mongodb');

const DB_NAME = process.env.MONGO_DB_NAME || 'StockInventoryDB';

let client = null;
let db = null;
let lastConnectError = null;

function getMongoUri() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is missing — add it to electron-app/.env');
  }
  return uri;
}

async function connect() {
  if (db) return db;
  const uri = getMongoUri();
  try {
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
    });
    await client.connect();
    db = client.db(DB_NAME);
    await ensureIndexes();
    await ensureMasterDataSeed();
    lastConnectError = null;
    console.log('MongoDB connected');
    return db;
  } catch (err) {
    lastConnectError = err;
    client = null;
    db = null;
    throw err;
  }
}

function getLastConnectError() {
  return lastConnectError;
}

function requireDb() {
  if (!db) {
    const hint = lastConnectError?.message || 'Connection never established';
    throw new Error(`Database not connected: ${hint}`);
  }
  return db;
}

async function disconnect() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

async function ensureIndexes() {
  await migrateLegacySchema();
  await db.collection('inventory_items').createIndex({ ItemCode: 1 }, { unique: true, sparse: true });
  await db.collection('clients').createIndex({ ClientCode: 1 }, { unique: true, sparse: true });
  await db.collection('sales').createIndex({ InvoiceNumber: 1 }, { unique: true, sparse: true });
  await db.collection('purchases').createIndex({ PurchaseNumber: 1 }, { unique: true, sparse: true });
  await db.collection('sales').createIndex({ ClientId: 1 });
  await db.collection('sales').createIndex({ PaymentStatus: 1 });
  await db.collection('master_data').createIndex({ Type: 1, Name: 1 }, { unique: true });
  await db.collection('master_data').createIndex({ Type: 1, SortOrder: 1 });
  await db.collection('inventory_history').createIndex({ InventoryItemId: 1, EventDate: 1 });
}

// Old MAUI schema used snake_case fields with non-sparse unique indexes.
// New docs use PascalCase, leaving snake_case null → duplicate key on 2nd insert.
async function dropLegacyIndex(collection, indexName) {
  const indexes = await collection.indexes();
  if (indexes.some((i) => i.name === indexName)) {
    await collection.dropIndex(indexName);
    console.log(`Dropped legacy index ${indexName}`);
  }
}

async function migrateLegacySchema() {
  const inventory = db.collection('inventory_items');
  await dropLegacyIndex(inventory, 'item_code_1');
  await inventory.updateMany(
    { ItemCode: { $exists: false }, item_code: { $exists: true, $ne: null } },
    [{ $set: { ItemCode: '$item_code' } }]
  );

  const clients = db.collection('clients');
  await dropLegacyIndex(clients, 'client_code_1');
  await clients.updateMany(
    { ClientCode: { $exists: false }, client_code: { $exists: true, $ne: null } },
    [{ $set: { ClientCode: '$client_code' } }]
  );

  const sales = db.collection('sales');
  await dropLegacyIndex(sales, 'invoice_number_1');
  await sales.updateMany(
    { InvoiceNumber: { $exists: false }, invoice_number: { $exists: true, $ne: null } },
    [{ $set: { InvoiceNumber: '$invoice_number' } }]
  );

  const purchases = db.collection('purchases');
  await dropLegacyIndex(purchases, 'purchase_number_1');
  await purchases.updateMany(
    { PurchaseNumber: { $exists: false }, purchase_number: { $exists: true, $ne: null } },
    [{ $set: { PurchaseNumber: '$purchase_number' } }]
  );
}

const MASTER_DATA_DEFAULTS = {
  category: ['Aluminum', 'Zinc', 'CTP', 'Other'],
  size: ['12x18', '18x24', '20x30', '25x35', '30x40', '32x45'],
  stock_name: ['Aluminum Plate', 'Zinc Plate', 'CTP Plate'],
};

async function ensureMasterDataSeed() {
  const cfg = await col('configuration').findOne({});
  for (const [type, defaults] of Object.entries(MASTER_DATA_DEFAULTS)) {
    const count = await col('master_data').countDocuments({ Type: type });
    if (count > 0) continue;
    let names = defaults;
    if (type === 'size' && cfg?.PlateSizes?.length) names = cfg.PlateSizes;
    const docs = names
      .map((Name, i) => ({
        Type: type,
        Name: String(Name).trim(),
        SortOrder: i,
        CreatedAt: new Date(),
        UpdatedAt: new Date(),
      }))
      .filter((d) => d.Name);
    if (docs.length) await col('master_data').insertMany(docs);
  }
}

function col(name) { return requireDb().collection(name); }
function oid(id) { try { return new ObjectId(id); } catch { return id; } }

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

async function getConfig() {
  const cfg = await col('configuration').findOne({});
  if (cfg) return cfg;
  const defaults = {
    CreditDays: 45,
    AlertDays: 48,
    CompanyName: 'Printing Plates Inventory',
    CompanyPhone: '',
    CompanyAddress: '',
    CompanyLogo: '',
    TaxRate: 0,
    LowStockThreshold: 10,
    SesFromEmail: 'info@alpha-devs.cloud',
    EmailSubjectTemplate: 'Payment Reminder - Invoice {InvoiceNumber}',
    EmailBodyTemplate: `Dear {ClientName},\n\nThis is a reminder that Invoice #{InvoiceNumber} dated {SaleDate} for PKR {Amount} is now {Days} days outstanding.\n\nOutstanding Balance: PKR {Balance}\n\nPlease arrange payment at your earliest convenience.\n\nRegards,\n{CompanyName}`,
    PlateSizes: ['12x18', '18x24', '20x30', '25x35', '30x40', '32x45'],
    OwnerEmails: [],
    OwnerDailyReminderEnabled: false,
    OwnerWhatsAppNumbers: [],
    OwnerWhatsAppReminderEnabled: false,
    OwnerLastDigestSentAt: null,
    UpdatedAt: new Date(),
  };
  await col('configuration').insertOne(defaults);
  return defaults;
}

async function saveConfig(config) {
  const { _id, ...data } = config;
  data.UpdatedAt = new Date();
  await col('configuration').updateOne({}, { $set: data }, { upsert: true });
  return data;
}

// ─── INVENTORY ───────────────────────────────────────────────────────────────

async function getAllInventory(search) {
  const query = search
    ? {
        $or: [
          { StockName: { $regex: search, $options: 'i' } },
          { ItemCode: { $regex: search, $options: 'i' } },
          { PlateSize: { $regex: search, $options: 'i' } },
          { Category: { $regex: search, $options: 'i' } },
        ],
      }
    : {};
  return col('inventory_items').find(query).sort({ StockName: 1 }).toArray();
}

async function getLowStock(threshold = 10) {
  return col('inventory_items')
    .find({ CurrentStock: { $lte: threshold }, IsActive: { $ne: false } })
    .sort({ CurrentStock: 1 })
    .toArray();
}

async function createItem(item) {
  if (!item.ItemCode) item.ItemCode = await generateItemCode();
  item.CreatedAt = new Date();
  item.UpdatedAt = new Date();
  item.IsActive = true;
  item.CurrentStock = Number(item.CurrentStock) || 0;
  item.PurchasePrice = Number(item.PurchasePrice) || 0;
  item.SalePrice = Number(item.SalePrice) || 0;
  item.ReorderLevel = Number(item.ReorderLevel) || 10;
  const result = await col('inventory_items').insertOne(item);
  const saved = { ...item, _id: result.insertedId };
  if (saved.CurrentStock > 0) {
    await logInventoryEvent({
      InventoryItemId: result.insertedId,
      ItemCode: saved.ItemCode,
      StockName: saved.StockName,
      PlateSize: saved.PlateSize || '',
      Unit: saved.Unit || 'Pcs',
      EventType: 'opening',
      QuantityChange: saved.CurrentStock,
      BalanceAfter: saved.CurrentStock,
      ReferenceType: 'manual',
      ReferenceNumber: '—',
      PartyName: '—',
      Notes: 'Opening stock',
      EventDate: saved.CreatedAt,
    });
  }
  return saved;
}

async function updateItem(item) {
  const { _id, ...data } = item;
  const existing = await col('inventory_items').findOne({ _id: oid(_id) });
  if (!existing) throw new Error('Item not found');

  const oldStock = Number(existing.CurrentStock) || 0;
  data.UpdatedAt = new Date();
  data.CurrentStock = Number(data.CurrentStock) || 0;
  data.PurchasePrice = Number(data.PurchasePrice) || 0;
  data.SalePrice = Number(data.SalePrice) || 0;
  data.ReorderLevel = Number(data.ReorderLevel) || 10;
  await col('inventory_items').updateOne({ _id: oid(_id) }, { $set: data });

  const stockDiff = data.CurrentStock - oldStock;
  if (stockDiff !== 0) {
    await logInventoryEvent({
      InventoryItemId: oid(_id),
      ItemCode: data.ItemCode || existing.ItemCode,
      StockName: data.StockName || existing.StockName,
      PlateSize: data.PlateSize || existing.PlateSize || '',
      Unit: data.Unit || existing.Unit || 'Pcs',
      EventType: 'adjustment',
      QuantityChange: stockDiff,
      BalanceAfter: data.CurrentStock,
      ReferenceType: 'manual',
      ReferenceNumber: '—',
      PartyName: '—',
      Notes: 'Manual stock adjustment',
      EventDate: new Date(),
    });
  }

  return { _id, ...data };
}

async function deleteItem(id) {
  await col('inventory_history').deleteMany({ InventoryItemId: oid(id) });
  await col('inventory_items').deleteOne({ _id: oid(id) });
}

function itemIdMatches(storedId, targetId) {
  if (storedId == null || targetId == null) return false;
  return storedId.toString() === targetId.toString();
}

async function logInventoryEvent(entry) {
  entry.CreatedAt = new Date();
  entry.EventDate = entry.EventDate ? new Date(entry.EventDate) : new Date();
  await col('inventory_history').insertOne(entry);
}

async function updateStock(itemId, quantityChange, meta = null) {
  const item = await col('inventory_items').findOne({ _id: oid(itemId) });
  if (!item) return;
  const change = Number(quantityChange) || 0;
  const newStock = (Number(item.CurrentStock) || 0) + change;
  await col('inventory_items').updateOne(
    { _id: oid(itemId) },
    { $inc: { CurrentStock: change }, $set: { UpdatedAt: new Date() } }
  );
  if (meta) {
    await logInventoryEvent({
      ...meta,
      InventoryItemId: oid(itemId),
      ItemCode: item.ItemCode,
      StockName: item.StockName,
      PlateSize: item.PlateSize || '',
      Unit: item.Unit || 'Pcs',
      QuantityChange: change,
      BalanceAfter: newStock,
      EventDate: meta.EventDate || new Date(),
    });
  }
}

async function rebuildInventoryHistory(itemId) {
  const item = await col('inventory_items').findOne({ _id: oid(itemId) });
  if (!item) throw new Error('Item not found');

  const idStr = oid(itemId).toString();
  const events = [];

  const purchases = await col('purchases').find({
    $or: [{ 'Items.InventoryItemId': idStr }, { 'Items.InventoryItemId': oid(itemId) }],
  }).toArray();

  for (const po of purchases) {
    if (!purchaseAppliesInventory(normalizePurchaseStatus(po.Status))) continue;
    for (const line of (po.Items || [])) {
      if (!itemIdMatches(line.InventoryItemId, itemId)) continue;
      const receivedQty = getLineReceivedQty(line);
      const varianceNote = receiptNoteForLine(line);
      events.push({
        EventType: 'purchase',
        EventDate: po.PurchaseDate || po.CreatedAt,
        QuantityChange: receivedQty,
        ReferenceType: 'purchase',
        ReferenceId: po._id,
        ReferenceNumber: po.PurchaseNumber || '—',
        PartyName: po.SupplierName || '—',
        UnitCost: Number(line.UnitCost) || 0,
        LineTotal: Number(line.ReceivedLineTotal) || receivedQty * (Number(line.UnitCost) || 0),
        Notes: [po.Notes, varianceNote].filter(Boolean).join(' · '),
      });
    }
  }

  const sales = await col('sales').find({
    $or: [{ 'Items.InventoryItemId': idStr }, { 'Items.InventoryItemId': oid(itemId) }],
  }).toArray();

  for (const sale of sales) {
    for (const line of (sale.Items || [])) {
      if (!itemIdMatches(line.InventoryItemId, itemId)) continue;
      const qty = Number(line.Quantity) || 0;
      events.push({
        EventType: 'sale',
        EventDate: sale.SaleDate || sale.CreatedAt,
        QuantityChange: -qty,
        ReferenceType: 'sale',
        ReferenceId: sale._id,
        ReferenceNumber: sale.InvoiceNumber || '—',
        PartyName: sale.ClientName || '—',
        UnitPrice: Number(line.UnitPrice) || 0,
        LineTotal: Number(line.LineTotal) || 0,
        Notes: sale.PaymentStatus === 'Returned' ? 'Sold (later returned)' : '',
      });
      if (sale.PaymentStatus === 'Returned') {
        events.push({
          EventType: 'return',
          EventDate: sale.UpdatedAt || sale.SaleDate || sale.CreatedAt,
          QuantityChange: qty,
          ReferenceType: 'sale',
          ReferenceId: sale._id,
          ReferenceNumber: sale.InvoiceNumber || '—',
          PartyName: sale.ClientName || '—',
          UnitPrice: Number(line.UnitPrice) || 0,
          LineTotal: Number(line.LineTotal) || 0,
          Notes: 'Invoice returned — stock restored',
        });
      }
    }
  }

  events.sort((a, b) => new Date(a.EventDate) - new Date(b.EventDate));

  let netChange = events.reduce((s, e) => s + e.QuantityChange, 0);
  const openingQty = (Number(item.CurrentStock) || 0) - netChange;
  if (openingQty !== 0) {
    events.unshift({
      EventType: 'opening',
      EventDate: item.CreatedAt || new Date(),
      QuantityChange: openingQty,
      ReferenceType: 'manual',
      ReferenceNumber: '—',
      PartyName: '—',
      Notes: openingQty > 0 ? 'Opening / initial stock (reconstructed)' : 'Historical adjustment (reconstructed)',
    });
  }

  let balance = 0;
  const docs = events.map((e) => {
    balance += e.QuantityChange;
    return {
      InventoryItemId: oid(itemId),
      ItemCode: item.ItemCode,
      StockName: item.StockName,
      PlateSize: item.PlateSize || '',
      Unit: item.Unit || 'Pcs',
      ...e,
      BalanceAfter: balance,
      CreatedAt: new Date(),
    };
  });

  const currentStock = Number(item.CurrentStock) || 0;
  if (docs.length > 0 && balance !== currentStock) {
    docs.push({
      InventoryItemId: oid(itemId),
      ItemCode: item.ItemCode,
      StockName: item.StockName,
      PlateSize: item.PlateSize || '',
      Unit: item.Unit || 'Pcs',
      EventType: 'adjustment',
      EventDate: new Date(),
      QuantityChange: currentStock - balance,
      BalanceAfter: currentStock,
      ReferenceType: 'manual',
      ReferenceNumber: '—',
      PartyName: '—',
      Notes: 'Reconciliation after rebuild',
      CreatedAt: new Date(),
    });
  }

  await col('inventory_history').deleteMany({ InventoryItemId: oid(itemId) });
  if (docs.length) await col('inventory_history').insertMany(docs);
  return docs;
}

async function getInventoryHistory(itemId) {
  const item = await col('inventory_items').findOne({ _id: oid(itemId) });
  if (!item) throw new Error('Item not found');

  const count = await col('inventory_history').countDocuments({ InventoryItemId: oid(itemId) });
  if (count === 0) await rebuildInventoryHistory(itemId);

  const events = await col('inventory_history')
    .find({ InventoryItemId: oid(itemId) })
    .sort({ EventDate: 1, CreatedAt: 1 })
    .toArray();

  return {
    item,
    events,
    currentStock: Number(item.CurrentStock) || 0,
  };
}

async function updatePurchasePrice(itemId, newPrice) {
  await col('inventory_items').updateOne(
    { _id: oid(itemId) },
    { $set: { PurchasePrice: newPrice, UpdatedAt: new Date() } }
  );
}

async function generateItemCode() {
  const last = await col('inventory_items').findOne({}, { sort: { ItemCode: -1 }, projection: { ItemCode: 1 } });
  if (!last || !last.ItemCode) return 'PLT001';
  const match = last.ItemCode.match(/(\d+)$/);
  const num = match ? parseInt(match[1]) + 1 : 1;
  return `PLT${String(num).padStart(3, '0')}`;
}

// ─── CLIENTS ─────────────────────────────────────────────────────────────────

async function getAllClients(search) {
  const query = search
    ? {
        $or: [
          { Name: { $regex: search, $options: 'i' } },
          { Phone: { $regex: search, $options: 'i' } },
          { ClientCode: { $regex: search, $options: 'i' } },
        ],
      }
    : {};
  const clients = await col('clients').find(query).sort({ Name: 1 }).toArray();
  for (const c of clients) {
    const bal = await getClientBalance(c._id.toString());
    c.TotalSales = bal.totalSales;
    c.TotalPaid = bal.totalPaid;
    c.OutstandingBalance = bal.outstanding;
  }
  return clients;
}

async function getClientBalance(clientId) {
  const sales = await col('sales').find({ ClientId: clientId }).toArray();
  const totalSales = sales.reduce((s, x) => s + (x.TotalAmount || 0), 0);
  const totalPaid = sales.reduce((s, x) => s + (x.PaidAmount || 0), 0);
  return { totalSales, totalPaid, outstanding: totalSales - totalPaid };
}

async function createClient(client) {
  client.ClientCode = await generateClientCode();
  client.CreatedAt = new Date();
  client.UpdatedAt = new Date();
  client.IsActive = true;
  client.CreditLimit = Number(client.CreditLimit) || 0;
  const result = await col('clients').insertOne(client);
  return { ...client, _id: result.insertedId };
}

async function updateClient(client) {
  const { _id, ...data } = client;
  data.UpdatedAt = new Date();
  await col('clients').updateOne({ _id: oid(_id) }, { $set: data });
  return { _id, ...data };
}

async function deleteClient(id) {
  await col('clients').deleteOne({ _id: oid(id) });
}

async function getClientLedger(clientId) {
  return col('sales').find({ ClientId: clientId }).sort({ SaleDate: -1 }).toArray();
}

async function generateClientCode() {
  const last = await col('clients').findOne({}, { sort: { ClientCode: -1 }, projection: { ClientCode: 1 } });
  if (!last || !last.ClientCode) return 'CLT-0001';
  const match = last.ClientCode.match(/(\d+)$/);
  const num = match ? parseInt(match[1]) + 1 : 1;
  return `CLT-${String(num).padStart(4, '0')}`;
}

// ─── SALES ───────────────────────────────────────────────────────────────────

async function getAllSales(search, status) {
  const query = {};
  if (status && status !== 'All') query.PaymentStatus = status;
  if (search) {
    query.$or = [
      { InvoiceNumber: { $regex: search, $options: 'i' } },
      { ClientName: { $regex: search, $options: 'i' } },
    ];
  }
  return col('sales').find(query).sort({ SaleDate: -1 }).toArray();
}

async function createSale(sale) {
  const cfg = await getConfig();
  sale.InvoiceNumber = await generateInvoiceNumber();
  sale.SaleDate = sale.SaleDate ? new Date(sale.SaleDate) : new Date();
  sale.DueDate = new Date(sale.SaleDate.getTime() + (Number(cfg.CreditDays) || 45) * 24 * 3600 * 1000);
  sale.CreatedAt = new Date();
  sale.UpdatedAt = new Date();
  sale.AlertSent = false;

  // Compute totals
  sale.Subtotal = sale.Items.reduce((s, i) => s + (Number(i.LineTotal) || 0), 0);
  sale.OverallDiscount = Number(sale.OverallDiscount) || 0;
  const taxable = sale.Subtotal - sale.OverallDiscount;
  sale.TaxAmount = taxable * (Number(cfg.TaxRate) || 0) / 100;
  sale.TotalAmount = taxable + sale.TaxAmount;
  sale.PaidAmount = Number(sale.PaidAmount) || 0;
  sale.Balance = sale.TotalAmount - sale.PaidAmount;
  sale.TotalProfit = sale.Items.reduce((s, i) => s + (Number(i.TotalProfit) || 0), 0);
  sale.PaymentStatus = deriveStatus(sale);

  // Build initial payment history entry if upfront payment was made
  const initPayment = sale.InitialPayment || {};
  sale.PaymentHistory = sale.PaidAmount > 0
    ? [{
        Amount: sale.PaidAmount,
        PaymentType: initPayment.PaymentType || 'Cash',
        ReferenceId: initPayment.ReferenceId || '',
        ProofUrl: initPayment.ProofUrl || '',
        Notes: initPayment.Notes || '',
        PaidAt: new Date(),
      }]
    : [];
  delete sale.InitialPayment; // don't store separately

  const result = await col('sales').insertOne(sale);
  const saved = { ...sale, _id: result.insertedId };

  for (const item of saved.Items) {
    if (!item.InventoryItemId) continue;
    await updateStock(item.InventoryItemId, -Number(item.Quantity), {
      EventType: 'sale',
      ReferenceType: 'sale',
      ReferenceId: saved._id,
      ReferenceNumber: saved.InvoiceNumber,
      PartyName: saved.ClientName || '—',
      UnitPrice: Number(item.UnitPrice) || 0,
      LineTotal: Number(item.LineTotal) || 0,
      EventDate: saved.SaleDate,
      Notes: '',
    });
  }

  return saved;
}

async function updateSale(sale) {
  const { _id, ...data } = sale;
  const existing = await col('sales').findOne({ _id: oid(_id) });
  if (!existing) throw new Error('Sale not found');
  if (existing.PaymentStatus === 'Returned') throw new Error('Returned invoices cannot be edited');

  const cfg = await getConfig();

  for (const item of (existing.Items || [])) {
    if (!item.InventoryItemId) continue;
    await updateStock(item.InventoryItemId, Number(item.Quantity), {
      EventType: 'sale_reversal',
      ReferenceType: 'sale',
      ReferenceId: existing._id,
      ReferenceNumber: existing.InvoiceNumber,
      PartyName: existing.ClientName || '—',
      UnitPrice: Number(item.UnitPrice) || 0,
      LineTotal: Number(item.LineTotal) || 0,
      EventDate: existing.SaleDate,
      Notes: 'Invoice edited — stock restored',
    });
  }

  const saleDate = data.SaleDate ? new Date(data.SaleDate) : existing.SaleDate;
  const dueDate = new Date(saleDate.getTime() + (Number(cfg.CreditDays) || 45) * 24 * 3600 * 1000);
  const items = data.Items || [];
  const subtotal = items.reduce((s, i) => s + (Number(i.LineTotal) || 0), 0);
  const overallDiscount = Number(data.OverallDiscount) || 0;
  const taxable = subtotal - overallDiscount;
  const taxAmount = taxable * (Number(cfg.TaxRate) || 0) / 100;
  const totalAmount = taxable + taxAmount;
  const paidAmount = Number(existing.PaidAmount) || 0;
  const balance = totalAmount - paidAmount;
  const totalProfit = items.reduce((s, i) => s + (Number(i.TotalProfit) || 0), 0) - overallDiscount;

  const updated = {
    ClientId: data.ClientId,
    ClientName: data.ClientName,
    ClientPhone: data.ClientPhone || '',
    ClientEmail: data.ClientEmail || '',
    Items: items,
    Subtotal: subtotal,
    OverallDiscount: overallDiscount,
    TaxAmount: taxAmount,
    TotalAmount: totalAmount,
    PaidAmount: paidAmount,
    Balance: balance,
    TotalProfit: totalProfit,
    PaymentStatus: deriveStatus({ PaidAmount: paidAmount, TotalAmount: totalAmount }),
    SaleDate: saleDate,
    DueDate: dueDate,
    Notes: data.Notes !== undefined ? data.Notes : (existing.Notes || ''),
    UpdatedAt: new Date(),
  };

  await col('sales').updateOne({ _id: oid(_id) }, { $set: updated });
  const saved = { ...existing, ...updated, _id: existing._id };

  for (const item of saved.Items) {
    if (!item.InventoryItemId) continue;
    await updateStock(item.InventoryItemId, -Number(item.Quantity), {
      EventType: 'sale',
      ReferenceType: 'sale',
      ReferenceId: saved._id,
      ReferenceNumber: saved.InvoiceNumber,
      PartyName: saved.ClientName || '—',
      UnitPrice: Number(item.UnitPrice) || 0,
      LineTotal: Number(item.LineTotal) || 0,
      EventDate: saved.SaleDate,
      Notes: 'Invoice edited',
    });
  }

  return saved;
}

function deriveStatus(sale) {
  if (sale.PaidAmount <= 0) return 'Unpaid';
  if (sale.PaidAmount >= sale.TotalAmount) return 'Paid';
  return 'Partial';
}

// Records an individual payment installment and appends it to PaymentHistory.
// paymentEntry: { Amount, PaymentType, ReferenceId, ProofUrl, Notes }
async function recordPayment(saleId, paymentEntry) {
  const sale = await col('sales').findOne({ _id: oid(saleId) });
  if (!sale) throw new Error('Sale not found');

  const entry = {
    Amount:      Number(paymentEntry.Amount) || 0,
    PaymentType: paymentEntry.PaymentType || 'Cash',
    ReferenceId: paymentEntry.ReferenceId || '',
    ProofUrl:    paymentEntry.ProofUrl || '',
    Notes:       paymentEntry.Notes || '',
    PaidAt:      new Date(),
  };

  const history = [...(sale.PaymentHistory || []), entry];
  const totalPaid = history.reduce((s, p) => s + p.Amount, 0);
  const balance = sale.TotalAmount - totalPaid;
  const status = totalPaid <= 0 ? 'Unpaid' : totalPaid >= sale.TotalAmount ? 'Paid' : 'Partial';

  await col('sales').updateOne(
    { _id: oid(saleId) },
    { $set: { PaymentHistory: history, PaidAmount: totalPaid, Balance: balance, PaymentStatus: status, UpdatedAt: new Date() } }
  );
  return { PaidAmount: totalPaid, Balance: balance, PaymentStatus: status };
}

async function markSaleReturned(saleId) {
  const sale = await col('sales').findOne({ _id: oid(saleId) });
  if (!sale) throw new Error('Sale not found');
  if (sale.PaymentStatus === 'Returned') return; // already returned
  for (const item of (sale.Items || [])) {
    if (!item.InventoryItemId) continue;
    await updateStock(item.InventoryItemId, Number(item.Quantity), {
      EventType: 'return',
      ReferenceType: 'sale',
      ReferenceId: sale._id,
      ReferenceNumber: sale.InvoiceNumber,
      PartyName: sale.ClientName || '—',
      UnitPrice: Number(item.UnitPrice) || 0,
      LineTotal: Number(item.LineTotal) || 0,
      EventDate: new Date(),
      Notes: 'Invoice marked as returned',
    });
  }
  await col('sales').updateOne(
    { _id: oid(saleId) },
    { $set: { PaymentStatus: 'Returned', Balance: 0, UpdatedAt: new Date() } }
  );
}

async function deleteSale(id) {
  const sale = await col('sales').findOne({ _id: oid(id) });
  if (!sale) return;
  if (sale.PaymentStatus !== 'Returned') {
    for (const item of (sale.Items || [])) {
      if (!item.InventoryItemId) continue;
      await updateStock(item.InventoryItemId, Number(item.Quantity), {
        EventType: 'sale_reversal',
        ReferenceType: 'sale',
        ReferenceId: sale._id,
        ReferenceNumber: sale.InvoiceNumber,
        PartyName: sale.ClientName || '—',
        UnitPrice: Number(item.UnitPrice) || 0,
        LineTotal: Number(item.LineTotal) || 0,
        EventDate: new Date(),
        Notes: 'Invoice deleted — stock restored',
      });
    }
  }
  await col('sales').deleteOne({ _id: oid(id) });
}

async function getTotalSales() {
  const result = await col('sales').aggregate([{ $group: { _id: null, total: { $sum: '$TotalAmount' } } }]).toArray();
  return result[0]?.total || 0;
}

async function getTotalProfit() {
  const result = await col('sales').aggregate([{ $group: { _id: null, total: { $sum: '$TotalProfit' } } }]).toArray();
  return result[0]?.total || 0;
}

async function getTotalOutstanding() {
  const result = await col('sales')
    .aggregate([{ $match: { PaymentStatus: { $in: ['Unpaid', 'Partial'] } } }, { $group: { _id: null, total: { $sum: '$Balance' } } }])
    .toArray();
  return result[0]?.total || 0;
}

async function getOverdueSales(creditDays) {
  const cutoff = new Date(Date.now() - creditDays * 24 * 3600 * 1000);
  return col('sales')
    .find({ PaymentStatus: { $in: ['Unpaid', 'Partial'] }, SaleDate: { $lt: cutoff } })
    .sort({ SaleDate: 1 })
    .toArray();
}

async function getPendingAlerts(alertDays) {
  const cutoff = new Date(Date.now() - alertDays * 24 * 3600 * 1000);
  return col('sales')
    .find({ PaymentStatus: { $in: ['Unpaid', 'Partial'] }, AlertSent: { $ne: true }, SaleDate: { $lte: cutoff } })
    .toArray();
}

async function markAlertSent(saleId) {
  await col('sales').updateOne(
    { _id: oid(saleId) },
    { $set: { AlertSent: true, AlertSentAt: new Date() } }
  );
}

async function getPendingPaymentSales() {
  return col('sales')
    .find({ PaymentStatus: { $in: ['Unpaid', 'Partial'] } })
    .sort({ SaleDate: 1 })
    .toArray();
}

async function markOwnerDigestSent() {
  await col('configuration').updateOne(
    {},
    { $set: { OwnerLastDigestSentAt: new Date(), UpdatedAt: new Date() } }
  );
}

async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const last = await col('sales').findOne({ InvoiceNumber: { $regex: `INV-${year}` } }, { sort: { InvoiceNumber: -1 } });
  if (!last) return `INV-${year}-0001`;
  const match = last.InvoiceNumber.match(/(\d+)$/);
  const num = match ? parseInt(match[1]) + 1 : 1;
  return `INV-${year}-${String(num).padStart(4, '0')}`;
}

// ─── PURCHASES ───────────────────────────────────────────────────────────────

const PO_STATUSES = ['Pending', 'Received', 'Not Delivered', 'Out of Stock', 'Cancelled'];

function normalizePurchaseStatus(status) {
  if (!status) return 'Received'; // legacy POs that already applied stock
  return PO_STATUSES.includes(status) ? status : 'Pending';
}

function purchaseAppliesInventory(status) {
  return normalizePurchaseStatus(status) === 'Received';
}

function getLineOrderedQty(line) {
  return Number(line?.Quantity) || 0;
}

function getLineReceivedQty(line) {
  if (line?.ReceivedQuantity != null && line.ReceivedQuantity !== '') {
    return Number(line.ReceivedQuantity) || 0;
  }
  return getLineOrderedQty(line);
}

function enrichPurchaseLine(line) {
  const orderedQty = getLineOrderedQty(line);
  const receivedQty = getLineReceivedQty(line);
  const unitCost = Number(line.UnitCost) || 0;
  return {
    ...line,
    Quantity: orderedQty,
    ReceivedQuantity: receivedQty,
    LineTotal: orderedQty * unitCost,
    ReceivedLineTotal: receivedQty * unitCost,
  };
}

function enrichPurchaseItems(items) {
  return (items || []).map(enrichPurchaseLine);
}

function computeOrderedTotal(items) {
  return enrichPurchaseItems(items).reduce((s, i) => s + i.LineTotal, 0);
}

function computeReceivedTotal(items) {
  return enrichPurchaseItems(items).reduce((s, i) => s + i.ReceivedLineTotal, 0);
}

function purchaseHasVariedReceipt(items) {
  return enrichPurchaseItems(items).some((i) => i.ReceivedQuantity !== i.Quantity);
}

function applyReceivedQuantities(items, receivedItems) {
  const lines = enrichPurchaseItems(items);
  return lines.map((line) => {
    const match = (receivedItems || []).find((r) => itemIdMatches(r.InventoryItemId, line.InventoryItemId));
    const receivedQty = match ? Number(match.ReceivedQuantity) : line.Quantity;
    if (Number.isNaN(receivedQty) || receivedQty < 0) {
      throw new Error(`Invalid received quantity for ${line.ItemName || 'item'}`);
    }
    return enrichPurchaseLine({ ...line, ReceivedQuantity: receivedQty });
  });
}

function preparePurchaseTotals(items, status) {
  const enriched = enrichPurchaseItems(items);
  const orderedTotal = enriched.reduce((s, i) => s + i.LineTotal, 0);
  const receivedTotal = enriched.reduce((s, i) => s + i.ReceivedLineTotal, 0);
  return {
    Items: enriched,
    OrderedTotalCost: orderedTotal,
    TotalCost: purchaseAppliesInventory(status) ? receivedTotal : orderedTotal,
    ReceiptVaried: purchaseHasVariedReceipt(enriched),
  };
}

function receiptNoteForLine(line) {
  const ordered = getLineOrderedQty(line);
  const received = getLineReceivedQty(line);
  if (received === ordered) return '';
  return `Ordered ${ordered}, received ${received}`;
}

async function applyPurchaseInventory(purchase, multiplier) {
  for (const item of enrichPurchaseItems(purchase.Items || [])) {
    if (!item.InventoryItemId) continue;
    const qty = multiplier * getLineReceivedQty(item);
    if (qty === 0) continue;
    const varianceNote = receiptNoteForLine(item);
    const baseMeta = {
      ReferenceType: 'purchase',
      ReferenceId: purchase._id,
      ReferenceNumber: purchase.PurchaseNumber || '—',
      PartyName: purchase.SupplierName || '—',
      UnitCost: Number(item.UnitCost) || 0,
      LineTotal: Number(item.ReceivedLineTotal) || 0,
    };
    const notes = [purchase.Notes, varianceNote].filter(Boolean).join(' · ');
    const meta = multiplier > 0
      ? {
          ...baseMeta,
          EventType: 'purchase',
          EventDate: purchase.PurchaseDate || purchase.CreatedAt,
          Notes: notes,
        }
      : {
          ...baseMeta,
          EventType: 'purchase_reversal',
          EventDate: new Date(),
          Notes: `PO reversed (${normalizePurchaseStatus(purchase.Status)})${varianceNote ? ` · ${varianceNote}` : ''}`,
        };
    await updateStock(item.InventoryItemId, qty, meta);
    if (multiplier > 0) {
      await updatePurchasePrice(item.InventoryItemId, Number(item.UnitCost));
    }
  }
}

async function getAllPurchases() {
  return col('purchases').find({}).sort({ PurchaseDate: -1 }).toArray();
}

async function getPurchaseSummary() {
  const purchases = await getAllPurchases();
  let receivedCost = 0;
  let pendingCost = 0;
  let pendingCount = 0;
  let receivedCount = 0;
  for (const p of purchases) {
    const status = normalizePurchaseStatus(p.Status);
    const orderedCost = Number(p.OrderedTotalCost ?? p.TotalCost) || 0;
    const bookCost = Number(p.TotalCost) || 0;
    if (status === 'Received') {
      receivedCost += bookCost;
      receivedCount++;
    } else if (status === 'Pending') {
      pendingCost += orderedCost;
      pendingCount++;
    }
  }
  return { receivedCost, pendingCost, pendingCount, receivedCount, totalOrders: purchases.length };
}

async function createPurchase(purchase) {
  purchase.PurchaseNumber = await generatePurchaseNumber();
  purchase.PurchaseDate = purchase.PurchaseDate ? new Date(purchase.PurchaseDate) : new Date();
  purchase.CreatedAt = new Date();
  purchase.UpdatedAt = new Date();
  purchase.Status = normalizePurchaseStatus(purchase.Status || 'Pending');
  purchase.StatusNotes = String(purchase.StatusNotes || '').trim();
  purchase.StatusUpdatedAt = new Date();

  let items = purchase.Items || [];
  if (purchaseAppliesInventory(purchase.Status) && purchase.ReceivedItems) {
    items = applyReceivedQuantities(items, purchase.ReceivedItems);
  }
  const totals = preparePurchaseTotals(items, purchase.Status);
  purchase.Items = totals.Items;
  purchase.OrderedTotalCost = totals.OrderedTotalCost;
  purchase.TotalCost = totals.TotalCost;
  purchase.ReceiptVaried = totals.ReceiptVaried;
  delete purchase.ReceivedItems;

  const result = await col('purchases').insertOne(purchase);
  const saved = { ...purchase, _id: result.insertedId };

  if (purchaseAppliesInventory(saved.Status)) {
    await applyPurchaseInventory(saved, 1);
  }

  return saved;
}

async function updatePurchase(purchase) {
  const { _id, ...data } = purchase;
  const existing = await col('purchases').findOne({ _id: oid(_id) });
  if (!existing) throw new Error('Purchase not found');

  const oldStatus = normalizePurchaseStatus(existing.Status);
  const newStatus = normalizePurchaseStatus(data.Status ?? existing.Status);

  if (purchaseAppliesInventory(oldStatus)) {
    await applyPurchaseInventory(existing, -1);
  }

  let items = data.Items || existing.Items || [];
  if (data.ReceivedItems) {
    items = applyReceivedQuantities(items, data.ReceivedItems);
  }
  const totals = preparePurchaseTotals(items, newStatus);
  data.Items = totals.Items;
  data.OrderedTotalCost = totals.OrderedTotalCost;
  data.TotalCost = totals.TotalCost;
  data.ReceiptVaried = totals.ReceiptVaried;
  delete data.ReceivedItems;
  data.Status = newStatus;
  data.StatusNotes = data.StatusNotes !== undefined
    ? String(data.StatusNotes || '').trim()
    : (existing.StatusNotes || '');
  data.StatusUpdatedAt = new Date();
  data.UpdatedAt = new Date();
  if (data.PurchaseDate) data.PurchaseDate = new Date(data.PurchaseDate);
  await col('purchases').updateOne({ _id: oid(_id) }, { $set: data });

  const updated = { ...existing, ...data, _id: existing._id };
  if (purchaseAppliesInventory(newStatus)) {
    await applyPurchaseInventory(updated, 1);
  }

  return { _id, ...data };
}

async function updatePurchaseStatus(id, status, statusNotes, receivedItems) {
  const existing = await col('purchases').findOne({ _id: oid(id) });
  if (!existing) throw new Error('Purchase not found');

  const oldStatus = normalizePurchaseStatus(existing.Status);
  const newStatus = normalizePurchaseStatus(status);
  if (!PO_STATUSES.includes(newStatus)) throw new Error('Invalid purchase status');

  if (purchaseAppliesInventory(oldStatus)) {
    await applyPurchaseInventory(existing, -1);
  }

  let items = existing.Items || [];
  if (purchaseAppliesInventory(newStatus)) {
    if (receivedItems && receivedItems.length) {
      items = applyReceivedQuantities(items, receivedItems);
    } else if (!purchaseAppliesInventory(oldStatus)) {
      items = applyReceivedQuantities(items, items.map((line) => ({
        InventoryItemId: line.InventoryItemId,
        ReceivedQuantity: getLineOrderedQty(line),
      })));
    }
  }

  const totals = preparePurchaseTotals(items, newStatus);
  const notes = statusNotes !== undefined ? String(statusNotes || '').trim() : (existing.StatusNotes || '');
  const update = {
    Status: newStatus,
    StatusNotes: notes,
    Items: totals.Items,
    OrderedTotalCost: totals.OrderedTotalCost,
    TotalCost: totals.TotalCost,
    ReceiptVaried: totals.ReceiptVaried,
    StatusUpdatedAt: new Date(),
    UpdatedAt: new Date(),
  };
  await col('purchases').updateOne({ _id: oid(id) }, { $set: update });

  const updated = { ...existing, ...update };
  if (purchaseAppliesInventory(newStatus)) {
    await applyPurchaseInventory(updated, 1);
  }
  return updated;
}

async function deletePurchase(id) {
  const purchase = await col('purchases').findOne({ _id: oid(id) });
  if (!purchase) return;
  if (purchaseAppliesInventory(normalizePurchaseStatus(purchase.Status))) {
    await applyPurchaseInventory(purchase, -1);
  }
  await col('purchases').deleteOne({ _id: oid(id) });
}

async function generatePurchaseNumber() {
  const year = new Date().getFullYear();
  const last = await col('purchases').findOne({ PurchaseNumber: { $regex: `PO-${year}` } }, { sort: { PurchaseNumber: -1 } });
  if (!last) return `PO-${year}-0001`;
  const match = last.PurchaseNumber.match(/(\d+)$/);
  const num = match ? parseInt(match[1]) + 1 : 1;
  return `PO-${year}-${String(num).padStart(4, '0')}`;
}

// ─── SUPPLIERS ───────────────────────────────────────────────────────────────

async function getAllSuppliers(search) {
  const query = search
    ? {
        $or: [
          { Name: { $regex: search, $options: 'i' } },
          { ContactPerson: { $regex: search, $options: 'i' } },
          { Phone: { $regex: search, $options: 'i' } },
          { SupplierCode: { $regex: search, $options: 'i' } },
        ],
      }
    : {};
  return col('suppliers').find(query).sort({ Name: 1 }).toArray();
}

async function createSupplier(supplier) {
  supplier.SupplierCode = await generateSupplierCode();
  supplier.CreatedAt = new Date();
  supplier.UpdatedAt = new Date();
  supplier.IsActive = true;
  const result = await col('suppliers').insertOne(supplier);
  return { ...supplier, _id: result.insertedId };
}

async function updateSupplier(supplier) {
  const { _id, ...data } = supplier;
  data.UpdatedAt = new Date();
  await col('suppliers').updateOne({ _id: oid(_id) }, { $set: data });
  return { _id, ...data };
}

async function deleteSupplier(id) {
  await col('suppliers').deleteOne({ _id: oid(id) });
}

async function generateSupplierCode() {
  const last = await col('suppliers').findOne({}, { sort: { SupplierCode: -1 }, projection: { SupplierCode: 1 } });
  if (!last || !last.SupplierCode) return 'SUP-0001';
  const match = last.SupplierCode.match(/(\d+)$/);
  const num = match ? parseInt(match[1]) + 1 : 1;
  return `SUP-${String(num).padStart(4, '0')}`;
}

// ─── MASTER DATA (categories, sizes, stock names) ────────────────────────────

async function getMasterData(type) {
  const query = type ? { Type: type } : {};
  return col('master_data').find(query).sort({ SortOrder: 1, Name: 1 }).toArray();
}

async function getMasterDataLists() {
  const all = await getMasterData();
  const lists = { categories: [], sizes: [], stockNames: [] };
  for (const row of all) {
    if (row.Type === 'category') lists.categories.push(row.Name);
    else if (row.Type === 'size') lists.sizes.push(row.Name);
    else if (row.Type === 'stock_name') lists.stockNames.push(row.Name);
  }
  return lists;
}

async function createMasterDataEntry({ Type, Name }) {
  const name = String(Name || '').trim();
  if (!name) throw new Error('Name is required');
  if (!['category', 'size', 'stock_name'].includes(Type)) throw new Error('Invalid type');
  const dup = await col('master_data').findOne({ Type, Name: name });
  if (dup) throw new Error('This entry already exists');
  const maxSort = await col('master_data').findOne({ Type }, { sort: { SortOrder: -1 }, projection: { SortOrder: 1 } });
  const doc = {
    Type,
    Name: name,
    SortOrder: (maxSort?.SortOrder ?? -1) + 1,
    CreatedAt: new Date(),
    UpdatedAt: new Date(),
  };
  const result = await col('master_data').insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function updateMasterDataEntry({ _id, Name }) {
  const name = String(Name || '').trim();
  if (!name) throw new Error('Name is required');
  const existing = await col('master_data').findOne({ _id: oid(_id) });
  if (!existing) throw new Error('Entry not found');
  const dup = await col('master_data').findOne({ Type: existing.Type, Name: name, _id: { $ne: oid(_id) } });
  if (dup) throw new Error('This entry already exists');
  await col('master_data').updateOne({ _id: oid(_id) }, { $set: { Name: name, UpdatedAt: new Date() } });
  return { ...existing, Name: name };
}

async function deleteMasterDataEntry(id) {
  await col('master_data').deleteOne({ _id: oid(id) });
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

async function getDashboardMetrics() {
  const cfg = await getConfig();
  const [totalSales, totalProfit, totalOutstanding] = await Promise.all([
    getTotalSales(),
    getTotalProfit(),
    getTotalOutstanding(),
  ]);
  const stockValueAgg = await col('inventory_items')
    .aggregate([{ $group: { _id: null, val: { $sum: { $multiply: ['$CurrentStock', '$PurchasePrice'] } } } }])
    .toArray();
  const stockValue = stockValueAgg[0]?.val || 0;
  const totalClients = await col('clients').countDocuments({});
  const totalItems = await col('inventory_items').countDocuments({ IsActive: { $ne: false } });
  const totalStockAgg = await col('inventory_items')
    .aggregate([{ $group: { _id: null, total: { $sum: '$CurrentStock' } } }]).toArray();
  const totalStock = totalStockAgg[0]?.total || 0;
  const lowStockItems = await getLowStock(cfg.LowStockThreshold);
  const overdueSales = await getOverdueSales(cfg.CreditDays);

  const approachWarn = new Date(Date.now() - (cfg.CreditDays - 5) * 24 * 3600 * 1000);
  const approachingCount = await col('sales').countDocuments({
    PaymentStatus: { $in: ['Unpaid', 'Partial'] },
    SaleDate: { $lt: approachWarn, $gt: new Date(Date.now() - cfg.CreditDays * 24 * 3600 * 1000) },
  });

  const recentSales = await col('sales').find({}).sort({ SaleDate: -1 }).limit(10).toArray();

  return {
    totalSales,
    totalProfit,
    stockValue,
    totalOutstanding,
    totalClients,
    totalItems,
    totalStock,
    lowStockCount: lowStockItems.length,
    overdueCount: overdueSales.length,
    approachingCount,
    lowStockItems,
    overdueSales,
    recentSales,
  };
}

module.exports = {
  connect,
  disconnect,
  getLastConnectError,
  getConfig, saveConfig,
  getAllInventory, getLowStock, createItem, updateItem, deleteItem, updateStock, getInventoryHistory, rebuildInventoryHistory,
  getAllClients, createClient, updateClient, deleteClient, getClientLedger, getClientBalance,
  getAllSales, createSale, updateSale, recordPayment, markSaleReturned, deleteSale,
  getTotalSales, getTotalProfit, getTotalOutstanding, getOverdueSales, getPendingAlerts, markAlertSent,
  getPendingPaymentSales, markOwnerDigestSent,
  getAllPurchases, createPurchase, updatePurchase, updatePurchaseStatus, deletePurchase, getPurchaseSummary,
  getAllSuppliers, createSupplier, updateSupplier, deleteSupplier,
  getMasterData, getMasterDataLists, createMasterDataEntry, updateMasterDataEntry, deleteMasterDataEntry,
  getDashboardMetrics,
};
