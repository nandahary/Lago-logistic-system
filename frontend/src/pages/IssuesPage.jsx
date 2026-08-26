import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Upload, Check, Trash2 } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { money, outletNames, formatDate } from "../lib/format";
import { useOutlets } from "../lib/useOutlets";
import { PageIntro, PanelHead, Modal, Field, SelectField } from "../components/UI";
import { BulkUploadDialog } from "../components/BulkUpload";
import { useAuth } from "../context/AuthContext";

const TEMPLATE = {
  headers: ["issue_ref", "from_outlet", "to_outlet", "item_sku", "qty", "notes"],
  example: [
    ["I1", "main_wh", "kitchen", "INV-0001", "5", "Dinner service"],
    ["I1", "main_wh", "kitchen", "INV-0006", "2", ""],
    ["I2", "main_wh", "bar", "INV-0004", "1", ""],
  ],
};

export default function IssuesPage() {
  const { user } = useAuth();
  const outletsList = useOutlets();
  const [list, setList] = useState([]);
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null);
  const [fromOutlet, setFromOutlet] = useState("main_wh");
  const [toOutlet, setToOutlet] = useState("kitchen");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ item_id: "", qty: "1" }]);
  const [saving, setSaving] = useState(false);

  const canCreate = ["admin", "warehouse"].includes(user?.role);

  const load = () => api.get("/issues").then((r) => setList(r.data));
  useEffect(() => {
    load();
    api.get("/items").then((r) => setItems(r.data));
  }, []);

  const openNew = () => {
    setFromOutlet("main_wh");
    setToOutlet("kitchen");
    setNotes("");
    setLines([{ item_id: "", qty: "1" }]);
    setModal("new");
  };

  const addLine = () => setLines([...lines, { item_id: "", qty: "1" }]);
  const removeLine = (idx) => setLines(lines.filter((_, i) => i !== idx));
  const updateLine = (idx, field, value) => {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    setLines(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    const cleanLines = lines.filter((l) => l.item_id && Number(l.qty) > 0);
    if (cleanLines.length === 0) return toast.error("Add at least 1 item");
    setSaving(true);
    try {
      await api.post("/issues", {
        from_outlet: fromOutlet,
        to_outlet: toOutlet,
        notes,
        items: cleanLines.map((l) => {
          const it = items.find((i) => i.id === l.item_id);
          return { item_id: l.item_id, name: it.name, qty: Number(l.qty), unit: it.unit };
        }),
      });
      toast.success("Stock out recorded, flash cost will update");
      setModal(null);
      load();
      api.get("/items").then((r) => setItems(r.data));
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Operations · outlet consumption"
        title="Stock out"
        subtitle="Record requisitions from warehouse to Kitchen, Bar, and Housekeeping."
        testid="issues-title"
        action={
          <div className="action-cluster">
            {canCreate && (
              <button
                data-testid="issues-upload-button"
                className="secondary-button"
                onClick={() => setModal("upload")}
              >
                <Upload size={16} /> Upload CSV
              </button>
            )}
            {canCreate && (
              <button
                data-testid="issues-primary-action"
                className="primary-button"
                onClick={openNew}
              >
                <Plus size={17} /> Stock out
              </button>
            )}
          </div>
        }
      />
      <section className="panel">
        <PanelHead title="Stock out history" detail={`${list.length} transactions`} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>From</th>
                <th>To</th>
                <th>Lines</th>
                <th>Total cost</th>
                <th>Date</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 40 }}>No transactions yet.</td></tr>
              )}
              {list.map((g) => (
                <tr key={g.id} data-testid={`issue-row-${g.id}`}>
                  <td><strong>{g.issue_number}</strong></td>
                  <td>{outletNames[g.from_outlet] || g.from_outlet}</td>
                  <td>{outletNames[g.to_outlet] || g.to_outlet}</td>
                  <td>
                    {g.items.length} item · {g.items.reduce((s, l) => s + l.qty, 0)} qty
                  </td>
                  <td><strong>{money(g.total_cost)}</strong></td>
                  <td><small>{formatDate(g.issued_at)}</small></td>
                  <td><small>{g.issued_by}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal === "new" && (
        <Modal title="Record stock out" onClose={() => setModal(null)}>
          <form className="form-grid" onSubmit={submit}>
            <SelectField
              label="From outlet"
              testid="issue-from-select"
              value={fromOutlet}
              onChange={setFromOutlet}
              options={outletsList.map((o) => ({ value: o.code, label: o.name }))}
            />
            <SelectField
              label="To outlet"
              testid="issue-to-select"
              value={toOutlet}
              onChange={setToOutlet}
              options={outletsList
                .filter((o) => o.type !== "warehouse")
                .map((o) => ({ value: o.code, label: o.name }))}
            />
            <label className="field" style={{ gridColumn: "1/-1" }}>
              <span>Notes</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Dinner service, event, etc." />
            </label>
            <div style={{ gridColumn: "1/-1" }}>
              <p className="eyebrow">Lines item</p>
              <div className="line-editor">
                {lines.map((l, idx) => (
                  <div className="line-row simple" key={idx}>
                    <select
                      data-testid={`issue-line-item-${idx}`}
                      value={l.item_id}
                      onChange={(e) => updateLine(idx, "item_id", e.target.value)}
                    >
                      <option value="">Pick item...</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({it.sku}) · stock {it.stock} {it.unit}
                        </option>
                      ))}
                    </select>
                    <input data-testid={`issue-line-qty-${idx}`} type="number" value={l.qty} onChange={(e) => updateLine(idx, "qty", e.target.value)} placeholder="Qty" />
                    <button type="button" className="icon-button" onClick={() => removeLine(idx)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" className="chip small" onClick={addLine}>
                  <Plus size={12} /> Add row
                </button>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button>
              <button data-testid="issue-save-button" className="primary-button" type="submit" disabled={saving}>
                <Check size={16} /> {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "upload" && (
        <BulkUploadDialog
          title="Upload stock out (CSV)"
          endpoint="/issues/bulk-upload"
          templateName="stock_out_template.csv"
          templateHeaders={TEMPLATE.headers}
          templateExample={TEMPLATE.example}
          instructions={
            <>
              Group rows with the same <b>issue_ref</b> column. Stock will decrease
              immediately and cost will be added to flash cost for the upload date.
            </>
          }
          onClose={() => setModal(null)}
          onSuccess={() => {
            load();
            api.get("/items").then((r) => setItems(r.data));
          }}
          testid="issues-upload"
        />
      )}
    </>
  );
}
