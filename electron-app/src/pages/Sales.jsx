import React, { useEffect, useState, useCallback } from 'react';
import Modal from '../components/Modal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';
const STATUSES = ['All', 'Unpaid', 'Partial', 'Paid', 'Returned'];

export default function Sales() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [payModal, setPayModal] = useState(null); // { sale }
  const [notifyMsg, setNotifyMsg] = useState(null); // { type: 'ok'|'err', text }

  const load = useCallback(async (q, st) => {
    setLoading(true);
    const res = await window.api.getSales(q || '', st === 'All' ? '' : st || '');
    if (res.ok) setSales(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { load('', 'All'); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(search, statusFilter), 350); return () => clearTimeout(t); }, [search, statusFilter, load]);

  async function generatePdf(sale) {
    await window.api.generateInvoicePdf(sale._id?.toString());
  }

  async function removeSale(sale) {
    if (!confirm(`Delete invoice ${sale.InvoiceNumber}? Stock will be restored.`)) return;
    await window.api.deleteSale(sale._id?.toString());
    load(search, statusFilter);
  }

  async function savePayment(entry) {
    if (!payModal) return;
    const res = await window.api.recordPayment(payModal.sale._id?.toString(), entry);
    if (res.ok) { setPayModal(null); load(search, statusFilter); }
    else alert(res.error || 'Failed to record payment');
  }

  async function exportExcel() { await window.api.exportSalesExcel(); }

  async function notifyNow(sale) {
    const res = await window.api.notifySaleNow(sale._id?.toString());
    if (res.ok && res.data?.sent) {
      setNotifyMsg({ type: 'ok', text: `Reminder sent to ${res.data.clientEmail}` });
    } else if (res.ok && !res.data?.sent) {
      setNotifyMsg({ type: 'err', text: `No email on file for ${sale.ClientName}` });
    } else {
      setNotifyMsg({ type: 'err', text: res.error || 'Failed to send' });
    }
    setTimeout(() => setNotifyMsg(null), 4000);
  }

  async function markReturned(sale) {
    if (!confirm(`Mark invoice ${sale.InvoiceNumber} as Returned? Stock will be restored.`)) return;
    await window.api.markSaleReturned(sale._id?.toString());
    setDetail(null);
    load(search, statusFilter);
  }

  return (
    <>
      <div className="page-header">
        <h1>Sales & Invoicing</h1>
        <div className="page-header-actions">
          {notifyMsg && (
            <span className={`notice ${notifyMsg.type === 'ok' ? 'notice-success' : 'notice-error'}`} style={{ fontSize: 12 }}>
              {notifyMsg.type === 'ok' ? '✓' : '✗'} {notifyMsg.text}
            </span>
          )}
          <button className="btn btn-secondary btn-sm" onClick={exportExcel}>⬇ Export Excel</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Invoice</button>
        </div>
      </div>

      <div className="page-body">
        <div className="toolbar">
          <div className="search-bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="form-input" placeholder="Search invoices…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {STATUSES.map((s) => (
              <button key={s} className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter(s)}>{s}</button>
            ))}
          </div>
          <span className="text-muted" style={{ fontSize: 12 }}>{sales.length} invoices</span>
        </div>

        <div className="card">
          <div className="table-wrap">
            {loading ? <div className="loading-center"><div className="spinner" /></div> : sales.length === 0 ? (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <p>No invoices found</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr><th>Invoice #</th><th>Client</th><th>Date</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {sales.map((s) => {
                    const days = Math.floor((Date.now() - new Date(s.SaleDate).getTime()) / 86400000);
                    const overdue = s.PaymentStatus !== 'Paid' && days > 45;
                    return (
                      <tr key={s._id} style={overdue ? { background: '#FFF8F8' } : {}}>
                        <td className="mono">{s.InvoiceNumber}</td>
                        <td>{s.ClientName}{overdue && <><br /><span className="badge badge-red" style={{ fontSize: 10 }}>{days}d overdue</span></>}</td>
                        <td className="text-muted">{fmtDate(s.SaleDate)}</td>
                        <td className="fw-bold">{fmt(s.TotalAmount)}</td>
                        <td className="text-success">{fmt(s.PaidAmount)}</td>
                        <td className={s.Balance > 0 ? 'text-danger fw-bold' : 'text-muted'}>{fmt(s.Balance)}</td>
                        <td><StatusBadge status={s.PaymentStatus} /></td>
                        <td>
                          <div className="table-actions">
                            <button className="btn btn-secondary btn-sm" onClick={() => setDetail(s)}>View</button>
                            {s.PaymentStatus !== 'Paid' && s.PaymentStatus !== 'Returned' && (
                              <button className="btn btn-secondary btn-sm" onClick={() => setPayModal({ sale: s })}>Pay</button>
                            )}
                            <button className="btn btn-secondary btn-sm" onClick={() => generatePdf(s)}>PDF</button>
                            {s.PaymentStatus !== 'Paid' && s.PaymentStatus !== 'Returned' && (
                              <button
                                className="btn btn-sm"
                                style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}
                                title="Send payment reminder email immediately"
                                onClick={() => notifyNow(s)}
                              >
                                ✉ Notify
                              </button>
                            )}
                            <button className="btn-icon danger" onClick={() => removeSale(s)}>🗑</button>
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

      {/* Detail Modal */}
      {detail && (
        <Modal title={`Invoice ${detail.InvoiceNumber}`} onClose={() => setDetail(null)} wide footer={
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => generatePdf(detail)}>PDF</button>
            {detail.PaymentStatus !== 'Paid' && detail.PaymentStatus !== 'Returned' && (
              <button
                className="btn btn-sm"
                style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}
                onClick={() => notifyNow(detail)}
              >✉ Notify Now</button>
            )}
            {detail.PaymentStatus !== 'Returned' && (
              <button
                className="btn btn-sm"
                style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB' }}
                onClick={() => markReturned(detail)}
              >↩ Mark Returned</button>
            )}
            <button className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>
          </>
        }>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[['Client', detail.ClientName], ['Phone', detail.ClientPhone || '—'], ['Date', fmtDate(detail.SaleDate)], ['Due Date', fmtDate(detail.DueDate)]].map(([l, v]) => (
              <div key={l} style={{ background: 'var(--bg)', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{l}</div>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <table className="items-table" style={{ marginBottom: 16 }}>
            <thead><tr><th>Item</th><th>Size</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Discount</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {(detail.Items || []).map((item, i) => (
                <tr key={i}>
                  <td>{item.ItemName}</td><td>{item.PlateSize || '—'}</td>
                  <td className="text-right">{item.Quantity}</td>
                  <td className="text-right">{fmt(item.UnitPrice)}</td>
                  <td className="text-right">{fmt(item.DiscountAmount)}</td>
                  <td className="text-right fw-bold">{fmt(item.LineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 280 }}>
              {[['Subtotal', detail.Subtotal], ['Overall Discount', detail.OverallDiscount], ['Tax', detail.TaxAmount]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  <span>{l}</span><span>{fmt(v)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '2px solid var(--border)', fontWeight: 700, fontSize: 15 }}>
                <span>Total</span><span>{fmt(detail.TotalAmount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--green)', fontSize: 13 }}>
                <span>Paid</span><span>{fmt(detail.PaidAmount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: detail.Balance > 0 ? 'var(--red)' : 'var(--text-muted)', fontWeight: 700 }}>
                <span>Balance</span><span>{fmt(detail.Balance)}</span>
              </div>
            </div>
          </div>
          {detail.Notes && <div className="notice notice-info" style={{ marginTop: 12 }}>Notes: {detail.Notes}</div>}

          {/* Payment History */}
          {(detail.PaymentHistory || []).length > 0 && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Payment History</p>
              <table className="items-table">
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Reference</th><th className="text-right">Amount</th><th>Proof</th></tr>
                </thead>
                <tbody>
                  {(detail.PaymentHistory || []).map((p, i) => (
                    <tr key={i}>
                      <td className="text-muted">{fmtDate(p.PaidAt)}</td>
                      <td><span className={`badge ${p.PaymentType === 'Cash' ? 'badge-green' : p.PaymentType === 'Cheque' ? 'badge-blue' : 'badge-purple'}`}>{p.PaymentType}</span></td>
                      <td className="mono">{p.ReferenceId || '—'}</td>
                      <td className="text-right fw-bold text-success">{fmt(p.Amount)}</td>
                      <td>{p.ProofUrl ? <a href={p.ProofUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: 12 }}>View</a> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {/* Payment Modal */}
      {payModal && (
        <RecordPaymentModal
          sale={payModal.sale}
          onClose={() => setPayModal(null)}
          onSaved={savePayment}
        />
      )}

      {/* Create Invoice Modal */}
      {showCreate && <CreateSaleModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(search, statusFilter); }} />}
    </>
  );
}

function RecordPaymentModal({ sale, onClose, onSaved }) {
  const [amount, setAmount] = useState('');
  const [payType, setPayType] = useState('Cash');
  const [payRef, setPayRef] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [proofUploading, setProofUploading] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const remaining = (sale.Balance || 0);

  async function uploadProof() {
    const filePath = await window.api.openFileDialog({
      title: 'Select Payment Proof',
      properties: ['openFile'],
      filters: [{ name: 'Images / PDF', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf'] }],
    });
    if (!filePath) return;
    setProofUploading(true);
    const res = await window.api.uploadPaymentProof(filePath, sale.InvoiceNumber);
    setProofUploading(false);
    if (res.ok) setProofUrl(res.data);
    else alert('Upload failed: ' + (res.error || 'unknown error'));
  }

  async function save() {
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError('Enter a valid payment amount'); return; }
    if (amt > remaining + 0.01) { setError(`Amount exceeds outstanding balance of ${fmt(remaining)}`); return; }
    if ((payType === 'Cheque' || payType === 'Online') && !payRef) {
      setError(`Enter the ${payType === 'Cheque' ? 'cheque number' : 'transaction ID'}`); return;
    }
    setSaving(true);
    await onSaved({ Amount: amt, PaymentType: payType, ReferenceId: payRef, ProofUrl: proofUrl, Notes: notes });
    setSaving(false);
  }

  return (
    <Modal title={`Record Payment — ${sale.InvoiceNumber}`} onClose={onClose} footer={
      <><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Payment'}</button></>
    }>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[['Total Amount', fmt(sale.TotalAmount)], ['Already Paid', fmt(sale.PaidAmount)], ['Outstanding Balance', fmt(remaining)]].map(([l, v]) => (
          <div key={l} style={{ background: 'var(--bg)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{l}</div>
            <div style={{ fontWeight: 700, marginTop: 2, color: l === 'Outstanding Balance' ? 'var(--red)' : undefined }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Payment history mini-list */}
      {(sale.PaymentHistory || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>Previous Payments</p>
          {(sale.PaymentHistory || []).map((p, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{fmtDate(p.PaidAt)} · <strong>{p.PaymentType}</strong>{p.ReferenceId ? ` · ${p.ReferenceId}` : ''}</span>
              <span className="text-success fw-bold">{fmt(p.Amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* New payment entry */}
      <div className="form-group">
        <label className="form-label">Payment Amount (PKR) *</label>
        <input className="form-input" type="number" min="0.01" step="0.01" placeholder={`max ${fmt(remaining)}`}
          value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </div>

      <div className="form-group">
        <label className="form-label">Payment Type *</label>
        <select className="form-select" value={payType} onChange={(e) => { setPayType(e.target.value); setPayRef(''); setProofUrl(''); }}>
          <option value="Cash">Cash</option>
          <option value="Cheque">Cheque</option>
          <option value="Online">Online Transfer</option>
        </select>
      </div>

      {(payType === 'Cheque' || payType === 'Online') && (
        <>
          <div className="form-group">
            <label className="form-label">{payType === 'Cheque' ? 'Cheque No.' : 'Transaction ID'} *</label>
            <input className="form-input" placeholder={payType === 'Cheque' ? 'e.g. CHQ-00123' : 'e.g. TXN-9987654'} value={payRef} onChange={(e) => setPayRef(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Proof Screenshot <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            {proofUrl
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a href={proofUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: 12 }}>View uploaded proof</a>
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setProofUrl('')}>Remove</button>
                </div>
              : <button type="button" className="btn btn-sm btn-secondary" onClick={uploadProof} disabled={proofUploading}>
                  {proofUploading ? 'Uploading…' : '⬆ Upload Proof'}
                </button>
            }
          </div>
        </>
      )}

      <div className="form-group">
        <label className="form-label">Notes <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
        <input className="form-input" placeholder="e.g. bank transfer confirmation" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

function buildLineItem(inv, qty, price, discAmt) {
  const q = Number(qty) || 1;
  const p = Number(price) || Number(inv.SalePrice) || 0;
  const d = Number(discAmt) || 0;
  const lineTotal = q * p - d;
  const profitPerUnit = p - Number(inv.PurchasePrice || 0);
  return {
    InventoryItemId: inv._id,
    ItemCode: inv.ItemCode,
    ItemName: inv.StockName,
    PlateSize: inv.PlateSize || '',
    Quantity: q,
    UnitPrice: p,
    PurchasePrice: Number(inv.PurchasePrice || 0),
    DiscountPercent: 0,
    DiscountAmount: d,
    LineTotal: lineTotal,
    ProfitPerUnit: profitPerUnit,
    TotalProfit: profitPerUnit * q - d,
  };
}

function CreateSaleModal({ onClose, onSaved }) {
  const [clients, setClients] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [items, setItems] = useState([]);
  const [newItem, setNewItem] = useState({ inventoryId: '', qty: 1, price: '', discount: 0 });
  const [overallDiscount, setOverallDiscount] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Payment details
  const [payType, setPayType] = useState('Cash');
  const [payRef, setPayRef] = useState('');
  const [proofUploading, setProofUploading] = useState(false);
  const [proofUrl, setProofUrl] = useState('');

  useEffect(() => {
    window.api.getClients('').then((r) => { if (r.ok) setClients(r.data); });
    window.api.getInventory('').then((r) => { if (r.ok) setInventory(r.data); });
  }, []);

  const selectedInvItem = inventory.find((i) => i._id === newItem.inventoryId);

  // Preview of the pending (not-yet-added) item so subtotal is always live
  const pendingLine = selectedInvItem && Number(newItem.qty) > 0
    ? buildLineItem(selectedInvItem, newItem.qty, newItem.price, newItem.discount)
    : null;

  function addItem() {
    if (!newItem.inventoryId) { setError('Select an item from the dropdown'); return; }
    if (!newItem.qty || Number(newItem.qty) <= 0) { setError('Enter a valid quantity'); return; }
    if (!selectedInvItem) { setError('Item not found — please re-select'); return; }
    setItems((prev) => [...prev, buildLineItem(selectedInvItem, newItem.qty, newItem.price, newItem.discount)]);
    setNewItem({ inventoryId: '', qty: 1, price: '', discount: 0 });
    setError('');
  }

  function removeItem(idx) { setItems((prev) => prev.filter((_, i) => i !== idx)); }

  // Include the pending row in live totals so the summary is always meaningful
  const allLines = pendingLine ? [...items, pendingLine] : items;
  const subtotal = allLines.reduce((s, i) => s + i.LineTotal, 0);
  const totalAmt = subtotal - Number(overallDiscount);
  const balance = totalAmt - Number(paidAmount);
  const totalProfit = allLines.reduce((s, i) => s + i.TotalProfit, 0) - Number(overallDiscount);

  const selectedClient = clients.find((c) => c._id === selectedClientId);

  async function uploadProof(invoiceHint) {
    const filePath = await window.api.openFileDialog({
      title: 'Select Payment Proof',
      properties: ['openFile'],
      filters: [{ name: 'Images / PDF', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf'] }],
    });
    if (!filePath) return;
    setProofUploading(true);
    const res = await window.api.uploadPaymentProof(filePath, invoiceHint || 'new');
    setProofUploading(false);
    if (res.ok) setProofUrl(res.data);
    else alert('Upload failed: ' + (res.error || 'unknown error'));
  }

  async function submit() {
    if (!selectedClientId) { setError('Select a client'); return; }

    // Auto-include pending item if user filled the form but didn't click +Add
    let finalItems = [...items];
    if (newItem.inventoryId && selectedInvItem && Number(newItem.qty) > 0) {
      finalItems = [...items, buildLineItem(selectedInvItem, newItem.qty, newItem.price, newItem.discount)];
    }

    if (finalItems.length === 0) { setError('Add at least one item to the invoice'); return; }

    setSaving(true); setError('');
    const fSub = finalItems.reduce((s, i) => s + i.LineTotal, 0);
    const fTotal = fSub - Number(overallDiscount);
    const sale = {
      ClientId: selectedClientId,
      ClientName: selectedClient?.Name || '',
      ClientPhone: selectedClient?.Phone || '',
      ClientEmail: selectedClient?.Email || '',
      Items: finalItems,
      Subtotal: fSub,
      OverallDiscount: Number(overallDiscount),
      TotalAmount: fTotal,
      PaidAmount: Number(paidAmount),
      Notes: notes,
      InitialPayment: Number(paidAmount) > 0 ? { PaymentType: payType, ReferenceId: payRef, ProofUrl: proofUrl } : null,
    };
    const res = await window.api.createSale(sale);
    if (res.ok) onSaved();
    else { setError(res.error || 'Failed to create sale'); setSaving(false); }
  }

  return (
    <Modal title="New Invoice" onClose={onClose} wide footer={
      <><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create Invoice'}</button></>
    }>
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* Client */}
      <div className="form-group">
        <label className="form-label">Client *</label>
        <select className="form-select" value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)}>
          <option value="">— Select client —</option>
          {clients.map((c) => <option key={c._id} value={c._id}>{c.ClientCode} — {c.Name}</option>)}
        </select>
      </div>

      {/* Add-item row */}
      <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
          Add Line Item <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>(fill and click + Add; repeat for multiple items)</span>
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 120px 110px auto', gap: 8, alignItems: 'end' }}>
          <div>
            <label className="form-label">Item</label>
            <select className="form-select" value={newItem.inventoryId} onChange={(e) => {
              const inv = inventory.find((i) => i._id === e.target.value);
              setNewItem({ ...newItem, inventoryId: e.target.value, price: inv?.SalePrice ?? '' });
            }}>
              <option value="">— Select item —</option>
              {inventory.map((i) => (
                <option key={i._id} value={i._id}>{i.ItemCode} — {i.StockName}{i.PlateSize ? ` (${i.PlateSize})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Qty</label>
            <input className="form-input" type="number" min="1" value={newItem.qty}
              onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Unit Price (PKR)</label>
            <input className="form-input" type="number" min="0" step="0.01" placeholder="0.00" value={newItem.price}
              onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} />
          </div>
          <div>
            <label className="form-label">Disc. Amount</label>
            <input className="form-input" type="number" min="0" step="0.01" placeholder="0.00" value={newItem.discount}
              onChange={(e) => setNewItem({ ...newItem, discount: e.target.value })} />
          </div>
          <button className="btn btn-primary" onClick={addItem} title="Add this item to the invoice">+ Add</button>
        </div>
        {selectedInvItem && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            Purchase price: PKR {selectedInvItem.PurchasePrice} · Stock: {selectedInvItem.CurrentStock} {selectedInvItem.Unit}
            {pendingLine && <span style={{ marginLeft: 12, color: 'var(--blue)' }}>→ Line total: {fmt(pendingLine.LineTotal)}</span>}
          </p>
        )}
      </div>

      {/* Items table — always visible */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '10px 14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Invoice Lines</span>
          <span className="badge badge-blue">{items.length} added</span>
        </div>
        <table className="items-table">
          <thead>
            <tr><th>Item</th><th>Size</th><th className="text-right">Qty</th><th className="text-right">Unit Price</th><th className="text-right">Discount</th><th className="text-right">Line Total</th><th></th></tr>
          </thead>
          <tbody>
            {items.length === 0 && !pendingLine && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: 12 }}>No items added yet — use the form above and click <strong>+ Add</strong></td></tr>
            )}
            {items.map((item, i) => (
              <tr key={i}>
                <td><strong>{item.ItemName}</strong></td>
                <td>{item.PlateSize || '—'}</td>
                <td className="text-right">{item.Quantity}</td>
                <td className="text-right">{fmt(item.UnitPrice)}</td>
                <td className="text-right">{fmt(item.DiscountAmount)}</td>
                <td className="text-right fw-bold">{fmt(item.LineTotal)}</td>
                <td><button className="btn-icon danger" style={{ fontSize: 11 }} onClick={() => removeItem(i)} title="Remove">✕</button></td>
              </tr>
            ))}
            {/* Ghost row — shows the pending (not yet added) item for reference */}
            {pendingLine && (
              <tr style={{ opacity: 0.55, fontStyle: 'italic', background: '#F0F7FF' }}>
                <td>{pendingLine.ItemName} <span style={{ fontSize: 10, color: 'var(--blue)' }}>(pending)</span></td>
                <td>{pendingLine.PlateSize || '—'}</td>
                <td className="text-right">{pendingLine.Quantity}</td>
                <td className="text-right">{fmt(pendingLine.UnitPrice)}</td>
                <td className="text-right">{fmt(pendingLine.DiscountAmount)}</td>
                <td className="text-right">{fmt(pendingLine.LineTotal)}</td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Totals + payment */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div className="form-group">
            <label className="form-label">Overall Discount (PKR)</label>
            <input className="form-input" type="number" min="0" step="0.01" value={overallDiscount}
              onChange={(e) => setOverallDiscount(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Amount Paid (PKR)</label>
            <input className="form-input" type="number" min="0" step="0.01" value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)} />
          </div>

          <div style={{ background: '#EFF6FF', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #BFDBFE' }}>
            <p style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: '#1E40AF' }}>Payment Method</p>
            {Number(paidAmount) <= 0 && (
              <p style={{ fontSize: 11, color: '#64748B', marginBottom: 8 }}>Enter an amount paid above to record this payment.</p>
            )}
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label className="form-label">Type</label>
              <select className="form-select" value={payType} disabled={Number(paidAmount) <= 0} onChange={(e) => { setPayType(e.target.value); setPayRef(''); setProofUrl(''); }}>
                <option value="Cash">Cash</option>
                <option value="Cheque">Cheque</option>
                <option value="Online">Online Transfer</option>
              </select>
            </div>
            {(payType === 'Cheque' || payType === 'Online') && Number(paidAmount) > 0 && (
              <>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label className="form-label">{payType === 'Cheque' ? 'Cheque No.' : 'Transaction ID'}</label>
                  <input className="form-input" placeholder={payType === 'Cheque' ? 'e.g. CHQ-00123' : 'e.g. TXN-9987654'} value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Proof Screenshot <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                  {proofUrl
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <a href={proofUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', fontSize: 12 }}>View uploaded proof</a>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setProofUrl('')}>Remove</button>
                      </div>
                    : <button type="button" className="btn btn-sm btn-secondary" onClick={() => uploadProof('new')} disabled={proofUploading}>
                        {proofUploading ? 'Uploading…' : '⬆ Upload Proof'}
                      </button>
                  }
                </div>
              </>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…" style={{ minHeight: 60 }} />
          </div>
        </div>
        <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 16 }}>
          <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Order Summary</p>
          {[
            ['Subtotal', subtotal],
            ['Overall Discount', Number(overallDiscount)],
            ['Total', totalAmt],
            ['Paid', Number(paidAmount)],
            ['Balance', balance],
            ['Est. Profit', totalProfit],
          ].map(([l, v]) => (
            <div key={l} style={{
              display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13,
              borderBottom: l === 'Total' ? '2px solid var(--border)' : 'none',
              fontWeight: ['Total', 'Balance', 'Est. Profit'].includes(l) ? 700 : 400,
              color: l === 'Balance' ? (balance > 0 ? 'var(--red)' : 'var(--green)')
                   : l === 'Est. Profit' ? 'var(--green)'
                   : 'var(--text-2)',
            }}>
              <span>{l}</span><span>{fmt(v)}</span>
            </div>
          ))}
          {pendingLine && (
            <p style={{ fontSize: 11, color: 'var(--blue)', marginTop: 8 }}>
              * Includes 1 pending item. Click <strong>+ Add</strong> to lock it in, or it will be auto-included on Create Invoice.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
