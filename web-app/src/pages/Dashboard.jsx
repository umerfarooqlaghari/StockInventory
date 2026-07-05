import React, { useEffect, useState, useCallback } from 'react';
import StatusBadge from '../components/StatusBadge.jsx';

const fmt = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alerting, setAlerting] = useState(false);
  const [alertResult, setAlertResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.getDashboard();
    if (res.ok) setData(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runAlerts() {
    setAlerting(true);
    const res = await window.api.runAlerts();
    setAlertResult(res.ok ? res.data : { error: res.error });
    setAlerting(false);
    setTimeout(() => setAlertResult(null), 5000);
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  const d = data || {};

  const kpis = [
    { label: 'Total Sales', value: fmt(d.totalSales), color: '#EFF6FF', icon: '💰' },
    { label: 'Total Profit', value: fmt(d.totalProfit), color: '#DCFCE7', icon: '📈' },
    { label: 'Stock Value', value: fmt(d.stockValue), color: '#FEF3C7', icon: '📦' },
    { label: 'Outstanding', value: fmt(d.totalOutstanding), color: '#FEE2E2', icon: '⏳' },
  ];

  const kpis2 = [
    { label: 'Total Clients', value: d.totalClients || 0 },
    { label: 'Inventory Items', value: d.totalItems || 0 },
    { label: 'Total Stock (qty)', value: (d.totalStock || 0).toLocaleString() },
    { label: 'Low Stock Alerts', value: d.lowStockCount || 0, warn: true },
    { label: 'Overdue Invoices', value: d.overdueCount || 0, danger: true },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
        <div className="page-header-actions">
          {alertResult && (
            <span className={`notice ${alertResult.error ? 'notice-error' : 'notice-success'}`} style={{ fontSize: 12 }}>
              {alertResult.error ? `Error: ${alertResult.error}` : `Alerts: ${alertResult.sent}/${alertResult.processed} sent`}
            </span>
          )}
          <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={runAlerts} disabled={alerting}>
            {alerting ? '…' : '✉ Send Overdue Alerts'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Primary KPIs */}
        <div className="kpi-grid">
          {kpis.map((k) => (
            <div key={k.label} className="kpi-card">
              <div className="kpi-icon" style={{ background: k.color }}><span style={{ fontSize: 18 }}>{k.icon}</span></div>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value" style={{ fontSize: 20 }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Secondary KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 24 }}>
          {kpis2.map((k) => (
            <div key={k.label} className="card card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{k.label}</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: k.danger ? 'var(--red)' : k.warn ? 'var(--yellow)' : 'var(--text)' }}>
                {k.value}
              </span>
            </div>
          ))}
        </div>

        <div className="dash-grid-2">
          {/* Recent Sales */}
          <div className="card">
            <div className="card-body" style={{ padding: '18px 20px 0' }}>
              <p className="section-title">Recent Sales</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Invoice</th><th>Client</th><th>Date</th><th>Total</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {(d.recentSales || []).length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-muted" style={{ padding: 24 }}>No sales yet</td></tr>
                  ) : (d.recentSales || []).map((s) => (
                    <tr key={s._id}>
                      <td className="mono">{s.InvoiceNumber}</td>
                      <td>{s.ClientName}</td>
                      <td className="text-muted">{fmtDate(s.SaleDate)}</td>
                      <td className="fw-bold">{fmt(s.TotalAmount)}</td>
                      <td><StatusBadge status={s.PaymentStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Low Stock */}
          <div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-body" style={{ padding: '18px 20px 0' }}>
                <p className="section-title">Low Stock Items</p>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Item</th><th>Size</th><th>Stock</th><th>Reorder</th></tr></thead>
                  <tbody>
                    {(d.lowStockItems || []).length === 0 ? (
                      <tr><td colSpan={4} className="text-center text-muted" style={{ padding: 24 }}>All items well-stocked ✓</td></tr>
                    ) : (d.lowStockItems || []).map((item) => (
                      <tr key={item._id} className="low-stock">
                        <td><strong>{item.StockName}</strong><br /><span className="text-muted" style={{ fontSize: 11 }}>{item.ItemCode}</span></td>
                        <td>{item.PlateSize || '—'}</td>
                        <td><span className="badge badge-red">{item.CurrentStock} {item.Unit}</span></td>
                        <td className="text-muted">{item.ReorderLevel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Overdue */}
            <div className="card">
              <div className="card-body" style={{ padding: '18px 20px 0' }}>
                <p className="section-title">Overdue Invoices (45+ days)</p>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Invoice</th><th>Client</th><th>Balance</th><th>Days</th></tr></thead>
                  <tbody>
                    {(d.overdueSales || []).length === 0 ? (
                      <tr><td colSpan={4} className="text-center text-muted" style={{ padding: 24 }}>No overdue invoices ✓</td></tr>
                    ) : (d.overdueSales || []).map((s) => {
                      const days = Math.floor((Date.now() - new Date(s.SaleDate).getTime()) / 86400000);
                      return (
                        <tr key={s._id}>
                          <td className="mono">{s.InvoiceNumber}</td>
                          <td>{s.ClientName}</td>
                          <td className="text-danger fw-bold">{fmt(s.Balance)}</td>
                          <td><span className="badge badge-red">{days}d</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
