import React, { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
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
import SuppliersPage from "./pages/SuppliersPage";
import SupplierDetailPage from "./pages/SupplierDetailPage";
import UsersPage from "./pages/UsersPage";
import { api } from "./lib/api";

function ProtectedShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [outletCode, setOutletCode] = useState("all");
  const [outlets, setOutlets] = useState([]);
  const [pendingPo, setPendingPo] = useState(0);
  const path = location.pathname;

  useEffect(() => {
    if (!user) return;
    api.get("/outlets").then((r) => setOutlets(r.data)).catch(() => {});
    api
      .get("/dashboard")
      .then((r) => setPendingPo(r.data.pending_po || 0))
      .catch(() => {});
  }, [user, path]);

  if (loading) {
    return (
      <div className="loading-state" data-testid="app-loading">
        Memuat LAGO BALI...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <Layout
      outletCode={outletCode}
      onOutletChange={setOutletCode}
      outlets={outlets}
      pendingPo={pendingPo}
    >
      <Routes>
        <Route path="/dashboard" element={<Dashboard onNavigateTo={() => {}} />} />
        <Route path="/inventory" element={<InventoryPage outlet={outletCode} />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/suppliers/:supplierId" element={<SupplierDetailPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/receiving" element={<ReceivingPage />} />
        <Route path="/issues" element={<IssuesPage />} />
        <Route path="/opname" element={<OpnamePage />} />
        <Route path="/hpp" element={<HPPPage />} />
        <Route path="/revenue" element={<RevenuePage />} />
        <Route path="/flash" element={<FlashCostPage />} />
        <Route
          path="/users"
          element={user.role === "admin" ? <UsersPage /> : <Navigate to="/dashboard" replace />}
        />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

function LoginRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading-state">Memuat...</div>;
  if (user) {
    const from = location.state?.from?.pathname || "/dashboard";
    return <Navigate to={from} replace />;
  }
  return <Login />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/*" element={<ProtectedShell />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
