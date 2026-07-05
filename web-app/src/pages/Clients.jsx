import React, { useEffect, useState, useCallback } from 'react';
import Modal from '../components/Modal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const EMPTY = { Name: '', Phone: '', Email: '', Address: '', Notes: '' };
const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ledger, setLedger] = useState(null); // { client, sales }

  const load = useCallback(async (q) => {
    setLoading(true);
    const res = await window.api.getClients(q || '');
    if (res.ok) setClients(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(''); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(search), 350); return () => clearTimeout(t); }, [search, load]);

  function openAdd() { setForm({ ...EMPTY }); setEditId(null); setError(''); }
  function openEdit(c) { setForm({ ...c }); setEditId(c._id?.toString()); setError(''); }

  async function save() {
    if (!form.Name?.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    const payload = { ...form, _id: editId };
    const res = editId ? await window.api.updateClient(payload) : await window.api.createClient(payload);
    if (res.ok) { setForm(null); load(search); }
    else setError(res.error || 'Save failed');
    setSaving(false);
  }

  async function remove(c) {
    if (!confirm(`Delete client "${c.Name}"? This does not delete their sales.`)) return;
    await window.api.deleteClient(c._id?.toString());
    load(search);
  }

  async function viewLedger(c) {
    const res = await window.api.getClientLedger(c._id?.toString());
    setLedger({ client: c, sales: res.ok ? res.data : [] });
  }

  return (
    <>
      <div className="page-header">
        <h1>Client Management</h1>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openAdd}>+ Add Client</button>
        </div>
      </div>

      <div className="page-body">
        <div className="toolbar">
          <div className="search-bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="form-input" placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
          </div>
          <span className="text-muted" style={{ fontSize: 12 }}>{clients.length} clients</span>
        </div>

        <div className="card">
          <div className="table-wrap">
            {loading ? <div className="loading-center"><div className="spinner" /></div> : clients.length === 0 ? (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                <p>No clients found</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr><th>Code</th><th>Name</th><th>Phone</th><th>Email</th><th>Total Sales</th><th>Paid</th><th>Outstanding</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c._id}>
                      <td className="mono">{c.ClientCode}</td>
                      <td><strong>{c.Name}</strong>{c.Address && <><br /><span className="text-muted" style={{ fontSize: 11 }}>{c.Address}</span></>}</td>
                      <td>{c.Phone || '—'}</td>
                      <td>{c.Email || '—'}</td>
                      <td className="fw-bold">{fmt(c.TotalSales)}</td>
                      <td className="text-success">{fmt(c.TotalPaid)}</td>
                      <td><span className={c.OutstandingBalance > 0 ? 'text-danger fw-bold' : 'text-muted'}>{fmt(c.OutstandingBalance)}</span></td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-secondary btn-sm" onClick={() => viewLedger(c)}>Ledger</button>
                          <button className="btn-icon" onClick={() => openEdit(c)}>✏</button>
                          <button className="btn-icon danger" onClick={() => remove(c)}>🗑</button>
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

      {/* Add/Edit Modal */}
      {form && (
        <Modal title={editId ? 'Edit Client' : 'Add Client'} onClose={() => setForm(null)} footer={
          <><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Client'}</button></>
        }>
          {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.Name} onChange={(e) => setForm({ ...form, Name: e.target.value })} placeholder="Full name" /></div>
          <div className="form-row form-row-2">
            <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={form.Phone} onChange={(e) => setForm({ ...form, Phone: e.target.value })} placeholder="+92 300 0000000" /></div>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={form.Email} onChange={(e) => setForm({ ...form, Email: e.target.value })} placeholder="client@email.com" /></div>
          </div>
          <div className="form-group"><label className="form-label">Address</label><textarea className="form-textarea" value={form.Address} onChange={(e) => setForm({ ...form, Address: e.target.value })} placeholder="Full address" style={{ minHeight: 60 }} /></div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={form.Notes} onChange={(e) => setForm({ ...form, Notes: e.target.value })} placeholder="Additional notes…" style={{ minHeight: 60 }} /></div>
        </Modal>
      )}

      {/* Ledger Modal */}
      {ledger && (
        <Modal title={`Ledger — ${ledger.client.Name}`} onClose={() => setLedger(null)} wide footer={
          <button className="btn btn-secondary" onClick={() => setLedger(null)}>Close</button>
        }>
          <div className="ledger-summary">
            <div className="ledger-card"><label>Total Sales</label><span>{fmt(ledger.client.TotalSales)}</span></div>
            <div className="ledger-card"><label>Total Paid</label><span style={{ color: 'var(--green)' }}>{fmt(ledger.client.TotalPaid)}</span></div>
            <div className="ledger-card"><label>Outstanding</label><span style={{ color: ledger.client.OutstandingBalance > 0 ? 'var(--red)' : 'var(--text)' }}>{fmt(ledger.client.OutstandingBalance)}</span></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
              <tbody>
                {ledger.sales.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-muted" style={{ padding: 24 }}>No transactions</td></tr>
                ) : ledger.sales.map((s) => (
                  <tr key={s._id}>
                    <td className="mono">{s.InvoiceNumber}</td>
                    <td className="text-muted">{fmtDate(s.SaleDate)}</td>
                    <td className="fw-bold">{fmt(s.TotalAmount)}</td>
                    <td className="text-success">{fmt(s.PaidAmount)}</td>
                    <td className={s.Balance > 0 ? 'text-danger fw-bold' : ''}>{fmt(s.Balance)}</td>
                    <td><StatusBadge status={s.PaymentStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}
