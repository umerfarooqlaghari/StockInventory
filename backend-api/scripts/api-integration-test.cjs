'use strict';

/**
 * Backend API endpoint integration test.
 *
 * Usage:
 *   API_BASE=http://localhost:4000 node scripts/api-integration-test.cjs
 */

const API_BASE = (process.env.API_BASE || 'http://localhost:4000').replace(/\/$/, '');
const API = `${API_BASE}/api`;

let passed = 0;
let failed = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    console.error(`  [FAIL] ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

async function request(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await res.json();
    return { status: res.status, ok: res.ok, body, headers: res.headers };
  }
  const buf = await res.arrayBuffer();
  return { status: res.status, ok: res.ok, body: Buffer.from(buf), headers: res.headers };
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function run() {
  console.log(`\n=== Backend API Integration (${API}) ===\n`);

  const health = await request('/health');
  ok('GET /api/health returns 200', health.status === 200);
  ok('GET /api/health payload is ok', health.body && health.body.status === 'ok');

  const badAuth = await request('/rpc/getConfig', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: [] }) });
  ok('POST /api/rpc/getConfig unauthorized without token', badAuth.status === 401);

  const stamp = Date.now();
  const email = `integration_${stamp}@example.test`;
  const password = 'StrongPass123!';
  const companyName = `Integration Co ${stamp}`;

  const register = await request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, companyName }),
  });
  ok('POST /api/auth/register returns 201', register.status === 201, JSON.stringify(register.body));

  const login = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  ok('POST /api/auth/login returns 200', login.status === 200, JSON.stringify(login.body));
  const token = login.body && login.body.token;
  ok('POST /api/auth/login returns token', Boolean(token));
  if (!token) {
    console.error('\nToken missing, stopping integration run.\n');
    process.exit(1);
  }

  const rpc = async (method, args = []) => {
    return request(`/rpc/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(token),
      },
      body: JSON.stringify({ args }),
    });
  };

  const cfgRes = await rpc('getConfig');
  ok('POST /api/rpc/getConfig returns 200', cfgRes.status === 200, JSON.stringify(cfgRes.body));

  const saveCfg = await rpc('saveConfig', [{ ...(cfgRes.body.result || {}), CompanyName: companyName, AlertDays: 5 }]);
  ok('POST /api/rpc/saveConfig returns 200', saveCfg.status === 200, JSON.stringify(saveCfg.body));

  const dashboard = await rpc('getDashboardMetrics');
  ok('POST /api/rpc/getDashboardMetrics returns 200', dashboard.status === 200);

  const clientRes = await rpc('createClient', [{ Name: 'Integration Client', Email: email, Phone: '03001234567' }]);
  ok('POST /api/rpc/createClient returns 200', clientRes.status === 200, JSON.stringify(clientRes.body));
  const client = clientRes.body.result;

  const itemRes = await rpc('createItem', [{
    StockName: 'Integration Item',
    PlateSize: '25x35',
    Category: 'Other',
    Unit: 'Pcs',
    CurrentStock: 100,
    PurchasePrice: 100,
    SalePrice: 140,
  }]);
  ok('POST /api/rpc/createItem returns 200', itemRes.status === 200, JSON.stringify(itemRes.body));
  const item = itemRes.body.result;

  const saleRes = await rpc('createSale', [{
    ClientId: client._id,
    ClientName: client.Name,
    ClientEmail: client.Email,
    Items: [{
      InventoryItemId: item._id,
      ItemCode: item.ItemCode,
      ItemName: item.StockName,
      Quantity: 2,
      UnitPrice: item.SalePrice,
      LineTotal: Number(item.SalePrice) * 2,
      TotalProfit: 20,
    }],
    PaidAmount: 0,
  }]);
  ok('POST /api/rpc/createSale returns 200', saleRes.status === 200, JSON.stringify(saleRes.body));
  const sale = saleRes.body.result;

  const purchaseRes = await rpc('createPurchase', [{
    SupplierName: 'Integration Supplier',
    Status: 'Pending',
    Items: [{
      InventoryItemId: item._id,
      ItemCode: item.ItemCode,
      ItemName: item.StockName,
      Quantity: 3,
      UnitCost: item.PurchasePrice,
      LineTotal: Number(item.PurchasePrice) * 3,
    }],
  }]);
  ok('POST /api/rpc/createPurchase returns 200', purchaseRes.status === 200, JSON.stringify(purchaseRes.body));

  const salesPdf = await request(`/sales/${sale._id}/pdf`, {
    method: 'GET',
    headers: authHeaders(token),
  });
  ok('GET /api/sales/:saleId/pdf returns 200', salesPdf.status === 200, `status=${salesPdf.status}`);
  ok('GET /api/sales/:saleId/pdf returns PDF bytes', Buffer.isBuffer(salesPdf.body) && salesPdf.body.length > 200);

  const invExport = await request('/inventory/export', {
    method: 'GET',
    headers: authHeaders(token),
  });
  ok('GET /api/inventory/export returns 200', invExport.status === 200);

  const salesExport = await request('/sales/export', {
    method: 'GET',
    headers: authHeaders(token),
  });
  ok('GET /api/sales/export returns 200', salesExport.status === 200);

  const invTemplate = await request('/templates/inventory', {
    method: 'GET',
    headers: authHeaders(token),
  });
  ok('GET /api/templates/inventory returns 200', invTemplate.status === 200);

  const clientsTemplate = await request('/templates/clients', {
    method: 'GET',
    headers: authHeaders(token),
  });
  ok('GET /api/templates/clients returns 200', clientsTemplate.status === 200);

  const badTemplate = await request('/templates/unknown', {
    method: 'GET',
    headers: authHeaders(token),
  });
  ok('GET /api/templates/unknown returns 404', badTemplate.status === 404);

  const noFileInventoryImport = await request('/inventory/import', {
    method: 'POST',
    headers: authHeaders(token),
  });
  ok('POST /api/inventory/import without file returns 400', noFileInventoryImport.status === 400);

  const noFileClientsImport = await request('/clients/import', {
    method: 'POST',
    headers: authHeaders(token),
  });
  ok('POST /api/clients/import without file returns 400', noFileClientsImport.status === 400);

  const notifyRes = await request(`/sales/${sale._id}/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify({}),
  });
  ok('POST /api/sales/:saleId/notify endpoint responds', notifyRes.status === 200, JSON.stringify(notifyRes.body));

  const runAlerts = await request('/alerts/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify({}),
  });
  ok('POST /api/alerts/run returns 200', runAlerts.status === 200, JSON.stringify(runAlerts.body));

  const runOwner = await request('/alerts/run-owner', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify({}),
  });
  ok('POST /api/alerts/run-owner returns 200', runOwner.status === 200, JSON.stringify(runOwner.body));

  const sendTestEmail = await request('/email/send-test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify({ to: email }),
  });
  ok('POST /api/email/send-test returns 200', sendTestEmail.status === 200, JSON.stringify(sendTestEmail.body));

  const s3MissingFields = await request('/s3/presigned', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify({}),
  });
  ok('POST /api/s3/presigned validation returns 400', s3MissingFields.status === 400);

  const s3Attempt = await request('/s3/presigned', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify({
      subfolder: 'integration',
      filename: `sample-${stamp}.txt`,
      contentType: 'text/plain',
    }),
  });
  ok('POST /api/s3/presigned reachable (200 or 500 if AWS not configured)', s3Attempt.status === 200 || s3Attempt.status === 500, JSON.stringify(s3Attempt.body));

  const unknownRpc = await rpc('unknownMethod');
  ok('POST /api/rpc/unknownMethod returns 404', unknownRpc.status === 404);

  if (sale && sale._id) await rpc('deleteSale', [sale._id]);
  if (item && item._id) await rpc('deleteItem', [item._id]);
  if (client && client._id) await rpc('deleteClient', [client._id]);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\nIntegration run failed with error:\n', err);
  process.exit(1);
});
