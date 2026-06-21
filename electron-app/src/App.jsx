import React, { useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import Clients from './pages/Clients.jsx';
import Sales from './pages/Sales.jsx';
import Purchases from './pages/Purchases.jsx';
import Suppliers from './pages/Suppliers.jsx';
import Settings from './pages/Settings.jsx';

const PAGES = { dashboard: Dashboard, inventory: Inventory, clients: Clients, sales: Sales, purchases: Purchases, suppliers: Suppliers, settings: Settings };

export default function App() {
  const [page, setPage] = useState('dashboard');
  const Page = PAGES[page] || Dashboard;
  return (
    <div className="app">
      <Sidebar current={page} onNavigate={setPage} />
      <div className="main-content">
        <Page />
      </div>
    </div>
  );
}
