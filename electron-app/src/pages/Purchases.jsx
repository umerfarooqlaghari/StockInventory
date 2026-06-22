import React, { useEffect, useState, useCallback } from 'react';
import Modal from '../components/Modal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

export const PO_STATUSES = ['Pending', 'Received', 'Not Delivered', 'Out of Stock', 'Cancelled'];

function displayStatus(p) {
  return p?.Status || 'Received';
}

function isReceived(p) {
  return displayStatus(p) === 'Received';
}

function lineOrderedQty(line) {
  return Number(line?.Quantity) || 0;
}

function lineReceivedQty(line) {
  if (line?.ReceivedQuantity != null && line.ReceivedQuantity !== '') {
    return Number(line.ReceivedQuantity) || 0;
  }
  return lineOrderedQty(line);
}

function buildReceivedDraft(purchase) {
  return (purchase.Items || []).map((line) => ({
    InventoryItemId: line.InventoryItemId,
    ItemName: line.ItemName,
    PlateSize: line.PlateSize,
    Quantity: lineOrderedQty(line),
    UnitCost: Number(line.UnitCost) || 0,
    ReceivedQuantity: lineReceivedQty(line),
  }));
}

function draftHasVariedReceipt(lines) {
  return lines.some((l) => Number(l.ReceivedQuantity) !== Number(l.Quantity));
}

function ReceiptPanel({ lines, setLines, varied, setVaried }) {
  const orderedTotal = lines.reduce((s, l) => s + l.Quantity * l.UnitCost, 0);
  const receivedTotal = lines.reduce((s, l) => s + (Number(l.ReceivedQuantity) || 0) * l.UnitCost, 0);

  function setReceived(idx, value) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ReceivedQuantity: value } : l)));
  }

  function setVariedMode(nextVaried) {
    setVaried(nextVaried);
    if (!nextVaried) {
      setLines((prev) => prev.map((l) => ({ ...l, ReceivedQuantity: l.Quantity })));
    }
  }

  return (
    <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
      <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Delivery confirmation</p>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="radio" checked={!varied} onChange={() => setVariedMode(false)} />
          Complete — received as ordered
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="radio" checked={varied} onChange={() => setVariedMode(true)} />
          Varied — adjust received quantities
        </label>
      </div>
      <table className="items-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="text-right">Ordered</th>
            <th className="text-right">Received</th>
            <th className="text-right">Unit Cost</th>
            <th className="text-right">Received Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => {
            const recv = Number(line.ReceivedQuantity) || 0;
            const diff = recv !== line.Quantity;
            return (
              <tr key={idx}>
                <td>{line.ItemName}{line.PlateSize ? ` (${line.PlateSize})` : ''}</td>
                <td className="text-right">{line.Quantity}</td>
                <td className="text-right">
                  {varied ? (
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="1"
                      style={{ width: 72, textAlign: 'right', padding: '4px 8px' }}
                      value={line.ReceivedQuantity}
                      onChange={(e) => setReceived(idx, e.target.value)}
                    />
                  ) : (
                    line.Quantity
                  )}
                </td>
                <td className="text-right">{fmt(line.UnitCost)}</td>
                <td className="text-right fw-bold" style={{ color: diff ? 'var(--yellow)' : 'inherit' }}>
                  {fmt(recv * line.UnitCost)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, marginTop: 12, fontSize: 13 }}>
        <span className="text-muted">Ordered: <strong>{fmt(orderedTotal)}</strong></span>
        <span>Books (received): <strong>{fmt(receivedTotal)}</strong></span>
      </div>
    </div>
  );
}

export default function Purchases() {
  const [purchases, setPurchases] = useState([]);
  const [summary, setSummary] = useState({ receivedCost: 0, pendingCost: 0, pendingCount: 0, receivedCount: 0, totalOrders: 0 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [statusFilter, setStatusFilter] = useState('All');

  const load = useCallback(async () => {
    setLoading(true);
    const [listRes, summaryRes] = await Promise.all([
      window.api.getPurchases(),
      window.api.getPurchaseSummary(),
    ]);
    if (listRes.ok) setPurchases(listRes.data);
    if (summaryRes.ok) setSummary(summaryRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(p) {
    const stockNote = isReceived(p) ? ' Stock will be reversed.' : '';
    if (!confirm(`Delete PO ${p.PurchaseNumber}?${stockNote}`)) return;
    await window.api.deletePurchase(p._id?.toString());
    load();
  }

  const filtered = statusFilter === 'All'
    ? purchases
    : purchases.filter((p) => displayStatus(p) === statusFilter);

  return (
    <>
      <div className="page-header">
        <h1>Procurement & Purchases</h1>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Purchase Order</button>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
          <div className="card card-body" style={{ padding: '12px 18px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Total Orders</span>
            <strong style={{ display: 'block', fontSize: 20 }}>{summary.totalOrders}</strong>
          </div>
          <div className="card card-body" style={{ padding: '12px 18px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Received (stock & cost)</span>
            <strong style={{ display: 'block', fontSize: 20, color: 'var(--green)' }}>{fmt(summary.receivedCost)}</strong>
            <span className="text-muted" style={{ fontSize: 11 }}>{summary.receivedCount} order(s)</span>
          </div>
          <div className="card card-body" style={{ padding: '12px 18px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Pending (not in stock/finance)</span>
            <strong style={{ display: 'block', fontSize: 20, color: 'var(--yellow)' }}>{fmt(summary.pendingCost)}</strong>
            <span className="text-muted" style={{ fontSize: 11 }}>{summary.pendingCount} order(s)</span>
          </div>
          <div className="card card-body" style={{ padding: '12px 18px' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>Filtered list value</span>
            <strong style={{ display: 'block', fontSize: 20 }}>
              {fmt(filtered.reduce((s, p) => s + (isReceived(p) ? (p.TotalCost || 0) : 0), 0))}
            </strong>
            <span className="text-muted" style={{ fontSize: 11 }}>Received only</span>
          </div>
        </div>

        <div className="toolbar" style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            Status:
            <select className="form-select" style={{ width: 180 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All statuses</option>
              {PO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <div className="card">
          <div className="table-wrap">
            {loading ? <div className="loading-center"><div className="spinner" /></div> : filtered.length === 0 ? (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                <p>{statusFilter === 'All' ? 'No purchase orders yet' : `No ${statusFilter.toLowerCase()} orders`}</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr><th>PO Number</th><th>Status</th><th>Supplier</th><th>Date</th><th>Items</th><th>Total Cost</th><th>Notes</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p._id}>
                      <td className="mono">{p.PurchaseNumber}</td>
                      <td><StatusBadge status={displayStatus(p)} /></td>
                      <td><strong>{p.SupplierName || '—'}</strong></td>
                      <td className="text-muted">{fmtDate(p.PurchaseDate)}</td>
                      <td><span className="badge badge-blue">{(p.Items || []).length} items</span></td>
                      <td className="fw-bold">
                        {fmt(p.TotalCost)}
                        {isReceived(p) && p.ReceiptVaried && (
                          <div className="text-muted" style={{ fontSize: 10, fontWeight: 500 }}>
                            ordered {fmt(p.OrderedTotalCost ?? p.TotalCost)}
                          </div>
                        )}
                        {!isReceived(p) && <div className="text-muted" style={{ fontSize: 10, fontWeight: 500 }}>excluded from stock</div>}
                      </td>
                      <td className="text-muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.StatusNotes || p.Notes}>
                        {p.StatusNotes || p.Notes || '—'}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-secondary btn-sm" onClick={() => setDetail(p)}>View</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setStatusTarget(p)}>Status</button>
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

      {detail && (
        <Modal title={`Purchase Order — ${detail.PurchaseNumber}`} onClose={() => setDetail(null)} wide footer={
          <>
            <button className="btn btn-secondary" onClick={() => { setStatusTarget(detail); setDetail(null); }}>Update Status</button>
            <button className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>
          </>
        }>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[['Supplier', detail.SupplierName || '—'], ['Date', fmtDate(detail.PurchaseDate)], ['Status', displayStatus(detail)], ['Total Cost', fmt(detail.TotalCost)]].map(([l, v]) => (
              <div key={l} style={{ background: 'var(--bg)', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{l}</div>
                <div style={{ fontWeight: 600, marginTop: 2 }}>
                  {l === 'Status' ? <StatusBadge status={v} /> : v}
                </div>
              </div>
            ))}
          </div>
          {!isReceived(detail) && (
            <div className="notice notice-info" style={{ marginBottom: 14, fontSize: 12 }}>
              This order is <strong>{displayStatus(detail)}</strong> — stock and procurement totals only update when status is <strong>Received</strong>.
            </div>
          )}
          {isReceived(detail) && detail.ReceiptVaried && (
            <div className="notice notice-warning" style={{ marginBottom: 14, fontSize: 12 }}>
              Partial / varied delivery — books reflect received quantities, not the original order.
            </div>
          )}
          {detail.StatusNotes && <div className="notice notice-warning" style={{ marginBottom: 14, fontSize: 12 }}>Status note: {detail.StatusNotes}</div>}
          {detail.Notes && <div className="notice notice-info" style={{ marginBottom: 14 }}>Notes: {detail.Notes}</div>}
          <table className="items-table">
            <thead>
              <tr>
                <th>Item</th><th>Size</th>
                <th className="text-right">Ordered</th>
                {isReceived(detail) && <th className="text-right">Received</th>}
                <th className="text-right">Unit Cost</th>
                <th className="text-right">{isReceived(detail) ? 'Received Total' : 'Line Total'}</th>
              </tr>
            </thead>
            <tbody>
              {(detail.Items || []).map((item, i) => (
                <tr key={i}>
                  <td>{item.ItemName}</td><td>{item.PlateSize || '—'}</td>
                  <td className="text-right">{item.Quantity}</td>
                  {isReceived(detail) && (
                    <td className="text-right" style={{ fontWeight: lineReceivedQty(item) !== lineOrderedQty(item) ? 700 : 400, color: lineReceivedQty(item) !== lineOrderedQty(item) ? 'var(--yellow)' : 'inherit' }}>
                      {lineReceivedQty(item)}
                    </td>
                  )}
                  <td className="text-right">{fmt(item.UnitCost)}</td>
                  <td className="text-right fw-bold">
                    {fmt(isReceived(detail) ? (item.ReceivedLineTotal ?? lineReceivedQty(item) * (item.UnitCost || 0)) : item.LineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isReceived(detail) && detail.OrderedTotalCost != null && detail.OrderedTotalCost !== detail.TotalCost && (
            <div style={{ textAlign: 'right', marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              Ordered value: {fmt(detail.OrderedTotalCost)} → Received value: <strong>{fmt(detail.TotalCost)}</strong>
            </div>
          )}
        </Modal>
      )}

      {statusTarget && (
        <UpdateStatusModal
          purchase={statusTarget}
          onClose={() => setStatusTarget(null)}
          onSaved={() => { setStatusTarget(null); load(); }}
        />
      )}

      {showCreate && <CreatePurchaseModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />}
      {editing && <EditPurchaseModal purchase={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function UpdateStatusModal({ purchase, onClose, onSaved }) {
  const [status, setStatus] = useState(displayStatus(purchase));
  const [statusNotes, setStatusNotes] = useState(purchase.StatusNotes || '');
  const [receiptLines, setReceiptLines] = useState(() => buildReceivedDraft(purchase));
  const [variedReceipt, setVariedReceipt] = useState(() => draftHasVariedReceipt(buildReceivedDraft(purchase)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const wasReceived = isReceived(purchase);
  const willReceive = status === 'Received';
  const showReceipt = willReceive && (purchase.Items || []).length > 0;

  async function submit() {
    setSaving(true); setError('');

    let receivedItems;
    if (showReceipt) {
      for (const line of receiptLines) {
        const recv = Number(line.ReceivedQuantity);
        if (Number.isNaN(recv) || recv < 0) {
          setError(`Invalid received quantity for ${line.ItemName}`);
          setSaving(false);
          return;
        }
      }
      receivedItems = receiptLines.map((l) => ({
        InventoryItemId: l.InventoryItemId,
        ReceivedQuantity: variedReceipt ? Number(l.ReceivedQuantity) : Number(l.Quantity),
      }));
    }

    const res = await window.api.updatePurchaseStatus(
      purchase._id?.toString(),
      status,
      statusNotes,
      receivedItems
    );
    if (res.ok) onSaved();
    else { setError(res.error || 'Failed to update status'); setSaving(false); }
  }

  return (
    <Modal
      title={`Update Status — ${purchase.PurchaseNumber}`}
      onClose={onClose}
      wide={showReceipt}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save Status'}</button>
        </>
      }
    >
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="form-group">
        <label className="form-label">Order Status *</label>
        <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {PO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Status Notes</label>
        <textarea
          className="form-textarea"
          style={{ minHeight: 70 }}
          placeholder="e.g. Supplier could only deliver 8 of 10"
          value={statusNotes}
          onChange={(e) => setStatusNotes(e.target.value)}
        />
      </div>

      {showReceipt && (
        <ReceiptPanel
          lines={receiptLines}
          setLines={setReceiptLines}
          varied={variedReceipt}
          setVaried={setVariedReceipt}
        />
      )}

      {!wasReceived && willReceive && (
        <div className="notice notice-success" style={{ fontSize: 12 }}>
          Marking as <strong>Received</strong> will add the <strong>received quantities</strong> to inventory and procurement totals.
        </div>
      )}
      {wasReceived && willReceive && (
        <div className="notice notice-info" style={{ fontSize: 12 }}>
          Adjust received quantities above to correct books — stock will be recalculated.
        </div>
      )}
      {wasReceived && !willReceive && (
        <div className="notice notice-warning" style={{ fontSize: 12 }}>
          Changing from <strong>Received</strong> will reverse received stock and remove this order from procurement totals.
        </div>
      )}
      {status === 'Pending' && (
        <div className="notice notice-info" style={{ fontSize: 12, marginTop: 8 }}>
          <strong>Pending</strong> — order recorded but goods not yet received; no stock or cost impact.
        </div>
      )}
    </Modal>
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
  const [status, setStatus] = useState('Pending');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [newItem, setNewItem] = useState({ inventoryId: '', qty: 1, cost: '' });
  const [receiptLines, setReceiptLines] = useState([]);
  const [variedReceipt, setVariedReceipt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.api.getInventory('').then((r) => { if (r.ok) setInventory(r.data); });
    window.api.getSuppliers('').then((r) => { if (r.ok) setSuppliers(r.data); });
  }, []);

  useEffect(() => {
    if (status === 'Received') {
      setReceiptLines(items.map((line) => ({
        InventoryItemId: line.InventoryItemId,
        ItemName: line.ItemName,
        PlateSize: line.PlateSize,
        Quantity: line.Quantity,
        UnitCost: line.UnitCost,
        ReceivedQuantity: line.Quantity,
      })));
      setVariedReceipt(false);
    }
  }, [items, status]);

  const selectedInv = inventory.find((i) => i._id?.toString() === newItem.inventoryId);
  const pendingLine = selectedInv ? buildPurchaseLine(selectedInv, newItem.qty, newItem.cost) : null;
  const showReceipt = status === 'Received' && items.length > 0;

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
    if (!finalSupplier.trim()) { setError('Select or enter a supplier name'); return; }

    let finalItems = [...items];
    if (pendingLine && newItem.inventoryId && Number(newItem.qty) > 0) {
      finalItems.push(buildPurchaseLine(selectedInv, newItem.qty, newItem.cost));
    }
    if (finalItems.length === 0) { setError('Add at least one item'); return; }

    let receivedItems;
    if (status === 'Received') {
      for (const line of receiptLines) {
        const recv = Number(line.ReceivedQuantity);
        if (Number.isNaN(recv) || recv < 0) {
          setError(`Invalid received quantity for ${line.ItemName}`);
          return;
        }
      }
      receivedItems = receiptLines.map((l) => ({
        InventoryItemId: l.InventoryItemId,
        ReceivedQuantity: variedReceipt ? Number(l.ReceivedQuantity) : Number(l.Quantity),
      }));
    }

    setSaving(true); setError('');
    const res = await window.api.createPurchase({
      SupplierName: finalSupplier,
      Status: status,
      Notes: notes,
      Items: finalItems,
      ReceivedItems: receivedItems,
    });
    if (res.ok) onSaved();
    else { setError(res.error || 'Failed to create purchase'); setSaving(false); }
  }

  return (
    <Modal title="New Purchase Order" onClose={onClose} wide footer={
      <><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save Purchase'}</button></>
    }>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="notice notice-info" style={{ marginBottom: 14, fontSize: 12 }}>
        New orders default to <strong>Pending</strong>. Stock and procurement cost only apply when status is <strong>Received</strong>.
      </div>

      <div className="form-row form-row-3" style={{ marginBottom: 16 }}>
        <div className="form-group">
          <label className="form-label">Supplier *</label>
          {suppliers.length > 0 ? (
            <select className="form-select" value={supplierName} onChange={(e) => setSupplierName(e.target.value)}>
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
            <input className="form-input" style={{ marginTop: 6 }} placeholder="Enter supplier name" value="" onChange={(e) => setSupplierName(e.target.value)} autoFocus />
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {PO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <input className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
        </div>
      </div>

      {showReceipt && (
        <ReceiptPanel
          lines={receiptLines}
          setLines={setReceiptLines}
          varied={variedReceipt}
          setVaried={setVariedReceipt}
        />
      )}

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

      <div className="card" style={{ marginBottom: 12 }}>
        <table className="items-table">
          <thead>
            <tr><th>Item</th><th>Size</th><th className="text-right">Qty</th><th className="text-right">Unit Cost</th><th className="text-right">Total</th><th></th></tr>
          </thead>
          <tbody>
            {displayItems.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px 0', fontStyle: 'italic' }}>No items added yet</td></tr>
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
      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>
        Order Value: {fmt(totalCost)}
        {status !== 'Received' && <span className="text-muted" style={{ fontSize: 12, fontWeight: 500, marginLeft: 8 }}>(not in stock/finance until Received)</span>}
      </div>
    </Modal>
  );
}

function EditPurchaseModal({ purchase, onClose, onSaved }) {
  const [inventory, setInventory] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierName, setSupplierName] = useState(purchase.SupplierName || '');
  const [status, setStatus] = useState(displayStatus(purchase));
  const [statusNotes, setStatusNotes] = useState(purchase.StatusNotes || '');
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
      Status: status,
      StatusNotes: statusNotes,
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
        Stock changes apply only when status is <strong>Received</strong>. Saving will recalculate inventory based on the new status and line items.
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
            <input className="form-input" style={{ marginTop: 6 }} placeholder="Enter supplier name" value="" onChange={(e) => setSupplierName(e.target.value)} autoFocus />
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {PO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row form-row-2" style={{ marginBottom: 16 }}>
        <div className="form-group">
          <label className="form-label">Status Notes</label>
          <input className="form-input" value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} placeholder="Reason for status change" />
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
      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 15 }}>Order Value: {fmt(totalCost)}</div>
    </Modal>
  );
}
