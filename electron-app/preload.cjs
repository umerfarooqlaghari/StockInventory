'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Dashboard
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  runAlerts: () => ipcRenderer.invoke('alerts:runNow'),
  runOwnerDigest: () => ipcRenderer.invoke('alerts:runOwnerDigestNow'),

  // Inventory
  getInventory: (search) => ipcRenderer.invoke('inventory:getAll', search),
  getLowStock: () => ipcRenderer.invoke('inventory:getLowStock'),
  createItem: (item) => ipcRenderer.invoke('inventory:create', item),
  updateItem: (item) => ipcRenderer.invoke('inventory:update', item),
  deleteItem: (id) => ipcRenderer.invoke('inventory:delete', id),
  importInventoryExcel: (filePath) => ipcRenderer.invoke('inventory:importExcel', filePath),
  exportInventoryExcel: () => ipcRenderer.invoke('inventory:exportExcel'),
  importClientsExcel: (filePath) => ipcRenderer.invoke('clients:importExcel', filePath),

  // Clients
  getClients: (search) => ipcRenderer.invoke('clients:getAll', search),
  createClient: (client) => ipcRenderer.invoke('clients:create', client),
  updateClient: (client) => ipcRenderer.invoke('clients:update', client),
  deleteClient: (id) => ipcRenderer.invoke('clients:delete', id),
  getClientLedger: (clientId) => ipcRenderer.invoke('clients:getLedger', clientId),

  // Sales
  getSales: (search, status) => ipcRenderer.invoke('sales:getAll', search, status),
  createSale: (sale) => ipcRenderer.invoke('sales:create', sale),
  recordPayment: (saleId, entry) => ipcRenderer.invoke('sales:recordPayment', saleId, entry),
  markSaleReturned: (saleId) => ipcRenderer.invoke('sales:markReturned', saleId),
  notifySaleNow: (saleId) => ipcRenderer.invoke('sales:notifyNow', saleId),
  generateInvoicePdf: (saleId) => ipcRenderer.invoke('sales:generatePdf', saleId),
  deleteSale: (id) => ipcRenderer.invoke('sales:delete', id),
  exportSalesExcel: () => ipcRenderer.invoke('sales:exportExcel'),

  // Purchases
  getPurchases: () => ipcRenderer.invoke('purchases:getAll'),
  createPurchase: (purchase) => ipcRenderer.invoke('purchases:create', purchase),
  updatePurchase: (purchase) => ipcRenderer.invoke('purchases:update', purchase),
  deletePurchase: (id) => ipcRenderer.invoke('purchases:delete', id),

  // Suppliers
  getSuppliers: (search) => ipcRenderer.invoke('suppliers:getAll', search),
  createSupplier: (s) => ipcRenderer.invoke('suppliers:create', s),
  updateSupplier: (s) => ipcRenderer.invoke('suppliers:update', s),
  deleteSupplier: (id) => ipcRenderer.invoke('suppliers:delete', id),

  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getDefaultEmailTemplate: () => ipcRenderer.invoke('config:defaultEmailTemplate'),
  sendTestEmail: (to) => ipcRenderer.invoke('email:sendTest', to),

  // S3 upload
  uploadPaymentProof: (filePath, invoiceNumber) => ipcRenderer.invoke('upload:paymentProof', filePath, invoiceNumber),

  // File dialog
  openFileDialog: (opts) => ipcRenderer.invoke('dialog:openFile', opts),
  saveFileDialog: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),

  // Excel templates
  downloadInventoryTemplate: () => ipcRenderer.invoke('template:inventory'),
  downloadClientsTemplate:   () => ipcRenderer.invoke('template:clients'),
});
