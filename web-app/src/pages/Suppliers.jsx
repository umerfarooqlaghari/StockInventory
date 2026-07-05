import React, { useEffect, useState, useCallback } from 'react';
import Modal from '../components/Modal.jsx';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [editing, setEditing]     = useState(null);   // null = closed, {} = new, obj = edit
  const [deleting, setDeleting]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.getSuppliers(search);
    if (res.ok) setSuppliers(res.data);
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(s) {
    setDeleting(s);
  }

  async function confirmDelete() {
    if (!deleting) return;
    await window.api.deleteSupplier(deleting._id?.toString());
    setDeleting(null);
    load();
  }

  return (
    <>
      <div className="page-header">
        <h1>Suppliers</h1>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => setEditing({})}>+ New Supplier</button>
        </div>
      </div>

      <div className="page-body">
        {/* Search */}
        <div style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
          <input
            className="form-input"
            style={{ maxWidth: 320 }}
            placeholder="Search by name, contact, phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="btn btn-secondary" onClick={() => setSearch('')}>Clear</button>
          )}
        </div>

        <div className="card">
          <div className="table-wrap">
            {loading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : suppliers.length === 0 ? (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                <p>{search ? 'No suppliers match your search' : 'No suppliers yet'}</p>
                {!search && (
                  <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => setEditing({})}>Add First Supplier</button>
                )}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Contact Person</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>City</th>
                    <th>Added</th>
                    <th>Notes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s._id}>
                      <td className="mono">{s.SupplierCode}</td>
                      <td><strong>{s.Name}</strong></td>
                      <td>{s.ContactPerson || '—'}</td>
                      <td>{s.Phone || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.Email || '—'}</td>
                      <td>{s.City || '—'}</td>
                      <td className="text-muted">{fmtDate(s.CreatedAt)}</td>
                      <td
                        className="text-muted"
                        style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={s.Notes}
                      >
                        {s.Notes || '—'}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(s)}>Edit</button>
                          <button className="btn-icon danger" onClick={() => handleDelete(s)}>🗑</button>
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

      {/* Add / Edit modal */}
      {editing !== null && (
        <SupplierModal
          supplier={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {/* Delete confirm */}
      {deleting && (
        <Modal
          title="Delete Supplier"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDelete}>Delete</button>
            </>
          }
        >
          <p>Delete <strong>{deleting.Name}</strong>? This cannot be undone.</p>
        </Modal>
      )}
    </>
  );
}

function SupplierModal({ supplier, onClose, onSaved }) {
  const isNew = !supplier._id;
  const [form, setForm] = useState({
    Name: supplier.Name || '',
    ContactPerson: supplier.ContactPerson || '',
    Phone: supplier.Phone || '',
    Email: supplier.Email || '',
    Address: supplier.Address || '',
    City: supplier.City || '',
    Notes: supplier.Notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function set(field, val) { setForm((f) => ({ ...f, [field]: val })); }

  async function submit() {
    if (!form.Name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    const payload = { ...form };
    if (!isNew) payload._id = supplier._id;
    const res = isNew
      ? await window.api.createSupplier(payload)
      : await window.api.updateSupplier(payload);
    if (res.ok) onSaved();
    else { setError(res.error || 'Failed to save'); setSaving(false); }
  }

  return (
    <Modal
      title={isNew ? 'New Supplier' : `Edit — ${supplier.Name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Add Supplier' : 'Save Changes'}
          </button>
        </>
      }
    >
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="form-row form-row-2" style={{ marginBottom: 14 }}>
        <div className="form-group">
          <label className="form-label">Supplier Name *</label>
          <input className="form-input" value={form.Name} onChange={(e) => set('Name', e.target.value)} placeholder="e.g. Al-Ameen Printing Supplies" />
        </div>
        <div className="form-group">
          <label className="form-label">Contact Person</label>
          <input className="form-input" value={form.ContactPerson} onChange={(e) => set('ContactPerson', e.target.value)} placeholder="Primary contact name" />
        </div>
      </div>

      <div className="form-row form-row-2" style={{ marginBottom: 14 }}>
        <div className="form-group">
          <label className="form-label">Phone</label>
          <input className="form-input" value={form.Phone} onChange={(e) => set('Phone', e.target.value)} placeholder="+92 300 0000000" />
        </div>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={form.Email} onChange={(e) => set('Email', e.target.value)} placeholder="supplier@example.com" />
        </div>
      </div>

      <div className="form-row form-row-2" style={{ marginBottom: 14 }}>
        <div className="form-group">
          <label className="form-label">City</label>
          <input className="form-input" value={form.City} onChange={(e) => set('City', e.target.value)} placeholder="e.g. Lahore" />
        </div>
        <div className="form-group">
          <label className="form-label">Address</label>
          <input className="form-input" value={form.Address} onChange={(e) => set('Address', e.target.value)} placeholder="Street / Area" />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Notes</label>
        <textarea
          className="form-input"
          rows={3}
          value={form.Notes}
          onChange={(e) => set('Notes', e.target.value)}
          placeholder="Payment terms, lead time, preferred items…"
          style={{ resize: 'vertical' }}
        />
      </div>
    </Modal>
  );
}
