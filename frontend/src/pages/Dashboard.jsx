import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { money, formatDate, outletNames } from "../lib/format";
import { PageIntro, PanelHead, Badge } from "../components/UI";
import {
  BarChart3, ChevronRight, Truck, ClipboardCheck, Plus, TrendingUp, TrendingDown,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";

const PIE_COLORS = ["#167a6c", "#d9a86c", "#426b91", "#25815a", "#b87418", "#7a5cff", "#c75c48", "#5c9db5"];

function Metric({ label, value, note, tone, testid, trend }) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : null;
  return (
    <div className="metric" data-testid={testid}>
      <div className={`metric-icon ${tone}`}>
        <BarChart3 size={17} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={tone}>
        {TrendIcon && <TrendIcon size={11} style={{ verticalAlign: "middle", marginRight: 3 }} />}
        {note}
      </small>
    </div>
  );
}

const iconFor = (t) => (t === "receiving" ? Truck : t === "opname" ? ClipboardCheck : ChevronRight);

const compactMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)}K`;
  return `Rp${n}`;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [ana, setAna] = useState(null);

  useEffect(() => {
    api.get("/dashboard").then((r) => setData(r.data));
    api.get("/analytics", { params: { days: 7 } }).then((r) => setAna(r.data));
  }, []);

  if (!data || !ana) return <div className="loading-state">Loading...</div>;

  const trendData = ana.trend.map((t) => ({
    ...t,
    label: new Date(t.date).toLocaleDateString("en-US", { day: "2-digit", month: "short" }),
  }));
  const topConsumed = ana.top_consumed.map((t) => ({
    ...t,
    name: t.name.length > 22 ? t.name.slice(0, 20) + "…" : t.name,
  }));

  return (
    <>
      <PageIntro
        eyebrow={`${new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · Lago Bali`}
        title="Inventory control, no guesswork."
        subtitle="One view for stock, purchasing, and cost control across all outlets."
        testid="dashboard-title"
        action={
          <button
            data-testid="dashboard-primary-action"
            className="primary-button"
            onClick={() => navigate("/inventory")}
          >
            <Plus size={17} /> Add item
          </button>
        }
      />
      <div className="metric-grid">
        <Metric label="Inventory valuation" value={money(data.valuation)} note="Total system stock value" tone="teal" testid="metric-valuation" />
        <Metric label="Low stock" value={`${data.low_stock_count} items`} note="Below minimum stock level" tone="amber" testid="metric-low-stock" />
        <Metric label="PO awaiting" value={`${data.pending_po} PO`} note="Awaiting Finance approval" tone="blue" testid="metric-pending-po" />
        <Metric label="Flash cost today" value={`${data.flash_cost_pct}%`} note="Consumption vs revenue" tone="green" testid="metric-flash-cost" />
      </div>

      {/* Analytics row 1: trend + top consumed */}
      <div className="analytics-grid">
        <section className="panel" data-testid="analytics-trend">
          <PanelHead
            title="7-day flash cost trend"
            detail={`PO spend ${compactMoney(ana.procurement.po_total)} · GRN ${compactMoney(ana.procurement.grn_total)}`}
          />
          <div className="chart-body">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="costFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#167a6c" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#167a6c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1ee" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#73807b" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compactMoney} tick={{ fontSize: 11, fill: "#73807b" }} axisLine={false} tickLine={false} width={65} />
                <Tooltip
                  formatter={(v, k) => (k === "percentage" ? `${v}%` : money(v))}
                  labelStyle={{ fontSize: 12, fontWeight: 600 }}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e4e9e5", fontSize: 11 }}
                />
                <Area type="monotone" dataKey="cost" name="Consumption" stroke="#167a6c" fill="url(#costFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#d9a86c" fill="none" strokeWidth={2} strokeDasharray="4 4" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel" data-testid="analytics-top-consumed">
          <PanelHead title="Top consumed items" detail="Last 7 days · by value" />
          <div className="chart-body">
            {topConsumed.length === 0 ? (
              <div className="empty-hint">No stock-out in last 7 days.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topConsumed} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef1ee" horizontal={false} />
                  <XAxis type="number" tickFormatter={compactMoney} tick={{ fontSize: 11, fill: "#73807b" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#52605a" }} axisLine={false} tickLine={false} width={140} />
                  <Tooltip
                    formatter={(v) => money(v)}
                    contentStyle={{ borderRadius: 8, border: "1px solid #e4e9e5", fontSize: 11 }}
                  />
                  <Bar dataKey="value" fill="#167a6c" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      {/* Analytics row 2: category donut + outlet valuation */}
      <div className="analytics-grid">
        <section className="panel" data-testid="analytics-categories">
          <PanelHead title="Stock value distribution by category" detail="Valuation based on COGS × stock" />
          <div className="chart-body split">
            {ana.categories.length === 0 ? (
              <div className="empty-hint">No data.</div>
            ) : (
              <>
                <ResponsiveContainer width="55%" height={220}>
                  <PieChart>
                    <Pie data={ana.categories} dataKey="value" nameKey="category" innerRadius={45} outerRadius={80} paddingAngle={2}>
                      {ana.categories.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 8, border: "1px solid #e4e9e5", fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="legend-list">
                  {ana.categories.map((c, i) => (
                    <div className="legend-row" key={c.category}>
                      <span className="legend-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="legend-label">{c.category}</span>
                      <span className="legend-value">{money(c.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="panel" data-testid="analytics-outlets">
          <PanelHead title="Stock value per outlet" detail="Distribution across outlets" />
          <div className="chart-body">
            {ana.outlet_valuation.length === 0 ? (
              <div className="empty-hint">No data.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ana.outlet_valuation.map((o) => ({ name: o.outlet_name, value: o.value, items: o.items }))} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef1ee" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#73807b" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={compactMoney} tick={{ fontSize: 11, fill: "#73807b" }} axisLine={false} tickLine={false} width={65} />
                  <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 8, border: "1px solid #e4e9e5", fontSize: 11 }} />
                  <Bar dataKey="value" fill="#d9a86c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      {/* Bottom row: attention + activity */}
      <div className="content-grid">
        <section className="panel panel-wide">
          <PanelHead
            title="Needs attention"
            detail="Stock at or below minimum threshold"
            action="Open items"
            onAction={() => navigate("/inventory")}
          />
          <div className="attention-list">
            {data.low_stock_items.length === 0 && (
              <div className="attention-row"><span>All stock levels safe ✓</span></div>
            )}
            {data.low_stock_items.map((i) => (
              <div className="attention-row" key={i.id} data-testid={`low-stock-row-${i.id}`}>
                <div className="item-mark">{i.name.slice(0, 1)}</div>
                <div className="attention-name">
                  <strong>{i.name}</strong>
                  <span>
                    <Badge tone="neutral">{i.sku}</Badge> · {outletNames[i.outlet_code] || i.outlet_code} · {i.category}
                  </span>
                </div>
                <div className="stock-number">
                  <strong>{i.stock} {i.unit}</strong>
                  <span>min. {i.min_stock} {i.unit}</span>
                </div>
                <button className="small-button" onClick={() => navigate("/orders")}>
                  Create PO <ChevronRight size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <PanelHead title="Recent activity" detail="Cross-outlet transactions" />
          <div className="activity-list">
            {data.activities.length === 0 && (
              <div className="activity"><span>No activity today</span></div>
            )}
            {data.activities.map((a, idx) => {
              const Icon = iconFor(a.type);
              return (
                <div className="activity" key={idx}>
                  <div className="activity-icon">
                    <Icon size={15} />
                  </div>
                  <div>
                    <strong>{a.label}</strong>
                    <span>{a.detail}</span>
                  </div>
                  <time>{formatDate(a.at)}</time>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
