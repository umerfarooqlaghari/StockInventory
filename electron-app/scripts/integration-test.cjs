'use strict';
/**
 * Integration tests for recent features (master data, PO status, inventory history).
 * Run: node scripts/integration-test.cjs
 */
require('../main/env.cjs').loadEnv();
const db = require('../main/db.cjs');
const { ObjectId } = require('mongodb');

let passed = 0;
let failed = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function cleanup(ids) {
  for (const id of ids.items || []) {
    try { await db.deleteItem(id); } catch { /* */ }
  }
  for (const id of ids.purchases || []) {
    try { await db.deletePurchase(id); } catch { /* */ }
  }
  for (const id of ids.sales || []) {
    try { await db.deleteSale(id); } catch { /* */ }
  }
  for (const id of ids.master || []) {
    try { await db.deleteMasterDataEntry(id); } catch { /* */ }
  }
}

async function run() {
  console.log('\n=== Stock Inventory Integration Tests ===\n');
  await db.connect();

  const ids = { items: [], purchases: [], sales: [], master: [] };

  try {
    // ── Master Data ──
    console.log('Master Data');
    const cat = await db.createMasterDataEntry({ Type: 'category', Name: `TestCat-${Date.now()}` });
    ids.master.push(cat._id.toString());
    ok('create category', cat.Name && cat.Type === 'category');

    const dup = await db.createMasterDataEntry({ Type: 'category', Name: cat.Name }).catch((e) => e);
    ok('reject duplicate', dup instanceof Error);

    const lists = await db.getMasterDataLists();
    ok('lists include category', lists.categories.includes(cat.Name));

    // ── Inventory + History: opening ──
    console.log('\nInventory & History');
    const item = await db.createItem({
      StockName: 'Test Plate',
      PlateSize: '25x35',
      Category: cat.Name,
      CurrentStock: 25,
      PurchasePrice: 100,
      SalePrice: 150,
      Unit: 'Pcs',
    });
    ids.items.push(item._id.toString());
    ok('create item stock 25', item.CurrentStock === 25);

    let hist = await db.getInventoryHistory(item._id.toString());
    ok('history has opening', hist.events.some((e) => e.EventType === 'opening' && e.BalanceAfter === 25));

    // ── Purchase Pending (no stock) ──
    console.log('\nPurchase Status');
    const poPending = await db.createPurchase({
      SupplierName: 'Test Supplier',
      Status: 'Pending',
      Items: [{
        InventoryItemId: item._id.toString(),
        ItemCode: item.ItemCode,
        ItemName: item.StockName,
        Quantity: 10,
        UnitCost: 100,
        LineTotal: 1000,
      }],
    });
    ids.purchases.push(poPending._id.toString());
    ok('pending PO no stock change', (await db.getAllInventory()).find((i) => i._id.toString() === item._id.toString()).CurrentStock === 25);

    const summary = await db.getPurchaseSummary();
    ok('pending cost tracked', summary.pendingCost >= 1000);

    // ── Mark Received (partial: ordered 10, received 8) ──
    await db.updatePurchaseStatus(poPending._id.toString(), 'Received', 'Partial delivery', [{
      InventoryItemId: item._id.toString(),
      ReceivedQuantity: 8,
    }]);
    const afterReceive = (await db.getAllInventory()).find((i) => i._id.toString() === item._id.toString());
    ok('partial receive adds 8 not 10', afterReceive.CurrentStock === 33);

    const poDoc = (await db.getAllPurchases()).find((p) => p._id.toString() === poPending._id.toString());
    ok('partial receipt flagged', poDoc.ReceiptVaried === true);
    ok('books use received cost', poDoc.TotalCost === 800 && poDoc.OrderedTotalCost === 1000);

    hist = await db.getInventoryHistory(item._id.toString());
    ok('history has purchase', hist.events.some((e) => e.EventType === 'purchase' && e.ReferenceNumber === poPending.PurchaseNumber));
    ok('history notes variance', hist.events.some((e) => e.Notes && e.Notes.includes('Ordered 10, received 8')));

    // ── Cancel received PO (reverse stock) ──
    await db.updatePurchaseStatus(poPending._id.toString(), 'Out of Stock', 'Supplier OOS');
    const afterCancel = (await db.getAllInventory()).find((i) => i._id.toString() === item._id.toString());
    ok('OOS reverses received qty only', afterCancel.CurrentStock === 25);

    // ── Sale ──
    console.log('\nSales & History');
    const client = await db.createClient({ Name: 'Test Client A', Phone: '000', Email: 't@test.com' });
    const sale = await db.createSale({
      ClientId: client._id.toString(),
      ClientName: client.Name,
      ClientEmail: client.Email,
      Items: [{
        InventoryItemId: item._id.toString(),
        ItemCode: item.ItemCode,
        ItemName: item.StockName,
        Quantity: 10,
        UnitPrice: 150,
        LineTotal: 1500,
        TotalProfit: 500,
      }],
      PaidAmount: 0,
    });
    ids.sales.push(sale._id.toString());
    const afterSale = (await db.getAllInventory()).find((i) => i._id.toString() === item._id.toString());
    ok('sale reduces stock', afterSale.CurrentStock === 15);

    hist = await db.getInventoryHistory(item._id.toString());
    const lastBal = hist.events[hist.events.length - 1]?.BalanceAfter;
    ok('history balance matches stock', lastBal === afterSale.CurrentStock, `last=${lastBal} stock=${afterSale.CurrentStock}`);

    // ── Manual adjustment ──
    await db.updateItem({ _id: item._id.toString(), ...afterSale, CurrentStock: 20 });
    hist = await db.getInventoryHistory(item._id.toString());
    ok('manual adjustment logged', hist.events.some((e) => e.EventType === 'adjustment'));

    // ── Rebuild history ──
    await db.rebuildInventoryHistory(item._id.toString());
    hist = await db.getInventoryHistory(item._id.toString());
    ok('rebuild final balance matches', hist.events[hist.events.length - 1]?.BalanceAfter === 20);

    // ── Second PO should get unique PurchaseNumber ──
    console.log('\nPurchase Number');
    const po2 = await db.createPurchase({
      SupplierName: 'Test Supplier',
      Status: 'Pending',
      Items: [{ InventoryItemId: item._id.toString(), ItemName: 'x', Quantity: 1, UnitCost: 1, LineTotal: 1 }],
    });
    ids.purchases.push(po2._id.toString());
    ok('second PO has PurchaseNumber', Boolean(po2.PurchaseNumber));

  } finally {
    console.log('\nCleanup…');
    await cleanup(ids);
    await db.disconnect();
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
