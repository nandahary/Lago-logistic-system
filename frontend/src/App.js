import React, { useEffect, useState } from "react";
import { Toaster } from "sonner";
import "./App.css";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import InventoryPage from "./pages/InventoryPage";
import OrdersPage from "./pages/OrdersPage";
import ReceivingPage from "./pages/ReceivingPage";
import IssuesPage from "./pages/IssuesPage";
import OpnamePage from "./pages/OpnamePage";
import HPPPage from "./pages/HPPPage";
import FlashCostPage from "./pages/FlashCostPage";
import RevenuePage from "./pages/RevenuePage";
import { api } from "./lib/api";

function Shell() {
  const [active, setActive] = useState("dashboard");
  const [outletCode, setOutletCode] = useState("all");
  const [outlets, setOutlets] = useState([]);
  const [dashSummary, setDashSummary] = useState({ pending_po: 0 });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    api.get("/outlets").then((r) => setOutlets(r.data)).catch(() => {});
    api.get("/dashboard").then((r) => setDashSummary(r.data)).catch(() => {});
  }, [reloadKey, active]);

  const bumpRefresh = () => setReloadKey((k) => k + 1);

  return (
    <Layout
      active={active}
      onNavigate={(id) => {
        setActive(id);
        bumpRefresh();
      }}
      outletCode={outletCode}
      onOutletChange={setOutletCode}
      outlets={outlets}
      pendingPo={dashSummary.pending_po}
    >
      {active === "dashboard" && (
        <Dashboard onNavigate={setActive} onAddItem={() => setActive("inventory")} />
      )}
      {active === "inventory" && <InventoryPage outlet={outletCode} />}
      {active === "orders" && <OrdersPage />}
      {active === "receiving" && <ReceivingPage />}
      {active === "issues" && <IssuesPage />}
      {active === "opname" && <OpnamePage />}
      {active === "hpp" && <HPPPage />}
      {active === "revenue" && <RevenuePage />}
      {active === "flash" && <FlashCostPage />}
    </Layout>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="loading-state" data-testid="app-loading">
        Memuat HINTO...
      </div>
    );
  }
  return user ? <Shell /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" richColors />
      <Gate />
    </AuthProvider>
  );
}
