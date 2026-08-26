import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Printer, Mail, Phone, MapPin, Clock, Wallet, Package, Truck } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { money, outletNames, statusLabels, statusTone, formatDate } from "../lib/format";
import { PanelHead, Badge } from "../components/UI";
import { printPurchaseOrder } from "../lib/printDocs";

export default function SupplierDetailPage() {
  const { supplierId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    api
      .get(`/suppliers/${supplierId}/orders`)
      .then((r) => setData(r.data))
      .catch((err) => {
        toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
        navigate("/suppliers");
      });
  }, [supplierId, navigate]);

  if (!data) return <div className="loading-state">Loading supplier detail...</div>;
  const s = data.supplier;
  const stats = data.stats;

  return (
    <>
      <button
        data-testid="supplier-back-button"
        className="text-button"
        onClick={() => navigate("/suppliers")}
        style={{ marginBottom: 18 }}
      >
        <ArrowLeft size={14} /> Back to supplier list
      </button>

      <div className="supplier-header" data-testid="supplier-detail-header">
        <div>
          <p className="eyebrow">Supplier · vendor catalog</p>
          <h1 data-testid="supplier-detail-name">{s.name}</h1>
          <div className="supplier-code">
            <Badge tone="neutral">{s.code}</Badge>
            {s.payment_terms && <Badge tone="blue">{s.payment_terms}</Badge>}
            {s.lead_time_days > 0 && (
              <Badge tone={s.lead_time_days <= 2 ? "green" : "amber"}>
                <Clock size={10} style={{ marginRight: 4, verticalAlign: "middle" }} />
                Lead time {s.lead_time_days} days
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="supplier-info-grid">
        <div className="info-card">
          <span className="info-label">Contact</span>
          <strong>{s.contact_person || "-"}</strong>
        </div>
        <div className="info-card">
          <span className="info-label">
            <Phone size={12} /> Phone
          </span>
          <strong>{s.phone || "-"}</strong>
        </div>
        <div className="info-card">
          <span className="info-label">
            <Mail size={12} /> Email
          </span>
          <strong>{s.email || "-"}</strong>
        </div>
        <div className="info-card" style={{ gridColumn: "span 2" }}>
          <span className="info-label">
            <MapPin size={12} /> Address
          </span>
          <strong>{s.address || "-"}</strong>
        </div>
        {s.notes && (
          <div className="info-card" style={{ gridColumn: "span 3" }}>
            <span className="info-label">Notes</span>
            <strong>{s.notes}</strong>
          </div>
        )}
      </div>

      <div className="metric-grid" style={{ marginTop: 22 }}>
        <div className="metric" data-testid="supplier-metric-orders">
          <div className="metric-icon teal">
            <Package size={17} />
          </div>
          <span>Total Purchase Order</span>
          <strong>{stats.order_count}</strong>
          <small className="teal">
            <Wallet size={11} style={{ verticalAlign: "middle", marginRight: 3 }} />
            {money(stats.order_total)}
          </small>
        </div>
        <div className="metric" data-testid="supplier-metric-grn">
          <div className="metric-icon green">
            <Truck size={17} />
          </div>
          <span>Total received</span>
          <strong>{stats.grn_count}</strong>
          <small className="green">{money(stats.grn_total)}</small>
        </div>
        <div className="metric" data-testid="supplier-metric-status">
          <div className="metric-icon amber">
            <Clock size={17} />
          </div>
          <span>Status summary</span>
          <strong>{stats.by_status.waiting_approval || 0}</strong>
          <small className="amber">PO awaiting approval</small>
        </div>
        <div className="metric" data-testid="supplier-metric-active">
          <div className="metric-icon blue">
            <Package size={17} />
          </div>
          <span>Active PO</span>
          <strong>
            {(stats.by_status.approved || 0) + (stats.by_status.partial || 0)}
          </strong>
          <small className="blue">Ready / being received</small>
        </div>
      </div>

      <section className="panel" style={{ marginTop: 22 }}>
        <PanelHead
          title="Purchase Order history"
          detail={`${data.orders.length} PO from ${s.name}`}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PO No.</th>
                <th>Outlet</th>
                <th>Lines</th>
                <th>Total</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.orders.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 40 }}>
                    No PO for this supplier yet.
                  </td>
                </tr>
              )}
              {data.orders.map((o) => {
                const totalQty = o.items.reduce((sum, l) => sum + Number(l.qty), 0);
                const recvQty = o.items.reduce(
                  (sum, l) => sum + Number(l.received_qty || 0),
                  0
                );
                const pct = totalQty > 0 ? Math.round((recvQty / totalQty) * 100) : 0;
                return (
                  <tr key={o.id} data-testid={`supplier-po-row-${o.id}`}>
                    <td>
                      <strong>{o.po_number}</strong>
                    </td>
                    <td>{outletNames[o.outlet_code] || o.outlet_code}</td>
                    <td>
                      {o.items.length} lines
                      {o.status !== "waiting_approval" && (
                        <small>
                          Received {recvQty}/{totalQty} ({pct}%)
                        </small>
                      )}
                    </td>
                    <td>
                      <strong>{money(o.total)}</strong>
                    </td>
                    <td>
                      <Badge tone={statusTone[o.status]}>
                        {statusLabels[o.status] || o.status}
                      </Badge>
                    </td>
                    <td>
                      <small>{formatDate(o.created_at)}</small>
                    </td>
                    <td>
                      <button
                        className="small-button"
                        onClick={() => printPurchaseOrder(o, s)}
                        title="Print PO"
                      >
                        <Printer size={12} /> Print
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {data.receivings.length > 0 && (
        <section className="panel" style={{ marginTop: 18 }}>
          <PanelHead
            title="Receiving history"
            detail={`${data.receivings.length} GRN from ${s.name}`}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>GRN No.</th>
                  <th>PO Ref</th>
                  <th>Outlet</th>
                  <th>Lines</th>
                  <th>Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.receivings.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <strong>{g.grn_number}</strong>
                    </td>
                    <td>
                      {g.po_number ? <Badge tone="blue">{g.po_number}</Badge> : "-"}
                    </td>
                    <td>{outletNames[g.outlet_code] || g.outlet_code}</td>
                    <td>
                      {g.items.length} item · {g.items.reduce((s, l) => s + l.qty, 0)} qty
                    </td>
                    <td>
                      <strong>{money(g.total)}</strong>
                    </td>
                    <td>
                      <small>{formatDate(g.received_at)}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
