// web-api.js
// Fallback window.api implementation for Web browsers

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

function getToken() {
  return localStorage.getItem('jwt_token');
}

async function request(path, opts = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers,
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error || `Server error [${res.status}]` };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function rpc(method, args = []) {
  const res = await request(`/rpc/${method}`, {
    method: 'POST',
    body: JSON.stringify({ args }),
  });
  if (res.ok) {
    return { ok: true, data: res.data.result };
  }
  return res;
}

async function triggerDownload(url, defaultFilename) {
  const token = getToken();
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = defaultFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return { ok: true, data: { saved: true } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Global store for dynamic file objects
window._webFiles = window._webFiles || {};

const webApi = {
  // Auth
  login: async (email, password) => {
    const res = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res.ok && res.data.token) {
      localStorage.setItem('jwt_token', res.data.token);
    }
    return res;
  },
  register: (email, password, companyName) => {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, companyName }),
    });
  },
  logout: async () => {
    localStorage.removeItem('jwt_token');
    return { ok: true };
  },

  // Dashboard
  getDashboard: () => rpc('getDashboardMetrics'),
  runAlerts: () => request('/alerts/run', { method: 'POST' }),
  runOwnerDigest: () => request('/alerts/run-owner', { method: 'POST' }),

  // Inventory
  getInventory: (search) => rpc('getAllInventory', [search]),
  getLowStock: () => rpc('getLowStock'),
  createItem: (item) => rpc('createItem', [item]),
  updateItem: (item) => rpc('updateItem', [item]),
  deleteItem: (id) => rpc('deleteItem', [id]),
  getInventoryHistory: (itemId) => rpc('getInventoryHistory', [itemId]),
  rebuildInventoryHistory: (itemId) => rpc('rebuildInventoryHistory', [itemId]),
  importInventoryExcel: async (fileId) => {
    const file = window._webFiles[fileId];
    if (!file) return { ok: false, error: 'File reference expired or invalid' };
    const fd = new FormData();
    fd.append('file', file);
    
    const token = getToken();
    try {
      const res = await fetch(`${API_BASE}/inventory/import`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd
      });
      const data = await res.json();
      return { ok: res.ok, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
  exportInventoryExcel: () => triggerDownload(`${API_BASE}/inventory/export`, `inventory_${Date.now()}.xlsx`),

  // Clients
  getClients: (search) => rpc('getAllClients', [search]),
  createClient: (client) => rpc('createClient', [client]),
  updateClient: (client) => rpc('updateClient', [client]),
  deleteClient: (id) => rpc('deleteClient', [id]),
  getClientLedger: (clientId) => rpc('getClientLedger', [clientId]),
  importClientsExcel: async (fileId) => {
    const file = window._webFiles[fileId];
    if (!file) return { ok: false, error: 'File reference expired or invalid' };
    const fd = new FormData();
    fd.append('file', file);
    
    const token = getToken();
    try {
      const res = await fetch(`${API_BASE}/clients/import`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd
      });
      const data = await res.json();
      return { ok: res.ok, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // Sales
  getSales: (search, status) => rpc('getAllSales', [search, status]),
  createSale: (sale) => rpc('createSale', [sale]),
  updateSale: (sale) => rpc('updateSale', [sale]),
  recordPayment: (saleId, entry) => rpc('recordPayment', [saleId, entry]),
  markSaleReturned: (saleId) => rpc('markSaleReturned', [saleId]),
  notifySaleNow: (saleId) => request(`/sales/${saleId}/notify`, { method: 'POST' }),
  generateInvoicePdf: (saleId) => triggerDownload(`${API_BASE}/sales/${saleId}/pdf`, `invoice_${saleId}.pdf`),
  deleteSale: (id) => rpc('deleteSale', [id]),
  exportSalesExcel: () => triggerDownload(`${API_BASE}/sales/export`, `sales_${Date.now()}.xlsx`),

  // Purchases
  getPurchases: () => rpc('getAllPurchases'),
  getPurchaseSummary: () => rpc('getPurchaseSummary'),
  createPurchase: (purchase) => rpc('createPurchase', [purchase]),
  updatePurchase: (purchase) => rpc('updatePurchase', [purchase]),
  updatePurchaseStatus: (id, status, statusNotes, receivedItems) => rpc('updatePurchaseStatus', [id, status, statusNotes, receivedItems]),
  deletePurchase: (id) => rpc('deletePurchase', [id]),

  // Suppliers
  getSuppliers: (search) => rpc('getAllSuppliers', [search]),
  createSupplier: (s) => rpc('createSupplier', [s]),
  updateSupplier: (s) => rpc('updateSupplier', [s]),
  deleteSupplier: (id) => rpc('deleteSupplier', [id]),

  // Master Data
  getMasterData: (type) => rpc('getMasterData', [type]),
  getMasterDataLists: () => rpc('getMasterDataLists'),
  createMasterData: (entry) => rpc('createMasterDataEntry', [entry]),
  updateMasterData: (entry) => rpc('updateMasterDataEntry', [entry]),
  deleteMasterData: (id) => rpc('deleteMasterDataEntry', [id]),

  // Config
  getConfig: () => rpc('getConfig'),
  saveConfig: (config) => rpc('saveConfig', [config]),
  getLogoSrc: async () => {
    const res = await rpc('getConfig');
    if (res.ok && res.data?.CompanyLogo) {
      return { ok: true, data: res.data.CompanyLogo };
    }
    return { ok: true, data: null };
  },
  uploadCompanyLogo: async (fileId) => {
    const file = window._webFiles[fileId];
    if (!file) return { ok: false, error: 'File reference invalid' };

    // 1. Get presigned upload URL
    const presigned = await request('/s3/presigned', {
      method: 'POST',
      body: JSON.stringify({
        subfolder: 'assets',
        filename: `company-logo-${Date.now()}-${file.name}`,
        contentType: file.type
      })
    });
    if (!presigned.ok) return presigned;
    const { uploadUrl, objectUrl } = presigned.data;

    // 2. Direct upload to S3 via PUT
    try {
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });
      if (!putRes.ok) throw new Error('S3 direct upload failed');
      
      // 3. Save config
      const configRes = await rpc('getConfig');
      if (configRes.ok) {
        await rpc('saveConfig', [{ ...configRes.data, CompanyLogo: objectUrl }]);
      }
      return { ok: true, data: objectUrl };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
  resetCompanyLogo: async () => {
    const configRes = await rpc('getConfig');
    if (configRes.ok) {
      await rpc('saveConfig', [{ ...configRes.data, CompanyLogo: '' }]);
    }
    return { ok: true };
  },
  getDefaultEmailTemplate: async () => {
    return {
      ok: true,
      data: {
        subject: 'Payment Reminder - Invoice {InvoiceNumber}',
        body: `Dear {ClientName},\n\nThis is a reminder that Invoice #{InvoiceNumber} dated {SaleDate} for PKR {Amount} is now {Days} days outstanding.\n\nOutstanding Balance: PKR {Balance}\n\nPlease arrange payment at your earliest convenience.\n\nRegards,\n{CompanyName}`
      }
    };
  },
  sendTestEmail: (to) => request('/email/send-test', {
    method: 'POST',
    body: JSON.stringify({ to })
  }),

  // S3 upload proof
  uploadPaymentProof: async (fileId, invoiceNumber) => {
    const file = window._webFiles[fileId];
    if (!file) return { ok: false, error: 'File reference invalid' };

    const presigned = await request('/s3/presigned', {
      method: 'POST',
      body: JSON.stringify({
        subfolder: 'payment-proofs',
        filename: `${invoiceNumber}_${Date.now()}_${file.name}`,
        contentType: file.type
      })
    });
    if (!presigned.ok) return presigned;
    const { uploadUrl, objectUrl } = presigned.data;

    try {
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });
      if (!putRes.ok) throw new Error('S3 upload failed');
      return { ok: true, data: objectUrl };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // Dialogs shim
  openFileDialog: async (opts) => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (opts && opts.filters) {
        const accept = opts.filters.map(f => f.extensions.map(ext => `.${ext}`).join(',')).join(',');
        input.accept = accept;
      }
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const fileId = `file_${Date.now()}`;
          window._webFiles[fileId] = file;
          resolve(fileId);
        } else {
          resolve(null);
        }
      };
      input.click();
    });
  },
  saveFileDialog: async (opts) => {
    // Simply return the default name/token as a placeholder
    return opts?.defaultPath || 'invoice.pdf';
  },

  // Templates
  downloadInventoryTemplate: () => triggerDownload(`${API_BASE}/templates/inventory`, 'inventory_template.xlsx'),
  downloadClientsTemplate: () => triggerDownload(`${API_BASE}/templates/clients`, 'clients_template.xlsx'),
};

if (typeof window.api === 'undefined') {
  window.api = webApi;
  console.log('Using Web API compatibility layer');
}
export default webApi;
