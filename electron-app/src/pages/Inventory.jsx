import React, { useEffect, useState, useCallback } from 'react';
import Modal from '../components/Modal.jsx';

const EMPTY_ITEM = { ItemCode: '', StockName: '', PlateSize: '', Category: '', SupplierName: '', PurchasePrice: '', SalePrice: '', CurrentStock: '', ReorderLevel: '10', Unit: 'Pcs', Description: '' };
const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}`;

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null); // null = closed, object = open (new or edit)
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [filterLow, setFilterLow] = useState(false);
  const [plateSizes, setPlateSizes] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  const load = useCallback(async (q) => {
    setLoading(true);
    const res = await window.api.getInventory(q || '');
    if (res.ok) setItems(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load('');
    window.api.getConfig().then((r) => { if (r.ok) setPlateSizes(r.data.PlateSizes || []); });
    window.api.getSuppliers('').then((r) => { if (r.ok) setSuppliers(r.data); });
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(search), 350);
    return () => clearTimeout(t);
  }, [search, load]);

  function openAdd() { setForm({ ...EMPTY_ITEM }); setEditId(null); setError(''); }
  function openEdit(item) {
    setForm({
      ...item,
      PurchasePrice: item.PurchasePrice ?? '',
      SalePrice: item.SalePrice ?? '',
      CurrentStock: item.CurrentStock ?? '',
      ReorderLevel: item.ReorderLevel ?? 10,
    });
    setEditId(item._id?.toString() || item._id);
    setError('');
  }

  async function save() {
    if (!form.StockName?.trim()) { setError('Stock Name is required'); return; }
    setSaving(true); setError('');
    const payload = { ...form, _id: editId };
    const res = editId ? await window.api.updateItem(payload) : await window.api.createItem(payload);
    if (res.ok) { setForm(null); load(search); }
    else setError(res.error || 'Save failed');
    setSaving(false);
  }

  async function remove(item) {
    if (!confirm(`Delete "${item.StockName}"?`)) return;
    await window.api.deleteItem(item._id?.toString() || item._id);
    load(search);
  }

  async function importExcel() {
    const fp = await window.api.openFileDialog({ filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }], properties: ['openFile'] });
    if (!fp) return;
    const res = await window.api.importInventoryExcel(fp);
    if (res.ok) { setImportResult(res.data); load(search); }
  }

  async function exportExcel() {
    await window.api.exportInventoryExcel();
  }

  const displayed = filterLow ? items.filter((i) => Number(i.CurrentStock) <= Number(i.ReorderLevel || 10)) : items;
  const totalValue = items.reduce((s, i) => s + (i.CurrentStock * i.PurchasePrice), 0);
  const lowCount = items.filter((i) => Number(i.CurrentStock) <= Number(i.ReorderLevel || 10)).length;

  return (
    <>
      <div className="page-header">
        <h1>Inventory Management</h1>
        <div className="page-header-actions">
          <button className="btn btn-secondary btn-sm" onClick={importExcel}>⬆ Import Excel</button>
          <button className="btn btn-secondary btn-sm" onClick={exportExcel}>⬇ Export Excel</button>
          <button className="btn btn-primary" onClick={openAdd}>+ Add Item</button>
        </div>
      </div>

      <div className="page-body">
        {/* Stats bar */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <div className="card card-body" style={{ flex: 1, padding: '12px 18px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Total Items</span>
            <strong style={{ display: 'block', fontSize: 20 }}>{items.length}</strong>
          </div>
          <div className="card card-body" style={{ flex: 1, padding: '12px 18px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Total Stock Value</span>
            <strong style={{ display: 'block', fontSize: 20 }}>{fmt(totalValue)}</strong>
          </div>
          <div className="card card-body" style={{ flex: 1, padding: '12px 18px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Low Stock Items</span>
            <strong style={{ display: 'block', fontSize: 20, color: lowCount > 0 ? 'var(--red)' : 'var(--text)' }}>{lowCount}</strong>
          </div>
        </div>

        {importResult && (
          <div className={`notice ${importResult.errors?.length ? 'notice-warning' : 'notice-success'}`} style={{ marginBottom: 12 }}>
            Import: {importResult.success} added. {importResult.errors?.length > 0 && `${importResult.errors.length} errors.`}
            <button style={{ marginLeft: 8, cursor: 'pointer', background: 'none', border: 'none', color: 'inherit' }} onClick={() => setImportResult(null)}>✕</button>
          </div>
        )}

        {/* Toolbar */}
        <div className="toolbar">
          <div className="search-bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="form-input" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={filterLow} onChange={(e) => setFilterLow(e.target.checked)} />
            Low Stock Only
          </label>
        </div>

        <div className="card">
          <div className="table-wrap">
            {loading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : displayed.length === 0 ? (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                <p>No items found</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr><th>Code</th><th>Name</th><th>Size</th><th>Category</th><th>Supplier</th><th>Buy Price</th><th>Sale Price</th><th>Stock</th><th>Stock Value</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {displayed.map((item) => {
                    const isLow = Number(item.CurrentStock) <= Number(item.ReorderLevel || 10);
                    return (
                      <tr key={item._id} className={isLow ? 'low-stock' : ''}>
                        <td className="mono">{item.ItemCode || '—'}</td>
                        <td><strong>{item.StockName}</strong>{item.Description && <><br /><span className="text-muted" style={{ fontSize: 11 }}>{item.Description}</span></>}</td>
                        <td>{item.PlateSize || '—'}</td>
                        <td>{item.Category || '—'}</td>
                        <td>{item.SupplierName || '—'}</td>
                        <td>{fmt(item.PurchasePrice)}</td>
                        <td>{fmt(item.SalePrice)}</td>
                        <td>
                          {isLow
                            ? <span className="badge badge-red">{item.CurrentStock} {item.Unit}</span>
                            : <span className="badge badge-green">{item.CurrentStock} {item.Unit}</span>}
                        </td>
                        <td>{fmt(item.CurrentStock * item.PurchasePrice)}</td>
                        <td>
                          <div className="table-actions">
                            <button className="btn-icon" title="Edit" onClick={() => openEdit(item)}>✏</button>
                            <button className="btn-icon danger" title="Delete" onClick={() => remove(item)}>🗑</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {form && (
        <Modal
          title={editId ? 'Edit Item' : 'Add Inventory Item'}
          onClose={() => setForm(null)}
          wide
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Item'}</button>
            </>
          }
        >
          {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-row form-row-3">
            <div className="form-group">
              <label className="form-label">Item Code</label>
              <input className="form-input" placeholder="Auto-generated" value={form.ItemCode} onChange={(e) => setForm({ ...form, ItemCode: e.target.value })} />
            </div>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Stock Name *</label>
              <input className="form-input" placeholder="e.g. Aluminum Plate" value={form.StockName} onChange={(e) => setForm({ ...form, StockName: e.target.value })} />
            </div>
          </div>
          <div className="form-row form-row-3">
            <div className="form-group">
              <label className="form-label">Plate Size</label>
              <input
                className="form-input"
                list="plate-sizes-list"
                placeholder="e.g. 25x35"
                value={form.PlateSize}
                onChange={(e) => setForm({ ...form, PlateSize: e.target.value })}
              />
              <datalist id="plate-sizes-list">
                {plateSizes.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <input className="form-input" placeholder="Category" value={form.Category} onChange={(e) => setForm({ ...form, Category: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Supplier</label>
              {suppliers.length > 0 ? (
                <select
                  className="form-select"
                  value={form.SupplierName}
                  onChange={(e) => setForm({ ...form, SupplierName: e.target.value })}
                >
                  <option value="">— Select supplier —</option>
                  {suppliers.map((s) => (
                    <option key={s._id} value={s.Name}>{s.Name}{s.City ? ` (${s.City})` : ''}</option>
                  ))}
                </select>
              ) : (
                <input className="form-input" placeholder="Supplier name" value={form.SupplierName} onChange={(e) => setForm({ ...form, SupplierName: e.target.value })} />
              )}
            </div>
          </div>
          <div className="form-row form-row-3">
            <div className="form-group">
              <label className="form-label">Purchase Price (PKR)</label>
              <input className="form-input" type="number" min="0" step="0.01" placeholder="0.00" value={form.PurchasePrice} onChange={(e) => setForm({ ...form, PurchasePrice: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Sale Price (PKR)</label>
              <input className="form-input" type="number" min="0" step="0.01" placeholder="0.00" value={form.SalePrice} onChange={(e) => setForm({ ...form, SalePrice: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Unit</label>
              <select className="form-select" value={form.Unit} onChange={(e) => setForm({ ...form, Unit: e.target.value })}>
                {['Pcs', 'Sheets', 'Kg', 'Rolls', 'Boxes', 'Meters'].map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row form-row-2">
            <div className="form-group">
              <label className="form-label">
                {editId ? 'Current Stock' : 'Opening Qty (Initial Stock)'}
              </label>
              <input className="form-input" type="number" min="0" placeholder="0" value={form.CurrentStock} onChange={(e) => setForm({ ...form, CurrentStock: e.target.value })} />
              {!editId && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Stock on hand right now — purchases & sales will update this automatically</p>}
            </div>
            <div className="form-group">
              <label className="form-label">Reorder Level</label>
              <input className="form-input" type="number" min="0" placeholder="10" value={form.ReorderLevel} onChange={(e) => setForm({ ...form, ReorderLevel: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-textarea" placeholder="Optional description…" value={form.Description} onChange={(e) => setForm({ ...form, Description: e.target.value })} style={{ minHeight: 60 }} />
          </div>
        </Modal>
      )}
    </>
  );
}
