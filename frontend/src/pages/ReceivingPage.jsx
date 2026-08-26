import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Upload, Check, Trash2, FileText, Printer } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { money, outletNames, formatDate } from "../lib/format";
import { PageIntro, PanelHead, Modal, Field, Badge } from "../components/UI";
import { BulkUploadDialog } from "../components/BulkUpload";
import { useAuth } from "../context/AuthContext";
import { printGRN } from "../lib/printDocs";

const TEMPLATE = {
  headers: ["po_number", "item_sku", "qty", "price", "notes"],
  example: [
    ["PO-0001", "PRT-0001", "20", "185000", "Morning delivery"],
    ["PO-0001", "PRT-0002", "5", "225000", ""],
  ],
};

export default function ReceivingPage() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [approvedPOs, setApprovedPOs] = useState([]);
  const [modal, setModal] = useState(null); // "new" | "upload" | null
  const [selectedPO, setSelectedPO] = useState(null); // full PO object
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([]); // {item_id, name, unit, qty, price}
  const [saving, setSaving] = useState(false);

  const canCreate = ["admin", "warehouse"].includes(user?.role);

  const loadList = () => api.get("/receivings").then((r) => setList(r.data));
  const loadPOs = () =>
    api.get("/orders").then((r) => {
      // Allow both approved (not yet received) and partially-received POs
      setApprovedPOs(r.data.filter((o) => o.status === "approved" || o.status === "partial"));
    });

  useEffect(() => {
    loadList();
    loadPOs();
  }, []);

  const openNew = () => {
    if (approvedPOs.length === 0) {
      toast.error("No PO ready to receive. Approve a PO first.");
      return;
    }
    setSelectedPO(null);
    setLines([]);
    setNotes("");
    setModal("new");
  };

  const onPickPO = (poId) => {
    const po = approvedPOs.find((p) => p.id === poId);
    setSelectedPO(po);
    if (po) {
      setLines(
        po.items.map((l) => {
          const remaining = Number(l.qty) - Number(l.received_qty || 0);
          return {
            item_id: l.item_id,
            name: l.name,
            unit: l.unit,
            ordered: l.qty,
            received: l.received_qty || 0,
            remaining,
            qty: String(remaining),
            price: String(l.price),
          };
        }).filter((l) => l.remaining > 0)
      );
    } else {
      setLines([]);
    }
  };

  const updateLine = (idx, field, value) => {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    setLines(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!selectedPO) return toast.error("Select a Purchase Order first");
    const cleanLines = lines.filter((l) => Number(l.qty) > 0);
    if (cleanLines.length === 0) return toast.error("At least 1 item must be received");
    setSaving(true);
    try {
      await api.post("/receivings", {
        po_id: selectedPO.id,
        supplier: selectedPO.supplier,
        outlet_code: selectedPO.outlet_code,
        notes,
        items: cleanLines.map((l) => ({
          item_id: l.item_id,
          name: l.name,
          qty: Number(l.qty),
          unit: l.unit,
          price: Number(l.price),
        })),
      });
      toast.success("Receiving recorded & COGS auto-updated");
      setModal(null);
      loadList();
      loadPOs();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const linesTotal = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0);

  return (
    <>
      <PageIntro
        eyebrow="Operations · goods receiving"
        title="Goods Received Note (GRN)"
        subtitle="Every receiving must reference an approved Purchase Order. Weighted-average COGS is auto-updated."
        testid="receiving-title"
        action={
          <div className="action-cluster">
            {canCreate && (
              <button
                data-testid="receiving-upload-button"
                className="secondary-button"
                onClick={() => setModal("upload")}
              >
                <Upload size={16} /> Upload CSV
              </button>
            )}
            {canCreate && (
              <button
                data-testid="receiving-primary-action"
                className="primary-button"
                onClick={openNew}
              >
                <Plus size={17} /> Receive goods
              </button>
            )}
          </div>
        }
      />

      {canCreate && approvedPOs.length > 0 && (
        <div className="info-strip" data-testid="approved-po-banner">
          <FileText size={16} />
          <span>
            <strong>{approvedPOs.length}</strong> Purchase Orders ready to receive
          </span>
          <button className="text-button" onClick={openNew}>
            Process now ›
          </button>
        </div>
      )}
      {canCreate && approvedPOs.length === 0 && (
        <div className="info-strip warning" data-testid="no-po-banner">
          <FileText size={16} />
          <span>No approved Purchase Order. Receiving cannot proceed without a PO.</span>
        </div>
      )}

      <section className="panel">
        <PanelHead title="Receiving history" detail={`${list.length} GRN recorded`} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>GRN No.</th>
                <th>PO Ref</th>
                <th>Supplier</th>
                <th>Outlet</th>
                <th>Lines</th>
                <th>Total</th>
                <th>Received</th>
                <th>By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 40 }}>No receivings yet.</td></tr>
              )}
              {list.map((g) => (
                <tr key={g.id} data-testid={`grn-row-${g.id}`}>
                  <td><strong>{g.grn_number}</strong></td>
                  <td>
                    {g.po_number ? <Badge tone="blue">{g.po_number}</Badge> : <small>-</small>}
                  </td>
                  <td>{g.supplier}</td>
                  <td>{outletNames[g.outlet_code] || g.outlet_code}</td>
                  <td>
                    {g.items.length} item · {g.items.reduce((s, l) => s + l.qty, 0)} qty
                  </td>
                  <td><strong>{money(g.total)}</strong></td>
                  <td><small>{formatDate(g.received_at)}</small></td>
                  <td><small>{g.received_by}</small></td>
                  <td>
                    <button
                      data-testid={`grn-print-${g.id}`}
                      className="small-button"
                      onClick={() => printGRN(g)}
                      title="Print GRN"
                    >
                      <Printer size={12} /> Print
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal === "new" && (
        <Modal title="Receive goods from PO" onClose={() => setModal(null)}>
          <form onSubmit={submit}>
            <label className="field">
              <span>Purchase Order being received</span>
              <select
                data-testid="grn-po-select"
                value={selectedPO?.id || ""}
                onChange={(e) => onPickPO(e.target.value)}
                required
              >
                <option value="">-- Select approved PO --</option>
                {approvedPOs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.po_number} · {p.supplier} · {outletNames[p.outlet_code] || p.outlet_code} · {money(p.total)}
                  </option>
                ))}
              </select>
            </label>

            {selectedPO && (
              <>
                <div className="po-summary" data-testid="po-summary">
                  <div>
                    <span>Supplier</span>
                    <strong>{selectedPO.supplier}</strong>
                  </div>
                  <div>
                    <span>Destination outlet</span>
                    <strong>{outletNames[selectedPO.outlet_code] || selectedPO.outlet_code}</strong>
                  </div>
                  <div>
                    <span>PO value</span>
                    <strong>{money(selectedPO.total)}</strong>
                  </div>
                </div>

                <p className="eyebrow" style={{ marginTop: 18 }}>
                  Line items — remaining (not yet received) quantities shown; adjust if actual received differs
                </p>
                <div className="line-editor">
                  {lines.length === 0 && (
                    <div className="empty-hint">All items on this PO have been fully received.</div>
                  )}
                  {lines.map((l, idx) => (
                    <div className="line-row partial" key={idx}>
                      <div className="line-item-label">
                        <strong>{l.name}</strong>
                        <small>
                          Ordered {l.ordered} · Received so far {l.received} · Remaining <b>{l.remaining}</b> {l.unit}
                        </small>
                      </div>
                      <input
                        data-testid={`grn-line-qty-${idx}`}
                        type="number"
                        max={l.remaining}
                        min="0"
                        step="0.01"
                        value={l.qty}
                        onChange={(e) => updateLine(idx, "qty", e.target.value)}
                        placeholder="Qty received"
                      />
                      <input
                        data-testid={`grn-line-price-${idx}`}
                        type="number"
                        value={l.price}
                        onChange={(e) => updateLine(idx, "price", e.target.value)}
                        placeholder="Price"
                      />
                      <div />
                    </div>
                  ))}
                </div>
                <div className="line-total">Total received: <strong>{money(linesTotal)}</strong></div>

                <label className="field" style={{ marginTop: 12 }}>
                  <span>Receiving notes</span>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Delivery order #..., item condition, etc."
                  />
                </label>
              </>
            )}

            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button>
              <button
                data-testid="grn-save-button"
                className="primary-button"
                type="submit"
                disabled={!selectedPO || saving}
              >
                <Check size={16} /> {saving ? "Saving..." : "Save receiving"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "upload" && (
        <BulkUploadDialog
          title="Upload receivings (CSV)"
          endpoint="/receivings/bulk-upload"
          templateName="receivings_template.csv"
          templateHeaders={TEMPLATE.headers}
          templateExample={TEMPLATE.example}
          instructions={
            <>
              Must include <b>po_number</b> that has status <i>approved</i>. SKU in the
              CSV must match items on the PO. Weighted-average COGS is auto-updated.
            </>
          }
          onClose={() => setModal(null)}
          onSuccess={() => {
            loadList();
            loadPOs();
          }}
          testid="receivings-upload"
        />
      )}
    </>
  );
}
