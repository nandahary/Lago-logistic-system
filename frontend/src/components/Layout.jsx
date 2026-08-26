import React from "react";
import { useAuth } from "../context/AuthContext";
import { roleLabels } from "../lib/format";
import { Bell, Menu, LogOut, X, LayoutDashboard, Box, ShoppingCart, Truck, ChevronRight, ClipboardCheck, Calculator, Flame, Coins } from "lucide-react";

export const NAV = [
  ["dashboard", "Ringkasan", LayoutDashboard],
  ["inventory", "Master barang", Box],
  ["orders", "Purchase order", ShoppingCart],
  ["receiving", "Penerimaan", Truck],
  ["issues", "Barang keluar", ChevronRight],
  ["opname", "Stock opname", ClipboardCheck],
  ["hpp", "HPP & resep", Calculator],
  ["revenue", "Revenue harian", Coins],
  ["flash", "Flash cost", Flame],
];

export default function Layout({
  active,
  onNavigate,
  outletCode,
  onOutletChange,
  outlets,
  pendingPo,
  children,
}) {
  const { user, logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const title = NAV.find((n) => n[0] === active)?.[1] || "Ringkasan";
  const initials = (user?.name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "mobile-open" : ""}`} data-testid="app-sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <strong>LAGO BALI</strong>
            <span>Inventory · F&B OS</span>
          </div>
          <button
            data-testid="mobile-close-button"
            className="icon-button mobile-close"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="nav-label">Workspace</div>
        <nav>
          {NAV.map(([id, label, Icon]) => (
            <button
              data-testid={`nav-${id}`}
              key={id}
              className={active === id ? "nav-item active" : "nav-item"}
              onClick={() => {
                onNavigate(id);
                setOpen(false);
              }}
            >
              <Icon size={17} />
              <span>{label}</span>
              {id === "orders" && pendingPo > 0 && <em>{pendingPo}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div>
            <div className="live-dot" /> Tersambung
            <span>User: {user?.name}</span>
          </div>
          <button
            data-testid="logout-button"
            className="chip small"
            onClick={logout}
            style={{ marginTop: 12 }}
          >
            <LogOut size={12} /> Keluar
          </button>
          <div className="credit">Dibuat oleh <strong>NANDA HARY</strong></div>
        </div>
      </aside>
      {open && (
        <button
          data-testid="mobile-menu-overlay"
          className="mobile-overlay"
          onClick={() => setOpen(false)}
          aria-label="Tutup menu"
        />
      )}
      <main className="main">
        <header className="topbar">
          <button
            data-testid="mobile-menu-button"
            className="mobile-menu"
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="crumb">
            <span>Lago Bali</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <label className="select-wrap">
              <span>Outlet</span>
              <select
                data-testid="outlet-selector"
                value={outletCode}
                onChange={(e) => onOutletChange(e.target.value)}
              >
                <option value="all">Semua outlet</option>
                {outlets.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-wrap role-select">
              <span>Role</span>
              <strong data-testid="current-role">
                {roleLabels[user?.role] || user?.role}
              </strong>
            </label>
            <button data-testid="notifications-button" className="icon-button notification">
              <Bell size={18} />
              <i />
            </button>
            <div className="avatar" data-testid="current-user-avatar" title={user?.email}>
              {initials}
            </div>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
