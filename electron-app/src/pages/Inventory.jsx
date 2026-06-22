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
  const [masterLists, setMasterLists] = useState({ categories: [], sizes: [], stockNames: [] });
  const [suppliers, setSuppliers] = useState([]);
  const [historyItem, setHistoryItem] = useState(null);

  const load = useCallback(async (q) => {
    setLoading(true);
    const res = await window.api.getInventory(q || '');
    if (res.ok) setItems(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load('');
    window.api.getMasterDataLists().then((r) => { if (r.ok) setMasterLists(r.data); });
    window.api.getSuppliers('').then((r) => { if (r.ok) setSuppliers(r.data); });
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(search), 350);
    return () => clearTimeout(t);
  }, [search, load]);

  function openAdd() {
    window.api.getMasterDataLists().then((r) => { if (r.ok) setMasterLists(r.data); });
    setForm({ ...EMPTY_ITEM }); setEditId(null); setError('');
  }
  function openEdit(item) {
    window.api.getMasterDataLists().then((r) => { if (r.ok) setMasterLists(r.data); });
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
                            <button className="btn btn-secondary btn-sm" title="Stock history" onClick={() => setHistoryItem(item)}>History</button>
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
              <select
                className="form-select"
                value={form.StockName}
                onChange={(e) => setForm({ ...form, StockName: e.target.value })}
              >
                <option value="">— Select stock name —</option>
                {masterLists.stockNames.map((n) => <option key={n} value={n}>{n}</option>)}
                {form.StockName && !masterLists.stockNames.includes(form.StockName) && (
                  <option value={form.StockName}>{form.StockName}</option>
                )}
              </select>
              {masterLists.stockNames.length === 0 && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Add stock names under Master Data in the sidebar.</p>
              )}
            </div>
          </div>
          <div className="form-row form-row-3">
            <div className="form-group">
              <label className="form-label">Plate Size</label>
              <select
                className="form-select"
                value={form.PlateSize}
                onChange={(e) => setForm({ ...form, PlateSize: e.target.value })}
              >
                <option value="">— Select size —</option>
                {masterLists.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                {form.PlateSize && !masterLists.sizes.includes(form.PlateSize) && (
                  <option value={form.PlateSize}>{form.PlateSize}</option>
                )}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Category</label>
              <select
                className="form-select"
                value={form.Category}
                onChange={(e) => setForm({ ...form, Category: e.target.value })}
              >
                <option value="">— Select category —</option>
                {masterLists.categories.map((c) => <option key={c} value={c}>{c}</option>)}
                {form.Category && !masterLists.categories.includes(form.Category) && (
                  <option value={form.Category}>{form.Category}</option>
                )}
              </select>
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

      {historyItem && (
        <InventoryHistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />
      )}
    </>
  );
}

const EVENT_LABELS = {
  opening: 'Opening Stock',
  purchase: 'Purchase Order',
  purchase_reversal: 'PO Reversed',
  sale: 'Sale',
  sale_reversal: 'Invoice Deleted',
  return: 'Return',
  adjustment: 'Adjustment',
};

const EVENT_BADGE = {
  opening: 'badge-gray',
  purchase: 'badge-green',
  purchase_reversal: 'badge-yellow',
  sale: 'badge-blue',
  sale_reversal: 'badge-yellow',
  return: 'badge-purple',
  adjustment: 'badge-gray',
};

function InventoryHistoryModal({ item, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.getInventoryHistory(item._id?.toString() || item._id);
    if (res.ok) setData(res.data);
    setLoading(false);
  }, [item]);

  useEffect(() => { load(); }, [load]);

  async function rebuild() {
    setRebuilding(true);
    await window.api.rebuildInventoryHistory(item._id?.toString() || item._id);
    await load();
    setRebuilding(false);
  }

  const fmtDate = (d) => d ? new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const fmtQty = (n) => {
    const v = Number(n) || 0;
    return v > 0 ? `+${v}` : String(v);
  };

  return (
    <Modal
      title={`Stock History — ${item.StockName}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-secondary btn-sm" onClick={rebuild} disabled={rebuilding || loading}>
            {rebuilding ? 'Rebuilding…' : '↻ Rebuild from records'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[['Code', item.ItemCode || '—'], ['Size', item.PlateSize || '—'], ['Current Stock', `${data?.currentStock ?? item.CurrentStock} ${item.Unit || 'Pcs'}`], ['Events', data?.events?.length ?? '—']].map(([l, v]) => (
          <div key={l} style={{ background: 'var(--bg)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{l}</div>
            <div style={{ fontWeight: 600, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : !data?.events?.length ? (
        <div className="empty-state"><p>No movement recorded yet for this item.</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Party</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Price</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((ev) => (
                <tr key={ev._id}>
                  <td className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(ev.EventDate)}</td>
                  <td>
                    <span className={`badge ${EVENT_BADGE[ev.EventType] || 'badge-gray'}`}>
                      {EVENT_LABELS[ev.EventType] || ev.EventType}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{ev.ReferenceNumber || '—'}</td>
                  <td>{ev.PartyName || '—'}</td>
                  <td className="text-right fw-bold" style={{ color: ev.QuantityChange > 0 ? 'var(--green)' : ev.QuantityChange < 0 ? 'var(--red)' : 'inherit' }}>
                    {fmtQty(ev.QuantityChange)} {ev.Unit || item.Unit}
                  </td>
                  <td className="text-right">{ev.BalanceAfter} {ev.Unit || item.Unit}</td>
                  <td className="text-right text-muted" style={{ fontSize: 12 }}>
                    {ev.UnitPrice != null ? fmt(ev.UnitPrice) : ev.UnitCost != null ? fmt(ev.UnitCost) : '—'}
                  </td>
                  <td className="text-muted" style={{ fontSize: 12, maxWidth: 180 }}>{ev.Notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
