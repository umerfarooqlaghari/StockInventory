'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME   = process.env.MONGO_DB_NAME || 'StockInventoryDB';

let client = null;
let db = null;

async function connect() {
  if (db) return db;
  client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  db = client.db(DB_NAME);
  await ensureIndexes();
  console.log('MongoDB connected');
  return db;
}

async function ensureIndexes() {
  await db.collection('inventory_items').createIndex({ ItemCode: 1 }, { unique: true, sparse: true });
  await db.collection('clients').createIndex({ ClientCode: 1 }, { unique: true, sparse: true });
  await db.collection('sales').createIndex({ InvoiceNumber: 1 }, { unique: true, sparse: true });
  await db.collection('purchases').createIndex({ PurchaseNumber: 1 }, { unique: true, sparse: true });
  await db.collection('sales').createIndex({ ClientId: 1 });
  await db.collection('sales').createIndex({ PaymentStatus: 1 });
}

function col(name) { return db.collection(name); }
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
    TaxRate: 0,
    LowStockThreshold: 10,
    SesFromEmail: 'info@alpha-devs.cloud',
    EmailSubjectTemplate: 'Payment Reminder - Invoice {InvoiceNumber}',
    EmailBodyTemplate: `Dear {ClientName},\n\nThis is a reminder that Invoice #{InvoiceNumber} dated {SaleDate} for PKR {Amount} is now {Days} days outstanding.\n\nOutstanding Balance: PKR {Balance}\n\nPlease arrange payment at your earliest convenience.\n\nRegards,\n{CompanyName}`,
    PlateSizes: ['12x18', '18x24', '20x30', '25x35', '30x40', '32x45'],
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
  return { ...item, _id: result.insertedId };
}

async function updateItem(item) {
  const { _id, ...data } = item;
  data.UpdatedAt = new Date();
  data.CurrentStock = Number(data.CurrentStock) || 0;
  data.PurchasePrice = Number(data.PurchasePrice) || 0;
  data.SalePrice = Number(data.SalePrice) || 0;
  data.ReorderLevel = Number(data.ReorderLevel) || 10;
  await col('inventory_items').updateOne({ _id: oid(_id) }, { $set: data });
  return { _id, ...data };
}

async function deleteItem(id) {
  await col('inventory_items').deleteOne({ _id: oid(id) });
}

async function updateStock(itemId, quantityChange) {
  await col('inventory_items').updateOne(
    { _id: oid(itemId) },
    { $inc: { CurrentStock: quantityChange }, $set: { UpdatedAt: new Date() } }
  );
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

  const result = await col('sales').insertOne(sale);

  // Deduct stock
  for (const item of sale.Items) {
    if (item.InventoryItemId) await updateStock(item.InventoryItemId, -Number(item.Quantity));
  }

  return { ...sale, _id: result.insertedId };
}

function deriveStatus(sale) {
  if (sale.PaidAmount <= 0) return 'Unpaid';
  if (sale.PaidAmount >= sale.TotalAmount) return 'Paid';
  return 'Partial';
}

async function updatePayment(saleId, newPaidAmount) {
  const sale = await col('sales').findOne({ _id: oid(saleId) });
  if (!sale) throw new Error('Sale not found');
  const paid = Number(newPaidAmount);
  const status = paid <= 0 ? 'Unpaid' : paid >= sale.TotalAmount ? 'Paid' : 'Partial';
  await col('sales').updateOne(
    { _id: oid(saleId) },
    { $set: { PaidAmount: paid, Balance: sale.TotalAmount - paid, PaymentStatus: status, UpdatedAt: new Date() } }
  );
}

async function markSaleReturned(saleId) {
  const sale = await col('sales').findOne({ _id: oid(saleId) });
  if (!sale) throw new Error('Sale not found');
  if (sale.PaymentStatus === 'Returned') return; // already returned
  for (const item of (sale.Items || [])) {
    if (item.InventoryItemId) await updateStock(item.InventoryItemId, Number(item.Quantity));
  }
  await col('sales').updateOne(
    { _id: oid(saleId) },
    { $set: { PaymentStatus: 'Returned', Balance: 0, UpdatedAt: new Date() } }
  );
}

async function deleteSale(id) {
  const sale = await col('sales').findOne({ _id: oid(id) });
  if (!sale) return;
  // Restore stock
  for (const item of (sale.Items || [])) {
    if (item.InventoryItemId) await updateStock(item.InventoryItemId, Number(item.Quantity));
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

async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const last = await col('sales').findOne({ InvoiceNumber: { $regex: `INV-${year}` } }, { sort: { InvoiceNumber: -1 } });
  if (!last) return `INV-${year}-0001`;
  const match = last.InvoiceNumber.match(/(\d+)$/);
  const num = match ? parseInt(match[1]) + 1 : 1;
  return `INV-${year}-${String(num).padStart(4, '0')}`;
}

// ─── PURCHASES ───────────────────────────────────────────────────────────────

async function getAllPurchases() {
  return col('purchases').find({}).sort({ PurchaseDate: -1 }).toArray();
}

async function createPurchase(purchase) {
  purchase.PurchaseNumber = await generatePurchaseNumber();
  purchase.PurchaseDate = purchase.PurchaseDate ? new Date(purchase.PurchaseDate) : new Date();
  purchase.CreatedAt = new Date();
  purchase.UpdatedAt = new Date();
  purchase.TotalCost = purchase.Items.reduce((s, i) => s + (Number(i.LineTotal) || 0), 0);

  const result = await col('purchases').insertOne(purchase);

  // Increment stock and update purchase price
  for (const item of purchase.Items) {
    if (item.InventoryItemId) {
      await updateStock(item.InventoryItemId, Number(item.Quantity));
      await updatePurchasePrice(item.InventoryItemId, Number(item.UnitCost));
    }
  }

  return { ...purchase, _id: result.insertedId };
}

async function updatePurchase(purchase) {
  const { _id, ...data } = purchase;
  const existing = await col('purchases').findOne({ _id: oid(_id) });
  if (!existing) throw new Error('Purchase not found');

  // Reverse original stock impact
  for (const item of (existing.Items || [])) {
    if (item.InventoryItemId) await updateStock(item.InventoryItemId, -Number(item.Quantity));
  }

  // Recompute and save
  data.TotalCost = (data.Items || []).reduce((s, i) => s + (Number(i.LineTotal) || 0), 0);
  data.UpdatedAt = new Date();
  await col('purchases').updateOne({ _id: oid(_id) }, { $set: data });

  // Apply new stock impact and prices
  for (const item of (data.Items || [])) {
    if (item.InventoryItemId) {
      await updateStock(item.InventoryItemId, Number(item.Quantity));
      await updatePurchasePrice(item.InventoryItemId, Number(item.UnitCost));
    }
  }

  return { _id, ...data };
}

async function deletePurchase(id) {
  const purchase = await col('purchases').findOne({ _id: oid(id) });
  if (!purchase) return;
  for (const item of (purchase.Items || [])) {
    if (item.InventoryItemId) await updateStock(item.InventoryItemId, -Number(item.Quantity));
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
  getConfig, saveConfig,
  getAllInventory, getLowStock, createItem, updateItem, deleteItem, updateStock,
  getAllClients, createClient, updateClient, deleteClient, getClientLedger, getClientBalance,
  getAllSales, createSale, updatePayment, markSaleReturned, deleteSale,
  getTotalSales, getTotalProfit, getTotalOutstanding, getOverdueSales, getPendingAlerts, markAlertSent,
  getAllPurchases, createPurchase, updatePurchase, deletePurchase,
  getAllSuppliers, createSupplier, updateSupplier, deleteSupplier,
  getDashboardMetrics,
};
