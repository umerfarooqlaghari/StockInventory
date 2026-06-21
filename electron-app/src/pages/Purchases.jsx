import React, { useEffect, useState, useCallback } from 'react';
import Modal from '../components/Modal.jsx';

const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

export default function Purchases() {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null); // purchase being edited

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.getPurchases();
    if (res.ok) setPurchases(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(p) {
    if (!confirm(`Delete PO ${p.PurchaseNumber}? Stock will be reversed.`)) return;
    await window.api.deletePurchase(p._id?.toString());
    load();
  }

  const totalCost = purchases.reduce((s, p) => s + (p.TotalCost || 0), 0);

  return (
    <>
      <div className="page-header">
        <h1>Procurement & Purchases</h1>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Purchase Order</button>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <div className="card card-body" style={{ flex: 1, padding: '12px 18px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Total Orders</span>
            <strong style={{ display: 'block', fontSize: 20 }}>{purchases.length}</strong>
          </div>
          <div className="card card-body" style={{ flex: 2, padding: '12px 18px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Total Procurement Cost</span>
            <strong style={{ display: 'block', fontSize: 20 }}>{fmt(totalCost)}</strong>
          </div>
        </div>

        <div className="card">
          <div className="table-wrap">
            {loading ? <div className="loading-center"><div className="spinner" /></div> : purchases.length === 0 ? (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                <p>No purchase orders yet</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr><th>PO Number</th><th>Supplier</th><th>Date</th><th>Items</th><th>Total Cost</th><th>Notes</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p._id}>
                      <td className="mono">{p.PurchaseNumber}</td>
                      <td><strong>{p.SupplierName || '—'}</strong></td>
                      <td className="text-muted">{fmtDate(p.PurchaseDate)}</td>
                      <td><span className="badge badge-blue">{(p.Items || []).length} items</span></td>
                      <td className="fw-bold">{fmt(p.TotalCost)}</td>
                      <td className="text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.Notes || '—'}</td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-secondary btn-sm" onClick={() => setDetail(p)}>View</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(p)}>Edit</button>
                          <button className="btn-icon danger" onClick={() => remove(p)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {detail && (
        <Modal title={`Purchase Order — ${detail.PurchaseNumber}`} onClose={() => setDetail(null)} wide footer={
          <button className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>
        }>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[['Supplier', detail.SupplierName || '—'], ['Date', fmtDate(detail.PurchaseDate)], ['Total Cost', fmt(detail.TotalCost)]].map(([l, v]) => (
              <div key={l} style={{ background: 'var(--bg)', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{l}</div>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          {detail.Notes && <div className="notice notice-info" style={{ marginBottom: 14 }}>Notes: {detail.Notes}</div>}
          <table className="items-table">
            <thead><tr><th>Item</th><th>Size</th><th className="text-right">Qty</th><th className="text-right">Unit Cost</th><th className="text-right">Line Total</th></tr></thead>
            <tbody>
              {(detail.Items || []).map((item, i) => (
                <tr key={i}>
                  <td>{item.ItemName}</td><td>{item.PlateSize || '—'}</td>
                  <td className="text-right">{item.Quantity}</td>
                  <td className="text-right">{fmt(item.UnitCost)}</td>
                  <td className="text-right fw-bold">{fmt(item.LineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {/* Create Modal */}
      {showCreate && <CreatePurchaseModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />}

      {/* Edit Modal */}
      {editing && <EditPurchaseModal purchase={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function buildPurchaseLine(inv, qty, cost) {
  const q = Number(qty) || 1;
  const c = Number(cost) || Number(inv?.PurchasePrice) || 0;
  return {
    InventoryItemId: inv._id?.toString(),
    ItemCode: inv.ItemCode,
    ItemName: inv.StockName,
    PlateSize: inv.PlateSize || '',
    Quantity: q,
    UnitCost: c,
    LineTotal: q * c,
  };
}

function CreatePurchaseModal({ onClose, onSaved }) {
  const [inventory, setInventory] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [newItem, setNewItem] = useState({ inventoryId: '', qty: 1, cost: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.api.getInventory('').then((r) => { if (r.ok) setInventory(r.data); });
    window.api.getSuppliers('').then((r) => { if (r.ok) setSuppliers(r.data); });
  }, []);

  const selectedInv = inventory.find((i) => i._id?.toString() === newItem.inventoryId);

  // Live pending line for preview
  const pendingLine = selectedInv
    ? buildPurchaseLine(selectedInv, newItem.qty, newItem.cost)
    : null;

  function addItem() {
    if (!newItem.inventoryId) { setError('Select an item'); return; }
    if (!newItem.qty || Number(newItem.qty) <= 0) { setError('Enter a valid quantity'); return; }
    setItems((prev) => [...prev, buildPurchaseLine(selectedInv, newItem.qty, newItem.cost)]);
    setNewItem({ inventoryId: '', qty: 1, cost: '' });
    setError('');
  }

  // Items + pending line for live totals
  const displayItems = pendingLine ? [...items, { ...pendingLine, _pending: true }] : items;
  const totalCost = displayItems.reduce((s, i) => s + i.LineTotal, 0);

  async function submit() {
    const finalSupplier = supplierName === '__manual__' ? '' : supplierName;
    if (!finalSupplier.trim()) { setError('Select or enter a supplier name'); return; }

    // Auto-include the pending item if it looks valid
    let finalItems = [...items];
    if (pendingLine && newItem.inventoryId && Number(newItem.qty) > 0) {
      finalItems.push(buildPurchaseLine(selectedInv, newItem.qty, newItem.cost));
    }

    if (finalItems.length === 0) { setError('Add at least one item'); return; }
    setSaving(true); setError('');
    const res = await window.api.createPurchase({ SupplierName: finalSupplier, Notes: notes, Items: finalItems });
    if (res.ok) onSaved();
    else { setError(res.error || 'Failed to create purchase'); setSaving(false); }
  }

  return (
    <Modal title="New Purchase Order" onClose={onClose} wide footer={
      <><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save Purchase'}</button></>
    }>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="form-row form-row-2" style={{ marginBottom: 16 }}>
        <div className="form-group">
          <label className="form-label">Supplier *</label>
          {suppliers.length > 0 ? (
            <select
              className="form-select"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
            >
              <option value="">— Select supplier —</option>
              {suppliers.map((s) => (
                <option key={s._id} value={s.Name}>{s.Name}{s.City ? ` (${s.City})` : ''}</option>
              ))}
              <option value="__manual__">— Type manually —</option>
            </select>
          ) : (
            <input className="form-input" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Supplier name" />
          )}
          {supplierName === '__manual__' && (
            <input
              className="form-input"
              style={{ marginTop: 6 }}
              placeholder="Enter supplier name"
              value=""
              onChange={(e) => setSupplierName(e.target.value)}
              autoFocus
            />
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <input className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
        </div>
      </div>

      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Add Item</p>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 140px auto', gap: 8, alignItems: 'end' }}>
          <div>
            <label className="form-label">Item</label>
            <select className="form-select" value={newItem.inventoryId} onChange={(e) => {
              const inv = inventory.find((i) => i._id?.toString() === e.target.value);
              setNewItem({ ...newItem, inventoryId: e.target.value, cost: inv?.PurchasePrice || '' });
            }}>
              <option value="">— Select item —</option>
              {inventory.map((i) => <option key={i._id} value={i._id?.toString()}>{i.ItemCode} — {i.StockName} {i.PlateSize ? `(${i.PlateSize})` : ''}</option>)}
            </select>
          </div>
          <div><label className="form-label">Qty</label><input className="form-input" type="number" min="1" value={newItem.qty} onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })} /></div>
          <div><label className="form-label">Unit Cost (PKR)</label><input className="form-input" type="number" min="0" step="0.01" value={newItem.cost} onChange={(e) => setNewItem({ ...newItem, cost: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={addItem}>+ Add</button>
        </div>
      </div>

      {/* Always show items table */}
      <div className="card" style={{ marginBottom: 12 }}>
        <table className="items-table">
          <thead>
            <tr><th>Item</th><th>Size</th><th className="text-right">Qty</th><th className="text-right">Unit Cost</th><th className="text-right">Total</th><th></th></tr>
          </thead>
          <tbody>
            {displayItems.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px 0', fontStyle: 'italic' }}>No items added yet — fill the form above and click + Add, or just click Save Purchase</td></tr>
            ) : displayItems.map((item, i) => (
              <tr key={i} style={item._pending ? { opacity: 0.55, fontStyle: 'italic' } : {}}>
                <td>{item.ItemName}{item._pending ? ' (pending)' : ''}</td>
                <td>{item.PlateSize || '—'}</td>
                <td className="text-right">{item.Quantity}</td>
                <td className="text-right">{fmt(item.UnitCost)}</td>
                <td className="text-right fw-bold">{fmt(item.LineTotal)}</td>
                <td>
                  {!item._pending && (
                    <button className="btn-icon danger" style={{ fontSize: 12 }} onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>
        Total Cost: {fmt(totalCost)}
      </div>
    </Modal>
  );
}

// ── Edit Purchase Modal ────────────────────────────────────────────────────────
function EditPurchaseModal({ purchase, onClose, onSaved }) {
  const [inventory, setInventory] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierName, setSupplierName] = useState(purchase.SupplierName || '');
  const [notes, setNotes] = useState(purchase.Notes || '');
  const [items, setItems] = useState(purchase.Items ? purchase.Items.map((i) => ({ ...i })) : []);
  const [newItem, setNewItem] = useState({ inventoryId: '', qty: 1, cost: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.api.getInventory('').then((r) => { if (r.ok) setInventory(r.data); });
    window.api.getSuppliers('').then((r) => { if (r.ok) setSuppliers(r.data); });
  }, []);

  const selectedInv = inventory.find((i) => i._id?.toString() === newItem.inventoryId);
  const pendingLine = selectedInv ? buildPurchaseLine(selectedInv, newItem.qty, newItem.cost) : null;

  function addItem() {
    if (!newItem.inventoryId) { setError('Select an item'); return; }
    if (!newItem.qty || Number(newItem.qty) <= 0) { setError('Enter a valid quantity'); return; }
    setItems((prev) => [...prev, buildPurchaseLine(selectedInv, newItem.qty, newItem.cost)]);
    setNewItem({ inventoryId: '', qty: 1, cost: '' });
    setError('');
  }

  const displayItems = pendingLine ? [...items, { ...pendingLine, _pending: true }] : items;
  const totalCost = displayItems.reduce((s, i) => s + i.LineTotal, 0);

  async function submit() {
    const finalSupplier = supplierName === '__manual__' ? '' : supplierName;
    if (!finalSupplier.trim()) { setError('Select or enter a supplier'); return; }

    let finalItems = [...items];
    if (pendingLine && newItem.inventoryId && Number(newItem.qty) > 0) {
      finalItems.push(buildPurchaseLine(selectedInv, newItem.qty, newItem.cost));
    }
    if (finalItems.length === 0) { setError('Add at least one item'); return; }

    setSaving(true); setError('');
    const res = await window.api.updatePurchase({
      _id: purchase._id?.toString(),
      SupplierName: finalSupplier,
      Notes: notes,
      Items: finalItems,
    });
    if (res.ok) onSaved();
    else { setError(res.error || 'Failed to update purchase'); setSaving(false); }
  }

  return (
    <Modal title={`Edit — ${purchase.PurchaseNumber}`} onClose={onClose} wide footer={
      <><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button></>
    }>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="notice notice-warning" style={{ marginBottom: 14, fontSize: 12 }}>
        ⚠ Saving will reverse the original stock changes and re-apply the updated quantities.
      </div>

      <div className="form-row form-row-2" style={{ marginBottom: 16 }}>
        <div className="form-group">
          <label className="form-label">Supplier *</label>
          {suppliers.length > 0 ? (
            <select className="form-select" value={supplierName} onChange={(e) => setSupplierName(e.target.value)}>
              <option value="">— Select supplier —</option>
              {suppliers.map((s) => <option key={s._id} value={s.Name}>{s.Name}{s.City ? ` (${s.City})` : ''}</option>)}
              <option value="__manual__">— Type manually —</option>
            </select>
          ) : (
            <input className="form-input" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
          )}
          {supplierName === '__manual__' && (
            <input className="form-input" style={{ marginTop: 6 }} placeholder="Enter supplier name"
              value="" onChange={(e) => setSupplierName(e.target.value)} autoFocus />
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <input className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Add / Replace Items</p>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 140px auto', gap: 8, alignItems: 'end' }}>
          <div>
            <label className="form-label">Item</label>
            <select className="form-select" value={newItem.inventoryId} onChange={(e) => {
              const inv = inventory.find((i) => i._id?.toString() === e.target.value);
              setNewItem({ ...newItem, inventoryId: e.target.value, cost: inv?.PurchasePrice || '' });
            }}>
              <option value="">— Select item —</option>
              {inventory.map((i) => <option key={i._id} value={i._id?.toString()}>{i.ItemCode} — {i.StockName} {i.PlateSize ? `(${i.PlateSize})` : ''}</option>)}
            </select>
          </div>
          <div><label className="form-label">Qty</label><input className="form-input" type="number" min="1" value={newItem.qty} onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })} /></div>
          <div><label className="form-label">Unit Cost (PKR)</label><input className="form-input" type="number" min="0" step="0.01" value={newItem.cost} onChange={(e) => setNewItem({ ...newItem, cost: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={addItem}>+ Add</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <table className="items-table">
          <thead><tr><th>Item</th><th>Size</th><th className="text-right">Qty</th><th className="text-right">Unit Cost</th><th className="text-right">Total</th><th></th></tr></thead>
          <tbody>
            {displayItems.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px 0', fontStyle: 'italic' }}>No items</td></tr>
            ) : displayItems.map((item, i) => (
              <tr key={i} style={item._pending ? { opacity: 0.55, fontStyle: 'italic' } : {}}>
                <td>{item.ItemName}{item._pending ? ' (pending)' : ''}</td>
                <td>{item.PlateSize || '—'}</td>
                <td className="text-right">{item.Quantity}</td>
                <td className="text-right">{fmt(item.UnitCost)}</td>
                <td className="text-right fw-bold">{fmt(item.LineTotal)}</td>
                <td>{!item._pending && <button className="btn-icon danger" style={{ fontSize: 12 }} onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>Total Cost: {fmt(totalCost)}</div>
    </Modal>
  );
}
