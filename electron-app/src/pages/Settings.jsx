import React, { useEffect, useState } from 'react';

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [importFile, setImportFile] = useState('');
  const [importType, setImportType] = useState('Inventory');
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState(null);

  useEffect(() => {
    window.api.getConfig().then((r) => { if (r.ok) setConfig(r.data); });
  }, []);

  async function save() {
    setSaving(true); setError(''); setSaved(false);
    // Parse numeric fields before persisting (allows free-typing in fields)
    const toSave = {
      ...config,
      CreditDays:       parseInt(config.CreditDays)       || 45,
      AlertDays:        parseInt(config.AlertDays)         || 48,
      TaxRate:          parseFloat(config.TaxRate)         || 0,
      LowStockThreshold: parseInt(config.LowStockThreshold) || 10,
    };
    const res = await window.api.saveConfig(toSave);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
    else setError(res.error || 'Failed to save');
    setSaving(false);
  }

  async function browseFile() {
    const fp = await window.api.openFileDialog({ filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }], properties: ['openFile'] });
    if (fp) setImportFile(fp);
  }

  async function runImport() {
    if (!importFile) { setError('Choose a file first'); return; }
    setImporting(true); setError(''); setImportResult(null);
    let res;
    if (importType === 'Inventory') {
      res = await window.api.importInventoryExcel(importFile);
    } else {
      res = await window.api.importClientsExcel(importFile);
    }
    if (res.ok) setImportResult(res.data);
    else setError(res.error || 'Import failed');
    setImporting(false);
  }

  async function populateDefaultTemplate() {
    const res = await window.api.getDefaultEmailTemplate();
    if (res.ok) {
      setConfig({ ...config, EmailSubjectTemplate: res.data.subject, EmailBodyTemplate: res.data.body });
    }
  }

  async function sendTestEmail() {
    if (!testEmail.trim()) return;
    setTestEmailSending(true); setTestEmailResult(null);
    const res = await window.api.sendTestEmail(testEmail.trim());
    setTestEmailResult(res.ok && res.data?.sent ? 'success' : 'error');
    setTestEmailSending(false);
  }

  if (!config) return <div className="loading-center"><div className="spinner" /></div>;

  const set = (key, val) => setConfig({ ...config, [key]: val });

  return (
    <>
      <div className="page-header">
        <h1>Settings & Configuration</h1>
        <div className="page-header-actions">
          {saved && <span className="notice notice-success" style={{ fontSize: 12 }}>✓ Settings saved</span>}
          {error && <span className="notice notice-error" style={{ fontSize: 12 }}>{error}</span>}
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</button>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Company */}
          <div className="card card-body">
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Company Information</h3>
            <div className="form-group"><label className="form-label">Company Name</label><input className="form-input" value={config.CompanyName || ''} onChange={(e) => set('CompanyName', e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Phone Number</label><input className="form-input" value={config.CompanyPhone || ''} onChange={(e) => set('CompanyPhone', e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Address</label><textarea className="form-textarea" value={config.CompanyAddress || ''} onChange={(e) => set('CompanyAddress', e.target.value)} /></div>
          </div>

          {/* Credit Rules */}
          <div className="card card-body">
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Credit & Financial Rules</h3>
            <div className="form-row form-row-2">
              <div className="form-group">
                <label className="form-label">Credit Period (Days)</label>
                <input className="form-input" type="number" min="1" value={config.CreditDays ?? 45} onChange={(e) => set('CreditDays', e.target.value)} />
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Invoices become overdue after this many days</p>
              </div>
              <div className="form-group">
                <label className="form-label">Alert Trigger (Days)</label>
                <input className="form-input" type="number" min="1" value={config.AlertDays ?? 48} onChange={(e) => set('AlertDays', e.target.value)} />
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Email alerts sent on this day (e.g. 48)</p>
              </div>
            </div>
            <div className="form-row form-row-2">
              <div className="form-group">
                <label className="form-label">Tax Rate (%)</label>
                <input className="form-input" type="number" min="0" max="100" step="0.1" value={config.TaxRate ?? 0} onChange={(e) => set('TaxRate', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Low Stock Alert Level</label>
                <input className="form-input" type="number" min="0" value={config.LowStockThreshold ?? 10} onChange={(e) => set('LowStockThreshold', e.target.value)} />
              </div>
            </div>
            {config.CreditDays && config.AlertDays && (
              <div className="notice notice-info" style={{ fontSize: 12 }}>
                Credit cycle: {config.CreditDays} days · Alerts fire at: {config.AlertDays} days
              </div>
            )}
          </div>

          {/* Email Template */}
          <div className="card card-body" style={{ gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <h3 style={{ fontWeight: 700, fontSize: 14 }}>Email Alert Template</h3>
              <button
                className="btn btn-secondary btn-sm"
                onClick={populateDefaultTemplate}
                title="Auto-fill subject and body with a professional payment reminder template"
              >
                ✨ Populate Professional Template
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Click <strong>Populate Professional Template</strong> to auto-fill a ready-to-send email. Available placeholders:&nbsp;
              {['{ClientName}','{InvoiceNumber}','{SaleDate}','{Amount}','{Balance}','{Days}','{CompanyName}'].map((p) => (
                <code key={p} style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, marginRight: 4, fontSize: 11 }}>{p}</code>
              ))}
            </p>
            <div className="form-group">
              <label className="form-label">Email Subject</label>
              <input className="form-input" value={config.EmailSubjectTemplate || ''} onChange={(e) => set('EmailSubjectTemplate', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Email Body (plain-text — a rich HTML version is also sent automatically)</label>
              <textarea className="form-textarea" style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12 }} value={config.EmailBodyTemplate || ''} onChange={(e) => set('EmailBodyTemplate', e.target.value)} />
            </div>

            {/* Test email */}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
              <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Send a Test Email</p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 480 }}>
                <input
                  className="form-input"
                  type="email"
                  placeholder="your@email.com"
                  value={testEmail}
                  onChange={(e) => { setTestEmail(e.target.value); setTestEmailResult(null); }}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={sendTestEmail}
                  disabled={testEmailSending || !testEmail.trim()}
                >
                  {testEmailSending ? 'Sending…' : 'Send Test'}
                </button>
              </div>
              {testEmailResult === 'success' && (
                <div className="notice notice-success" style={{ marginTop: 8, fontSize: 12 }}>✓ Test email sent successfully to {testEmail}</div>
              )}
              {testEmailResult === 'error' && (
                <div className="notice notice-error" style={{ marginTop: 8, fontSize: 12 }}>✗ Failed to send. Check your SES configuration and that the email address is verified.</div>
              )}
            </div>
          </div>

          {/* Plate Sizes */}
          <div className="card card-body">
            <h3 style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Plate Sizes List</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              Manage the standard sizes shown as suggestions when adding inventory items.
            </p>
            <PlateSizeManager
              sizes={config.PlateSizes || []}
              onChange={(sizes) => set('PlateSizes', sizes)}
            />
          </div>

          {/* Excel Import */}
          <div className="card card-body" style={{ gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
              <h3 style={{ fontWeight: 700, fontSize: 14 }}>Data Migration — Excel Import</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => window.api.downloadInventoryTemplate()}>
                  ⬇ Inventory Template
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => window.api.downloadClientsTemplate()}>
                  ⬇ Clients Template
                </button>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              Download a template file, fill it in, then import. Your existing <code>printing_plates_inventory.xlsx</code> can also be imported directly if columns match.
            </p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">Excel File</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="form-input" readOnly value={importFile} placeholder="No file selected…" style={{ flex: 1 }} />
                  <button className="btn btn-secondary" onClick={browseFile}>Browse File</button>
                </div>
              </div>
              <div className="form-group" style={{ width: 160, marginBottom: 0 }}>
                <label className="form-label">Data Type</label>
                <select className="form-select" value={importType} onChange={(e) => setImportType(e.target.value)}>
                  <option>Inventory</option>
                  <option>Clients</option>
                </select>
              </div>
              <button className="btn btn-primary" onClick={runImport} disabled={importing || !importFile}>
                {importing ? 'Importing…' : 'Import Now'}
              </button>
            </div>
            {importResult && (
              <div className={`notice ${importResult.errors?.length ? 'notice-warning' : 'notice-success'}`} style={{ marginTop: 12 }}>
                ✓ {importResult.success} records imported.
                {importResult.errors?.length > 0 && (
                  <span style={{ marginLeft: 8 }}>{importResult.errors.length} errors: {importResult.errors.slice(0, 3).join('; ')}</span>
                )}
              </div>
            )}
            <div className="notice notice-info" style={{ marginTop: 12, fontSize: 12 }}>
              <strong>Inventory template columns:</strong> ItemCode · StockName · PlateSize · Category · SupplierName · PurchasePrice · SalePrice · CurrentStock · ReorderLevel · Unit<br />
              <strong>Clients template columns:</strong> ClientCode · Name · Phone · Email · Address · Notes
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function PlateSizeManager({ sizes, onChange }) {
  const [newSize, setNewSize] = useState('');
  function add() {
    const v = newSize.trim();
    if (!v || sizes.includes(v)) return;
    onChange([...sizes, v]);
    setNewSize('');
  }
  function remove(s) { onChange(sizes.filter((x) => x !== s)); }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {sizes.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No sizes defined</span>}
        {sizes.map((s) => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 600 }}>
            {s}
            <button onClick={() => remove(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, maxWidth: 300 }}>
        <input
          className="form-input"
          placeholder="e.g. 25x38"
          value={newSize}
          onChange={(e) => setNewSize(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          style={{ flex: 1 }}
        />
        <button className="btn btn-secondary btn-sm" onClick={add}>+ Add</button>
      </div>
    </div>
  );
}
