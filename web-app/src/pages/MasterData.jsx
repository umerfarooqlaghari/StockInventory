import React, { useEffect, useState, useCallback } from 'react';
import Modal from '../components/Modal.jsx';

const TABS = [
  { id: 'category', label: 'Categories', addLabel: 'Category', empty: 'No categories yet' },
  { id: 'size', label: 'Sizes', addLabel: 'Size', empty: 'No sizes yet' },
  { id: 'stock_name', label: 'Stock Names', addLabel: 'Stock Name', empty: 'No stock names yet' },
];

export default function MasterData() {
  const [tab, setTab] = useState('category');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.getMasterData(tab);
    if (res.ok) setItems(res.data);
    setLoading(false);
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const tabMeta = TABS.find((t) => t.id === tab);

  return (
    <>
      <div className="page-header">
        <h1>Master Data</h1>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={() => { setEditing({ Name: '' }); setError(''); }}>
            + Add {tabMeta?.addLabel || 'Entry'}
          </button>
        </div>
      </div>

      <div className="page-body">
        <p className="text-muted" style={{ marginBottom: 16, fontSize: 13 }}>
          Manage categories, plate sizes, and stock names. These appear as dropdown options when adding inventory items.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`btn ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="card">
          <div className="table-wrap">
            {loading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : items.length === 0 ? (
              <div className="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 6h16M4 12h16M4 18h10"/>
                </svg>
                <p>{tabMeta?.empty}</p>
                <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => { setEditing({ Name: '' }); setError(''); }}>
                  Add First Entry
                </button>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Last Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item._id}>
                      <td className="text-muted">{idx + 1}</td>
                      <td><strong>{item.Name}</strong></td>
                      <td className="text-muted">
                        {item.UpdatedAt ? new Date(item.UpdatedAt).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(item); setError(''); }}>Edit</button>
                          <button className="btn-icon danger" onClick={() => setDeleting(item)}>🗑</button>
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

      {editing !== null && (
        <EntryModal
          tab={tab}
          tabLabel={tabMeta?.addLabel || 'Entry'}
          entry={editing}
          error={error}
          onClose={() => setEditing(null)}
          onSave={async (name) => {
            setError('');
            const payload = editing._id
              ? { _id: editing._id, Name: name }
              : { Type: tab, Name: name };
            const res = editing._id
              ? await window.api.updateMasterData(payload)
              : await window.api.createMasterData(payload);
            if (res.ok) { setEditing(null); load(); }
            else setError(res.error || 'Save failed');
          }}
        />
      )}

      {deleting && (
        <Modal
          title="Delete Entry"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDeleting(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={async () => {
                await window.api.deleteMasterData(deleting._id?.toString() || deleting._id);
                setDeleting(null);
                load();
              }}>Delete</button>
            </>
          }
        >
          <p>Delete <strong>{deleting.Name}</strong>? Existing inventory records keep their current values.</p>
        </Modal>
      )}
    </>
  );
}

function EntryModal({ tab, tabLabel, entry, error, onClose, onSave }) {
  const [name, setName] = useState(entry.Name || '');
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(entry._id);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onSave(name.trim());
    setSaving(false);
  }

  return (
    <Modal
      title={isEdit ? `Edit ${tabLabel}` : `Add ${tabLabel}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add'}
          </button>
        </>
      }
    >
      {error && <div className="notice notice-error" style={{ marginBottom: 12 }}>{error}</div>}
      <form onSubmit={submit}>
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input
            className="form-input"
            autoFocus
            placeholder={
              tab === 'size' ? 'e.g. 25x35'
                : tab === 'category' ? 'e.g. Aluminum'
                  : 'e.g. Aluminum Plate'
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  );
}
