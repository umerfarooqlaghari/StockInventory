'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');

async function importInventoryFromExcel(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const items = [];
  const errors = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header
    const [, itemCode, stockName, plateSize, category, supplierName, purchasePrice, salePrice, currentStock, reorderLevel, unit] =
      row.values;
    if (!stockName) return;
    items.push({
      ItemCode: String(itemCode || '').trim(),
      StockName: String(stockName || '').trim(),
      PlateSize: String(plateSize || '').trim(),
      Category: String(category || '').trim(),
      SupplierName: String(supplierName || '').trim(),
      PurchasePrice: parseFloat(purchasePrice) || 0,
      SalePrice: parseFloat(salePrice) || 0,
      CurrentStock: parseFloat(currentStock) || 0,
      ReorderLevel: parseFloat(reorderLevel) || 10,
      Unit: String(unit || 'Pcs').trim(),
    });
  });

  return { items, errors };
}

async function importClientsFromExcel(filePath, sheetName = 'Clients') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(sheetName) || wb.worksheets[0];
  const clients = [];
  const errors = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const [, clientCode, name, phone, email, address, notes] = row.values;
    if (!name) return;
    clients.push({
      ClientCode: String(clientCode || '').trim(),
      Name: String(name || '').trim(),
      Phone: String(phone || '').trim(),
      Email: String(email || '').trim(),
      Address: String(address || '').trim(),
      Notes: String(notes || '').trim(),
    });
  });

  return { clients, errors };
}

async function exportInventoryToExcel(items) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventory');

  ws.columns = [
    { header: 'Item Code', key: 'ItemCode', width: 12 },
    { header: 'Stock Name', key: 'StockName', width: 25 },
    { header: 'Plate Size', key: 'PlateSize', width: 12 },
    { header: 'Category', key: 'Category', width: 15 },
    { header: 'Supplier', key: 'SupplierName', width: 20 },
    { header: 'Purchase Price', key: 'PurchasePrice', width: 15 },
    { header: 'Sale Price', key: 'SalePrice', width: 12 },
    { header: 'Current Stock', key: 'CurrentStock', width: 14 },
    { header: 'Reorder Level', key: 'ReorderLevel', width: 14 },
    { header: 'Unit', key: 'Unit', width: 8 },
    { header: 'Stock Value', key: 'StockValue', width: 14 },
  ];

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2B4A' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  items.forEach((item) => {
    ws.addRow({
      ...item,
      StockValue: (item.CurrentStock * item.PurchasePrice).toFixed(2),
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function exportSalesToExcel(sales) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sales');

  ws.columns = [
    { header: 'Invoice #', key: 'InvoiceNumber', width: 18 },
    { header: 'Client', key: 'ClientName', width: 22 },
    { header: 'Date', key: 'SaleDate', width: 14 },
    { header: 'Due Date', key: 'DueDate', width: 14 },
    { header: 'Subtotal', key: 'Subtotal', width: 14 },
    { header: 'Discount', key: 'OverallDiscount', width: 12 },
    { header: 'Total Amount', key: 'TotalAmount', width: 14 },
    { header: 'Paid', key: 'PaidAmount', width: 12 },
    { header: 'Balance', key: 'Balance', width: 12 },
    { header: 'Profit', key: 'TotalProfit', width: 12 },
    { header: 'Status', key: 'PaymentStatus', width: 12 },
  ];

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2B4A' } };

  sales.forEach((s) => {
    ws.addRow({
      ...s,
      SaleDate: s.SaleDate ? new Date(s.SaleDate).toLocaleDateString() : '',
      DueDate: s.DueDate ? new Date(s.DueDate).toLocaleDateString() : '',
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function generateInventoryTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventory');
  ws.columns = [
    { header: 'ItemCode',      key: 'ItemCode',      width: 12 },
    { header: 'StockName',     key: 'StockName',     width: 28 },
    { header: 'PlateSize',     key: 'PlateSize',     width: 12 },
    { header: 'Category',      key: 'Category',      width: 16 },
    { header: 'SupplierName',  key: 'SupplierName',  width: 20 },
    { header: 'PurchasePrice', key: 'PurchasePrice', width: 15 },
    { header: 'SalePrice',     key: 'SalePrice',     width: 12 },
    { header: 'CurrentStock',  key: 'CurrentStock',  width: 14 },
    { header: 'ReorderLevel',  key: 'ReorderLevel',  width: 14 },
    { header: 'Unit',          key: 'Unit',          width: 10 },
  ];
  const hRow = ws.getRow(1);
  hRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2B4A' } };
  hRow.alignment = { horizontal: 'center' };

  // Two example rows
  ws.addRow({ ItemCode: 'PLT001', StockName: 'Aluminum Plate', PlateSize: '25x35', Category: 'Metal', SupplierName: 'Alpha Supplier', PurchasePrice: 3000, SalePrice: 3500, CurrentStock: 50, ReorderLevel: 10, Unit: 'Sheets' });
  ws.addRow({ ItemCode: 'PLT002', StockName: 'Zinc Plate', PlateSize: '30x40', Category: 'Metal', SupplierName: 'Beta Supplier', PurchasePrice: 4500, SalePrice: 5200, CurrentStock: 30, ReorderLevel: 8, Unit: 'Sheets' });

  const exampleRows = ws.getRows(2, 2);
  exampleRows?.forEach((r) => { r.font = { italic: true, color: { argb: 'FF888888' } }; });

  // Add note
  ws.getCell('A4').value = '← Replace example rows above with your data. Do not change column headers.';
  ws.getCell('A4').font = { italic: true, color: { argb: 'FFAA6600' } };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function generateClientsTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Clients');
  ws.columns = [
    { header: 'ClientCode', key: 'ClientCode', width: 12 },
    { header: 'Name',       key: 'Name',       width: 28 },
    { header: 'Phone',      key: 'Phone',      width: 18 },
    { header: 'Email',      key: 'Email',      width: 28 },
    { header: 'Address',    key: 'Address',    width: 36 },
    { header: 'Notes',      key: 'Notes',      width: 36 },
  ];
  const hRow = ws.getRow(1);
  hRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2B4A' } };
  hRow.alignment = { horizontal: 'center' };

  ws.addRow({ ClientCode: 'CLT-0001', Name: 'Alpha Devs Ltd', Phone: '+92 300 1234567', Email: 'info@alpha-devs.cloud', Address: '123 Main Street, Lahore', Notes: 'Premium client' });
  ws.addRow({ ClientCode: 'CLT-0002', Name: 'Beta Corp', Phone: '+92 321 7654321', Email: 'contact@betacorp.pk', Address: '456 Commercial Area, Karachi', Notes: '' });

  ws.getCell('A4').value = '← Replace example rows above with your data. Do not change column headers.';
  ws.getCell('A4').font = { italic: true, color: { argb: 'FFAA6600' } };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = { importInventoryFromExcel, importClientsFromExcel, exportInventoryToExcel, exportSalesToExcel, generateInventoryTemplate, generateClientsTemplate };
