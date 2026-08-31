import React, { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { Download, FileBarChart2, Package, TrendingUp, Wallet, ClipboardList, AlertTriangle, Inbox } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { money, outletNames, statusLabels, statusTone, formatDate, today } from "../lib/format";
import { useOutlets } from "../lib/useOutlets";
import { PageIntro, PanelHead, Badge } from "../components/UI";

const PR_STATUS_LABEL = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved (not yet converted)",
  returned: "Returned for changes",
};
const PR_STATUS_TONE = {
  draft: "neutral",
  pending_approval: "amber",
  approved: "green",
  returned: "amber",
};
const PR_PRIORITY_TONE = { low: "neutral", medium: "blue", high: "amber", urgent: "amber" };

const compactMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)}K`;
  return `Rp${n}`;
};

const TABS = [
  { id: "po-by-supplier", label: "PO per Supplier", icon: TrendingUp },
  { id: "po-outstanding", label: "PO Outstanding", icon: ClipboardList },
  { id: "po-received", label: "PO Received Summary", icon: Inbox },
  { id: "pr-outstanding", label: "PR Outstanding", icon: ClipboardList },
  { id: "stock-balance", label: "Stock Balance", icon: Package },
  { id: "stock-movement", label: "Stock Movement", icon: FileBarChart2 },
  { id: "flash-cost", label: "Flash Cost (Financial)", icon: Wallet },
  { id: "low-stock", label: "Low Stock", icon: AlertTriangle },
  { id: "top-consumed", label: "Top Consumed", icon: TrendingUp },
];

function exportCSV(filename, headers, rows) {
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [tab, setTab] = useState("po-by-supplier");
  return (
    <>
      <PageIntro
        eyebrow="Analytics · reports"
        title="Operational reports"
        subtitle="Analyze purchasing, stock, and cost in one place. Every table can be exported to CSV."
        testid="reports-title"
      />
      <div className="tabs" data-testid="reports-tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-testid={`report-tab-${id}`}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      <div className="report-body">
        {tab === "po-by-supplier" && <POBySupplier />}
        {tab === "po-outstanding" && <POOutstanding />}
        {tab === "po-received" && <POReceived />}
        {tab === "pr-outstanding" && <PROutstanding />}
        {tab === "stock-balance" && <StockBalance />}
        {tab === "stock-movement" && <StockMovement />}
        {tab === "flash-cost" && <FlashCostFinancial />}
        {tab === "low-stock" && <LowStock />}
        {tab === "top-consumed" && <TopConsumed />}
      </div>
    </>
  );
}

// ============ 1. PO per Supplier ============
function POBySupplier() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [data, setData] = useState(null);
  const load = () =>
    api.get("/reports/po-by-supplier", { params: { start, end } })
      .then((r) => setData(r.data))
      .catch((e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [start, end]);
  const download = () => {
    exportCSV(
      `po-by-supplier-${today()}.csv`,
      ["Supplier", "Total PO", "PO value", "Received value", "Outstanding", "Waiting", "Approved", "Partial", "Received", "Cancelled"],
      data.rows.map((r) => [r.supplier, r.po_count, r.po_total, r.received_total, r.outstanding_value, r.waiting || 0, r.approved || 0, r.partial || 0, r.received || 0, r.cancelled || 0])
    );
  };
  if (!data) return <div className="loading-state">Loading...</div>;
  return (
    <>
      <ReportBar>
        <DateRange start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <Summary items={[
          { label: "Supplier", value: data.totals.supplier_count },
          { label: "PO count", value: data.totals.po_count },
          { label: "PO value", value: money(data.totals.po_total) },
          { label: "Outstanding", value: money(data.totals.outstanding_value), tone: "amber" },
        ]} />
        <ExportBtn onClick={download} disabled={data.rows.length === 0} />
      </ReportBar>
      <ReportTable
        headers={["Supplier", "PO", "PO value", "Received value", "Outstanding", "Status distribution"]}
        rows={data.rows.map((r) => [
          <strong>{r.supplier}</strong>,
          r.po_count,
          money(r.po_total),
          money(r.received_total),
          <span className={r.outstanding_value > 0 ? "danger-text" : ""}>{money(r.outstanding_value)}</span>,
          <div className="badge-cluster">
            {r.waiting > 0 && <Badge tone="amber">{r.waiting} waiting</Badge>}
            {r.approved > 0 && <Badge tone="blue">{r.approved} approved</Badge>}
            {r.partial > 0 && <Badge tone="amber">{r.partial} partial</Badge>}
            {r.received > 0 && <Badge tone="green">{r.received} received</Badge>}
            {r.cancelled > 0 && <Badge tone="neutral">{r.cancelled} cancel</Badge>}
          </div>,
        ])}
      />
    </>
  );
}

// ============ 2. PO Outstanding ============
function POOutstanding() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/reports/po-outstanding").then((r) => setData(r.data));
  }, []);
  const download = () => {
    const rows = [];
    data.rows.forEach((p) => {
      p.lines.forEach((l) =>
        rows.push([p.po_number, p.supplier, outletNames[p.outlet_code] || p.outlet_code, statusLabels[p.status] || p.status, p.days_open, l.name, l.qty_ordered, l.qty_received, l.qty_remaining, l.unit, l.price, l.value_remaining])
      );
    });
    exportCSV(
      `po-outstanding-${today()}.csv`,
      ["No PO", "Supplier", "Outlet", "Status", "Days open", "Item", "PO qty", "Qty received", "Remaining qty", "Unit", "Price", "Remaining value"],
      rows
    );
  };
  if (!data) return <div className="loading-state">Loading...</div>;
  return (
    <>
      <ReportBar>
        <Summary items={[
          { label: "Unfinished PO", value: data.totals.po_count },
          { label: "Outstanding value", value: money(data.totals.outstanding_value), tone: "amber" },
        ]} />
        <ExportBtn onClick={download} disabled={data.rows.length === 0} />
      </ReportBar>
      {data.rows.length === 0 ? (
        <div className="empty-hint" style={{ padding: 40 }}>No outstanding PO — all completed or no PO yet.</div>
      ) : (
        data.rows.map((p) => (
          <section className="panel" style={{ marginBottom: 14 }} key={p.id}>
            <div className="panel-head">
              <div>
                <h2>{p.po_number} · {p.supplier}</h2>
                <p>
                  {outletNames[p.outlet_code] || p.outlet_code} ·
                  <Badge tone={statusTone[p.status]} style={{ marginLeft: 6 }}>{statusLabels[p.status] || p.status}</Badge> ·
                  {p.days_open != null && ` ${p.days_open} days open`} · Outstanding <strong>{money(p.outstanding_value)}</strong>
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Item</th><th>PO qty</th><th>Received</th><th>Remaining</th><th>Remaining value</th></tr>
                </thead>
                <tbody>
                  {p.lines.map((l, i) => (
                    <tr key={i}>
                      <td><strong>{l.name}</strong> <small>{l.unit}</small></td>
                      <td>{l.qty_ordered}</td>
                      <td>{l.qty_received}</td>
                      <td className="danger-text"><strong>{l.qty_remaining}</strong></td>
                      <td><strong>{money(l.value_remaining)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </>
  );
}

// ============ PO Received Summary ============
function POReceived() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [data, setData] = useState(null);
  const load = () =>
    api.get("/reports/po-received", { params: { start, end } })
      .then((r) => setData(r.data))
      .catch((e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [start, end]);
  const download = () => {
    exportCSV(
      `po-received-${today()}.csv`,
      ["No PO", "Supplier", "Outlet", "Status", "Ordered value", "Received value", "GRN count", "Last received", "Lead time (days)"],
      data.rows.map((r) => [r.po_number, r.supplier, outletNames[r.outlet_code] || r.outlet_code, statusLabels[r.status] || r.status, r.ordered_value, r.received_value, r.grn_count, r.last_received_at ? formatDate(r.last_received_at) : "-", r.lead_time_days ?? "-"])
    );
  };
  if (!data) return <div className="loading-state">Loading...</div>;
  return (
    <>
      <ReportBar>
        <DateRange start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <Summary items={[
          { label: "PO received", value: data.totals.po_count },
          { label: "Fully received", value: data.totals.fully_received, tone: "green" },
          { label: "Partially received", value: data.totals.partially_received, tone: "amber" },
          { label: "Received value", value: money(data.totals.received_value), tone: "teal" },
          { label: "Avg lead time", value: data.totals.avg_lead_time_days != null ? `${data.totals.avg_lead_time_days}d` : "-" },
        ]} />
        <ExportBtn onClick={download} disabled={data.rows.length === 0} />
      </ReportBar>
      <ReportTable
        headers={["PO", "Supplier", "Outlet", "Status", "Ordered value", "Received value", "GRNs", "Last received", "Lead time"]}
        rows={data.rows.map((r) => [
          <strong>{r.po_number}</strong>,
          r.supplier,
          outletNames[r.outlet_code] || r.outlet_code,
          <Badge tone={statusTone[r.status]}>{statusLabels[r.status] || r.status}</Badge>,
          money(r.ordered_value),
          <strong>{money(r.received_value)}</strong>,
          r.grn_count,
          r.last_received_at ? <small>{formatDate(r.last_received_at)}</small> : "-",
          r.lead_time_days != null ? `${r.lead_time_days}d` : "-",
        ])}
      />
    </>
  );
}

// ============ PR Outstanding ============
function PROutstanding() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/reports/pr-outstanding").then((r) => setData(r.data));
  }, []);
  const download = () => {
    exportCSV(
      `pr-outstanding-${today()}.csv`,
      ["PR No.", "Requester", "Department", "Priority", "Status", "Waiting on", "Items", "Required by", "Days open"],
      data.rows.map((r) => [r.pr_number, r.requester_name, r.department, r.priority, PR_STATUS_LABEL[r.status] || r.status, r.current_approver_role || "-", r.item_count, r.required_delivery_date || "-", r.days_open ?? "-"])
    );
  };
  if (!data) return <div className="loading-state">Loading...</div>;
  return (
    <>
      <ReportBar>
        <Summary items={[
          { label: "Outstanding PR", value: data.totals.count },
          { label: "Pending approval", value: data.totals.by_status.pending_approval || 0, tone: "amber" },
          { label: "Approved, not converted", value: data.totals.by_status.approved || 0, tone: "green" },
          { label: "Urgent", value: data.totals.by_priority.urgent || 0, tone: "amber" },
        ]} />
        <ExportBtn onClick={download} disabled={data.rows.length === 0} />
      </ReportBar>
      <ReportTable
        headers={["PR No.", "Requester", "Department", "Priority", "Status", "Waiting on", "Items", "Required by", "Days open"]}
        rows={data.rows.map((r) => [
          <strong>{r.pr_number}</strong>,
          r.requester_name,
          r.department,
          <Badge tone={PR_PRIORITY_TONE[r.priority]}>{r.priority}</Badge>,
          <Badge tone={PR_STATUS_TONE[r.status]}>{PR_STATUS_LABEL[r.status] || r.status}</Badge>,
          r.current_approver_role ? <Badge tone="amber">{r.current_approver_role}</Badge> : "-",
          r.item_count,
          r.required_delivery_date || "-",
          r.days_open != null ? `${r.days_open}d` : "-",
        ])}
      />
    </>
  );
}

// ============ 3. Stock Balance ============
function StockBalance() {
  const outletsList = useOutlets();
  const [outlet, setOutlet] = useState("all");
  const [category, setCategory] = useState("");
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/reports/stock-balance", { params: { outlet, category: category || undefined } })
      .then((r) => setData(r.data));
  }, [outlet, category]);
  const download = () => {
    exportCSV(
      `stock-balance-${today()}.csv`,
      ["SKU", "Name", "Category", "Outlet", "Unit", "Stock", "Min stock", "COGS", "Valuation", "Low"],
      data.rows.map((r) => [r.sku, r.name, r.category, r.outlet_code, r.unit, r.stock, r.min_stock, r.cost, r.value, r.low ? "YES" : ""])
    );
  };
  if (!data) return <div className="loading-state">Loading...</div>;
  return (
    <>
      <ReportBar>
        <label className="field small"><span>Outlet</span>
          <select data-testid="stock-balance-outlet" value={outlet} onChange={(e) => setOutlet(e.target.value)}>
            <option value="all">All outlets</option>
            {outletsList.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </label>
        <label className="field small"><span>Category</span>
          <input data-testid="stock-balance-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All" />
        </label>
        <Summary items={[
          { label: "Item", value: data.totals.item_count },
          { label: "Valuation total", value: money(data.totals.total_value), tone: "teal" },
          { label: "Low stock", value: data.totals.low_stock_count, tone: "amber" },
        ]} />
        <ExportBtn onClick={download} disabled={data.rows.length === 0} />
      </ReportBar>
      <ReportTable
        headers={["SKU", "Name", "Category", "Outlet", "Stock", "Min", "COGS", "Valuation"]}
        rows={data.rows.map((r) => [
          <Badge tone="neutral">{r.sku}</Badge>,
          <strong>{r.name}</strong>,
          r.category,
          outletNames[r.outlet_code] || r.outlet_code,
          <span className={r.low ? "danger-text" : ""}><strong>{r.stock} {r.unit}</strong></span>,
          `${r.min_stock} ${r.unit}`,
          money(r.cost),
          <strong>{money(r.value)}</strong>,
        ])}
      />
    </>
  );
}

// ============ 4. Stock Movement ============
function StockMovement() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sku, setSku] = useState("");
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/reports/stock-movement", { params: { start: start || undefined, end: end || undefined, item_sku: sku || undefined } })
      .then((r) => setData(r.data));
  }, [start, end, sku]);
  const download = () => {
    exportCSV(
      `stock-movement-${today()}.csv`,
      ["Date", "Ref", "Type", "Item", "Unit", "In", "Out", "Value"],
      data.rows.map((r) => [r.date, r.ref, r.type, r.name, r.unit, r.qty_in, r.qty_out, r.value])
    );
  };
  if (!data) return <div className="loading-state">Loading...</div>;
  return (
    <>
      <ReportBar>
        <DateRange start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <label className="field small"><span>Filter SKU</span>
          <input data-testid="movement-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Empty = all" />
        </label>
        <Summary items={[
          { label: "Movement lines", value: data.totals.count },
          { label: "Total in", value: `${data.totals.total_qty_in} · ${compactMoney(data.totals.total_value_in)}`, tone: "green" },
          { label: "Total out", value: `${data.totals.total_qty_out} · ${compactMoney(data.totals.total_value_out)}`, tone: "amber" },
        ]} />
        <ExportBtn onClick={download} disabled={data.rows.length === 0} />
      </ReportBar>
      <ReportTable
        headers={["Date", "Ref", "Type", "Item", "In", "Out", "Value"]}
        rows={data.rows.map((r) => [
          <small>{formatDate(r.date)}</small>,
          <strong>{r.ref}</strong>,
          <Badge tone={r.type.startsWith("IN") ? "green" : r.type.startsWith("OUT") ? "amber" : "blue"}>{r.type}</Badge>,
          <><strong>{r.name}</strong> <small>{r.unit}</small></>,
          r.qty_in > 0 ? <span className="success-text"><strong>+{r.qty_in}</strong></span> : "-",
          r.qty_out > 0 ? <span className="danger-text"><strong>-{r.qty_out}</strong></span> : "-",
          money(r.value),
        ])}
      />
    </>
  );
}

// ============ 5. Flash Cost Financial ============
function FlashCostFinancial() {
  const t = today();
  const [start, setStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [end, setEnd] = useState(t);
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/reports/financial/flash-cost", { params: { start, end } })
      .then((r) => setData(r.data));
  }, [start, end]);
  const download = () => {
    exportCSV(
      `flash-cost-${start}_${end}.csv`,
      ["Date", "Consumption (cost)", "Revenue", "Percentage"],
      data.daily.map((d) => [d.date, d.cost, d.revenue, d.percentage])
    );
  };
  if (!data) return <div className="loading-state">Loading...</div>;
  return (
    <>
      <ReportBar>
        <DateRange start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <Summary items={[
          { label: "Total cost", value: money(data.totals.total_cost), tone: "amber" },
          { label: "Total revenue", value: money(data.totals.total_revenue), tone: "green" },
          { label: "Percentage", value: `${data.totals.percentage}%`, tone: data.totals.percentage <= 32 ? "green" : "amber" },
        ]} />
        <ExportBtn onClick={download} disabled={data.daily.length === 0} />
      </ReportBar>
      <section className="panel">
        <PanelHead title="Overview per outlet" detail={`Period ${data.period.start} → ${data.period.end}`} />
        <ReportTable
          headers={["Outlet", "Consumption", "Revenue", "Flash cost %"]}
          rows={data.by_outlet.map((r) => [
            <strong>{r.outlet_name}</strong>,
            money(r.cost),
            money(r.revenue),
            <Badge tone={r.percentage <= 32 ? "green" : r.percentage <= 40 ? "amber" : "neutral"}>{r.percentage}%</Badge>,
          ])}
        />
      </section>
      <section className="panel" style={{ marginTop: 14 }}>
        <PanelHead title="Daily breakdown (all outlets)" detail="Cost vs revenue" />
        <ReportTable
          headers={["Date", "Consumption", "Revenue", "Percentage"]}
          rows={data.daily.map((r) => [
            <strong>{r.date}</strong>,
            money(r.cost),
            money(r.revenue),
            <Badge tone={r.percentage <= 32 ? "green" : r.percentage <= 40 ? "amber" : "neutral"}>{r.percentage}%</Badge>,
          ])}
        />
      </section>
    </>
  );
}

// ============ 6. Low Stock ============
function LowStock() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/reports/low-stock").then((r) => setData(r.data));
  }, []);
  const download = () => {
    exportCSV(
      `low-stock-${today()}.csv`,
      ["SKU", "Name", "Category", "Outlet", "Stock", "Min", "Need to order", "Unit", "Supplier", "COGS"],
      data.rows.map((r) => [r.sku, r.name, r.category, r.outlet_code, r.stock, r.min_stock, r.need_to_order, r.unit, r.supplier, r.cost])
    );
  };
  if (!data) return <div className="loading-state">Loading...</div>;
  return (
    <>
      <ReportBar>
        <Summary items={[{ label: "Low stock items", value: data.totals.count, tone: "amber" }]} />
        <ExportBtn onClick={download} disabled={data.rows.length === 0} />
      </ReportBar>
      <ReportTable
        headers={["SKU", "Name", "Category", "Outlet", "Stock", "Min", "Need to order", "Supplier"]}
        rows={data.rows.map((r) => [
          <Badge tone="neutral">{r.sku}</Badge>,
          <strong>{r.name}</strong>,
          r.category,
          outletNames[r.outlet_code] || r.outlet_code,
          <span className="danger-text"><strong>{r.stock} {r.unit}</strong></span>,
          `${r.min_stock} ${r.unit}`,
          <strong>{r.need_to_order} {r.unit}</strong>,
          r.supplier || "-",
        ])}
      />
    </>
  );
}

// ============ 7. Top Consumed ============
function TopConsumed() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get("/reports/top-consumed", { params: { days, limit: 30 } }).then((r) => setData(r.data));
  }, [days]);
  const download = () => {
    exportCSV(
      `top-consumed-${days}d-${today()}.csv`,
      ["Item", "Unit", "Qty used", "Value", "Transactions"],
      data.rows.map((r) => [r.name, r.unit, r.qty, r.value, r.transactions])
    );
  };
  if (!data) return <div className="loading-state">Loading...</div>;
  return (
    <>
      <ReportBar>
        <label className="field small"><span>Time range</span>
          <select data-testid="top-consumed-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <Summary items={[
          { label: "Items used", value: data.totals.item_count },
          { label: "Total value", value: money(data.totals.total_value), tone: "teal" },
        ]} />
        <ExportBtn onClick={download} disabled={data.rows.length === 0} />
      </ReportBar>
      <ReportTable
        headers={["Rank", "Item", "Qty", "Value", "Transactions"]}
        rows={data.rows.map((r, idx) => [
          <strong>#{idx + 1}</strong>,
          <><strong>{r.name}</strong> <small>{r.unit}</small></>,
          <strong>{r.qty}</strong>,
          <strong>{money(r.value)}</strong>,
          r.transactions,
        ])}
      />
    </>
  );
}

// ============ Shared UI ============
function ReportBar({ children }) {
  return <div className="report-bar">{children}</div>;
}
function DateRange({ start, end, onStart, onEnd }) {
  return (
    <>
      <label className="field small"><span>From</span>
        <input type="date" value={start} onChange={(e) => onStart(e.target.value)} data-testid="report-start" />
      </label>
      <label className="field small"><span>To</span>
        <input type="date" value={end} onChange={(e) => onEnd(e.target.value)} data-testid="report-end" />
      </label>
    </>
  );
}
function Summary({ items }) {
  return (
    <div className="report-summary">
      {items.map((i) => (
        <div className="summary-tile" key={i.label}>
          <span>{i.label}</span>
          <strong className={i.tone || ""}>{i.value}</strong>
        </div>
      ))}
    </div>
  );
}
function ExportBtn({ onClick, disabled }) {
  return (
    <button data-testid="report-export-btn" className="secondary-button" onClick={onClick} disabled={disabled}>
      <Download size={14} /> Export CSV
    </button>
  );
}
function ReportTable({ headers, rows }) {
  return (
    <section className="panel">
      <div className="table-wrap">
        <table>
          <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={headers.length} style={{ textAlign: "center", padding: 40 }}>No data.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
