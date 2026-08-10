import React, { useState } from 'react';
import Auth from './pages/Auth.jsx';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import Clients from './pages/Clients.jsx';
import Sales from './pages/Sales.jsx';
import Purchases from './pages/Purchases.jsx';
import Suppliers from './pages/Suppliers.jsx';
import MasterData from './pages/MasterData.jsx';
import Settings from './pages/Settings.jsx';

const PAGES = {
  dashboard: Dashboard,
  inventory: Inventory,
  masterdata: MasterData,
  clients: Clients,
  sales: Sales,
  purchases: Purchases,
  suppliers: Suppliers,
  settings: Settings,
};

export default function App() {
  const [auth, setAuth] = useState(null); // null = not authenticated
  const [page, setPage] = useState('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!auth) {
    return <Auth onAuthenticated={setAuth} />;
  }

  const Page = PAGES[page] || Dashboard;
  return (
    <div className="app">
      {/* Mobile top navigation bar */}
      <div className="mobile-navbar">
        <button
          className="mobile-hamburger"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          ☰
        </button>
        <span className="mobile-brand-title">Stock Inventory</span>
      </div>

      <Sidebar
        current={page}
        onNavigate={setPage}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onLogout={() => {
          window.api.logout();
          setAuth(null);
        }}
      />

      <div className="main-content">
        <Page />
      </div>
    </div>
  );
}
