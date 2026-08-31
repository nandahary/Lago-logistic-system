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
import COGSPage from "./pages/COGSPage";
import FlashCostPage from "./pages/FlashCostPage";
import RevenuePage from "./pages/RevenuePage";
import SuppliersPage from "./pages/SuppliersPage";
import SupplierDetailPage from "./pages/SupplierDetailPage";
import ReportsPage from "./pages/ReportsPage";
import UsersPage from "./pages/UsersPage";
import PurchaseRequestPage from "./pages/PurchaseRequestPage";
import { api } from "./lib/api";

function ProtectedShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [outletCode, setOutletCode] = useState("all");
  const [outlets, setOutlets] = useState([]);
  const [pendingPo, setPendingPo] = useState(0);
  const path = location.pathname;

  const isRequestor = user?.role === "requestor";
  // Requestor is scoped to the Purchase Request module only: no dashboard prefetch,
  // and any other route falls back to /purchase-requests (see `guard` below).
  const homePath = isRequestor ? "/purchase-requests" : "/dashboard";

  useEffect(() => {
    if (!user) return;
    api.get("/outlets").then((r) => setOutlets(r.data)).catch(() => {});
    if (user.role !== "requestor") {
      api
        .get("/dashboard")
        .then((r) => setPendingPo(r.data.pending_po || 0))
        .catch(() => {});
    }
  }, [user, path]);

  if (loading) {
    return (
      <div className="loading-state" data-testid="app-loading">
        Loading LAGO BALI...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Every module outside Purchase Requests is off-limits to the requestor role.
  const guard = (element) => (isRequestor ? <Navigate to={homePath} replace /> : element);

  return (
    <Layout
      outletCode={outletCode}
      onOutletChange={setOutletCode}
      outlets={outlets}
      pendingPo={pendingPo}
    >
      <Routes>
        <Route path="/dashboard" element={guard(<Dashboard onNavigateTo={() => {}} />)} />
        <Route path="/inventory" element={guard(<InventoryPage outlet={outletCode} />)} />
        <Route path="/suppliers" element={guard(<SuppliersPage />)} />
        <Route path="/suppliers/:supplierId" element={guard(<SupplierDetailPage />)} />
        <Route path="/purchase-requests" element={<PurchaseRequestPage />} />
        <Route path="/orders" element={guard(<OrdersPage />)} />
        <Route path="/receiving" element={guard(<ReceivingPage />)} />
        <Route path="/issues" element={guard(<IssuesPage />)} />
        <Route path="/opname" element={guard(<OpnamePage />)} />
        <Route path="/hpp" element={guard(<COGSPage />)} />
        <Route path="/revenue" element={guard(<RevenuePage />)} />
        <Route path="/flash" element={guard(<FlashCostPage />)} />
        <Route path="/reports" element={guard(<ReportsPage />)} />
        <Route
          path="/users"
          element={user.role === "admin" ? <UsersPage /> : <Navigate to={homePath} replace />}
        />
        <Route path="/" element={<Navigate to={homePath} replace />} />
        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Routes>
    </Layout>
  );
}

function LoginRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading-state">Loading...</div>;
  if (user) {
    const defaultHome = user.role === "requestor" ? "/purchase-requests" : "/dashboard";
    const from = location.state?.from?.pathname || defaultHome;
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
