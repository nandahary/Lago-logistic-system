import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus, Search, Send, Check, X, RotateCcw, Trash2, Printer, Pencil, FileText, Layers,
} from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { formatDate, outletNames } from "../lib/format";
import { PageIntro, PanelHead, Modal, Field, SelectField, Badge } from "../components/UI";
import { ItemPicker } from "../components/ItemPicker";
import { useAuth } from "../context/AuthContext";
import { printPurchaseRequest } from "../lib/printDocs";

const PRIORITY_TONE = { low: "neutral", medium: "blue", high: "amber", urgent: "amber" };
const STATUS_TONE = {
  draft: "neutral",
  pending_approval: "amber",
  approved: "green",
  rejected: "neutral",
  returned: "amber",
  converted: "green",
};
const STATUS_LABEL = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  returned: "Returned",
  converted: "Converted to PO",
};

export default function PurchaseRequestPage() {
  const { user } = useAuth();
  const [prs, setPrs] = useState([]);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [flow, setFlow] = useState([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // "form" | "detail" | "convert" | {decide, pr, decision}
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(defaultForm());
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const [comment, setComment] = useState("");
  const [convertLines, setConvertLines] = useState([]);

  const loadAll = () => {
    api.get("/purchase-requests").then((r) => setPrs(r.data));
  };
  useEffect(() => {
    loadAll();
    api.get("/items").then((r) => setItems(r.data));
    api.get("/suppliers").then((r) => setSuppliers(r.data));
    api.get("/pr-config").then((r) => setFlow(r.data.approval_flow || []));
  }, []);

  const openNew = () => {
    setEditingId(null);
    setForm(defaultForm());
    setModal("form");
  };

  const openEdit = (pr) => {
    setEditingId(pr.id);
    setForm({
      department: pr.department || "",
      cost_center: pr.cost_center || "",
      required_delivery_date: pr.required_delivery_date || "",
      project: pr.project || "",
      priority: pr.priority || "medium",
      notes: pr.notes || "",
      items: (pr.items || []).map((l) => ({
        item_id: l.item_id || "",
        sku: l.sku || "",
        name: l.name || "",
        category: l.category || "",
        qty: String(l.qty || 1),
        unit: l.unit || "pcs",
        notes: l.notes || "",
      })),
      attachments: pr.attachments || [],
    });
    setModal("form");
  };

  const setLine = (idx, patch) => {
    const next = [...form.items];
    next[idx] = { ...next[idx], ...patch };
    setForm({ ...form, items: next });
  };
  const addLine = () =>
    setForm({ ...form, items: [...form.items, blankLine()] });
  const removeLine = (idx) =>
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });

  const onPickItem = (idx, id) => {
    const it = items.find((i) => i.id === id);
    if (!it) {
      setLine(idx, { item_id: "", sku: "", name: "", category: "", unit: "" });
      return;
    }
    setLine(idx, {
      item_id: it.id,
      sku: it.sku || "",
      name: it.name || "",
      category: it.category || "",
      unit: it.unit || "pcs",
    });
  };

  const onFilesPicked = async (fileList) => {
    const files = Array.from(fileList).slice(0, 5 - (form.attachments?.length || 0));
    const readOne = (f) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: f.name, size: f.size, data: reader.result });
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });
    const attaches = [];
    for (const f of files) {
      if (f.size > 2 * 1024 * 1024) {
        toast.error(`${f.name} exceeds 2MB limit`);
        continue;
      }
      attaches.push(await readOne(f));
    }
    setForm({ ...form, attachments: [...(form.attachments || []), ...attaches] });
  };

  const removeAttach = (i) =>
    setForm({ ...form, attachments: form.attachments.filter((_, idx) => idx !== i) });

  const save = async (e) => {
    e.preventDefault();
    if (!form.department.trim()) return toast.error("Department is required");
    const clean = form.items.filter((l) => l.name && Number(l.qty) > 0);
    if (clean.length === 0) return toast.error("Add at least 1 item");
    setSaving(true);
    try {
      const payload = {
        department: form.department,
        cost_center: form.cost_center,
        required_delivery_date: form.required_delivery_date || null,
        project: form.project,
        priority: form.priority,
        notes: form.notes,
        items: clean.map((l) => ({
          item_id: l.item_id || null,
          sku: l.sku,
          name: l.name,
          category: l.category,
          qty: Number(l.qty),
          unit: l.unit,
          notes: l.notes,
        })),
        attachments: (form.attachments || []).map((a) => ({
          name: a.name,
          data: a.data,
          size: a.size || 0,
        })),
      };
      if (editingId) {
        await api.put(`/purchase-requests/${editingId}`, payload);
        toast.success("PR updated");
      } else {
        await api.post("/purchase-requests", payload);
        toast.success("PR saved as draft");
      }
      setModal(null);
      setEditingId(null);
      loadAll();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const submit = async (pr) => {
    if (!window.confirm(`Submit ${pr.pr_number} for approval?`)) return;
    try {
      await api.post(`/purchase-requests/${pr.id}/submit`);
      toast.success(`${pr.pr_number} submitted`);
      loadAll();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  const openDetail = async (pr) => {
    const { data } = await api.get(`/purchase-requests/${pr.id}`);
    setDetail(data);
    setModal("detail");
  };

  const openDecide = (pr, decision) => {
    setDetail(pr);
    setComment("");
    setModal({ decide: true, pr, decision });
  };

  const submitDecision = async (e) => {
    e.preventDefault();
    const { pr, decision } = modal;
    if ((decision === "rejected" || decision === "returned") && !comment.trim()) {
      return toast.error("Comment is required");
    }
    setSaving(true);
    try {
      const endpoint =
        decision === "approved" ? "approve" : decision === "rejected" ? "reject" : "return";
      await api.post(`/purchase-requests/${pr.id}/${endpoint}`, { comment });
      toast.success(`${pr.pr_number} ${decision}`);
      setModal(null);
      loadAll();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const openConvert = (pr) => {
    setDetail(pr);
    setConvertLines(
      (pr.items || []).map(() => ({ supplier: "", price: "" }))
    );
    setModal("convert");
  };

  const submitConvert = async (e) => {
    e.preventDefault();
    const missing = convertLines.some((l) => !l.supplier || Number(l.price) <= 0);
    if (missing) return toast.error("Every line needs a supplier and price > 0");
    setSaving(true);
    try {
      const payload = {
        lines: convertLines.map((l, idx) => ({
          line_index: idx,
          supplier: l.supplier,
          price: Number(l.price),
        })),
      };
      const { data } = await api.post(`/purchase-requests/${detail.id}/convert`, payload);
      toast.success(`Generated ${data.count} PO(s)`);
      setModal(null);
      loadAll();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const doPrint = (pr) => printPurchaseRequest(pr);

  const currentApproverRole = (pr) => {
    const f = pr.approval_flow || [];
    const lvl = pr.current_level || 0;
    return f[lvl] || null;
  };

  const canApprove = (pr) => {
    if (pr.status !== "pending_approval") return false;
    const role = currentApproverRole(pr);
    return user?.role === role || user?.role === "admin";
  };
  const canEditPr = (pr) =>
    (pr.status === "draft" || pr.status === "returned") &&
    (pr.requester_username === user?.username || user?.role === "admin");
  const canSubmit = (pr) =>
    (pr.status === "draft" || pr.status === "returned") &&
    (pr.requester_username === user?.username || user?.role === "admin");
  const canConvert = (pr) =>
    pr.status === "approved" && ["admin", "purchasing"].includes(user?.role);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prs;
    return prs.filter(
      (p) =>
        p.pr_number.toLowerCase().includes(q) ||
        (p.requester_name || "").toLowerCase().includes(q) ||
        (p.department || "").toLowerCase().includes(q) ||
        (p.status || "").toLowerCase().includes(q)
    );
  }, [prs, search]);

  return (
    <>
      <PageIntro
        eyebrow="Procurement · request"
        title="Purchase requests"
        subtitle={`Approval flow: ${flow.length ? flow.map((r) => r.toUpperCase()).join(" → ") : "not configured"}`}
        testid="pr-title"
        action={
          <div className="action-cluster">
            <button data-testid="create-pr-button" className="primary-button" onClick={openNew}>
              <Plus size={17} /> New PR
            </button>
          </div>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              data-testid="pr-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by PR#, requester, department, status..."
            />
          </div>
        </div>
        <PanelHead title="PR list" detail={`${filtered.length} record(s)`} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PR#</th>
                <th>Requester</th>
                <th>Department</th>
                <th>Items</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Requested</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 40 }}>
                    No purchase requests yet.
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id} data-testid={`pr-row-${p.id}`}>
                  <td>
                    <button className="text-button" onClick={() => openDetail(p)} data-testid={`pr-open-${p.id}`}>
                      <strong>{p.pr_number}</strong>
                    </button>
                  </td>
                  <td>{p.requester_name}<small>{p.requester_username}</small></td>
                  <td>{p.department}</td>
                  <td>{p.items?.length || 0}</td>
                  <td><Badge tone={PRIORITY_TONE[p.priority]}>{p.priority}</Badge></td>
                  <td>
                    <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status] || p.status}</Badge>
                    {p.status === "pending_approval" && (
                      <small>Waiting: <b>{currentApproverRole(p)}</b></small>
                    )}
                  </td>
                  <td><small>{formatDate(p.request_date)}</small></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {canSubmit(p) && (
                      <button data-testid={`pr-submit-${p.id}`} className="small-button success" onClick={() => submit(p)}>
                        <Send size={12} /> Submit
                      </button>
                    )}
                    {canEditPr(p) && (
                      <button data-testid={`pr-edit-${p.id}`} className="small-button" style={{ marginLeft: 6 }} onClick={() => openEdit(p)}>
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                    {canApprove(p) && (
                      <>
                        <button data-testid={`pr-approve-${p.id}`} className="small-button success" style={{ marginLeft: 6 }} onClick={() => openDecide(p, "approved")}>
                          <Check size={12} /> Approve
                        </button>
                        <button data-testid={`pr-return-${p.id}`} className="small-button" style={{ marginLeft: 6 }} onClick={() => openDecide(p, "returned")}>
                          <RotateCcw size={12} /> Return
                        </button>
                        <button data-testid={`pr-reject-${p.id}`} className="small-button" style={{ marginLeft: 6 }} onClick={() => openDecide(p, "rejected")}>
                          <X size={12} /> Reject
                        </button>
                      </>
                    )}
                    {canConvert(p) && (
                      <button data-testid={`pr-convert-${p.id}`} className="small-button success" style={{ marginLeft: 6 }} onClick={() => openConvert(p)}>
                        <Layers size={12} /> To PO
                      </button>
                    )}
                    <button data-testid={`pr-print-${p.id}`} className="small-button" style={{ marginLeft: 6 }} onClick={() => doPrint(p)} title="Print">
                      <Printer size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal === "form" && (
        <Modal
          title={editingId ? "Edit purchase request" : "New purchase request"}
          onClose={() => { setModal(null); setEditingId(null); }}
        >
          <form className="form-grid" onSubmit={save}>
            <Field label="Department" testid="pr-department-input" value={form.department} onChange={(v) => setForm({ ...form, department: v })} placeholder="e.g. Kitchen, F&B, Housekeeping" required />
            <Field label="Cost center" testid="pr-cost-center-input" value={form.cost_center} onChange={(v) => setForm({ ...form, cost_center: v })} placeholder="CC-KITCHEN-01" />
            <Field label="Required delivery date" testid="pr-delivery-date-input" type="date" value={form.required_delivery_date} onChange={(v) => setForm({ ...form, required_delivery_date: v })} />
            <Field label="Project / Vessel / Location" testid="pr-project-input" value={form.project} onChange={(v) => setForm({ ...form, project: v })} placeholder="e.g. Beach House renovation" />
            <SelectField label="Priority" testid="pr-priority-select" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} options={["low", "medium", "high", "urgent"]} />
            <label className="field" style={{ gridColumn: "1/-1" }}>
              <span>Remarks / Notes</span>
              <textarea data-testid="pr-notes-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Reason for request, specifications..." rows={2} />
            </label>

            <div style={{ gridColumn: "1/-1" }}>
              <p className="eyebrow">Line items</p>
              <div className="line-editor">
                {form.items.map((l, idx) => (
                  <div className="line-row" key={idx} style={{ gridTemplateColumns: "2fr 90px 90px 1fr 36px" }}>
                    <ItemPicker
                      items={items}
                      value={l.item_id}
                      onChange={(id) => onPickItem(idx, id)}
                      testid={`pr-line-item-${idx}`}
                      placeholder="Search item, or type name below to request new..."
                    />
                    <input
                      data-testid={`pr-line-qty-${idx}`}
                      type="number"
                      min="0"
                      value={l.qty}
                      onChange={(e) => setLine(idx, { qty: e.target.value })}
                      placeholder="Qty"
                    />
                    <input
                      data-testid={`pr-line-unit-${idx}`}
                      value={l.unit}
                      onChange={(e) => setLine(idx, { unit: e.target.value })}
                      placeholder="Unit"
                    />
                    <input
                      data-testid={`pr-line-name-${idx}`}
                      value={l.name}
                      onChange={(e) => setLine(idx, { name: e.target.value })}
                      placeholder="Item description (auto from picker)"
                    />
                    <button type="button" className="icon-button" onClick={() => removeLine(idx)} data-testid={`pr-line-remove-${idx}`}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" data-testid="pr-add-line" className="chip small" onClick={addLine}>
                  <Plus size={12} /> Add item
                </button>
              </div>
            </div>

            <div style={{ gridColumn: "1/-1" }}>
              <p className="eyebrow">Attachments (max 5, ≤ 2MB each)</p>
              <label className="attach-drop" data-testid="pr-attach-drop">
                <FileText size={16} /> Choose files (quotation, spec, images)
                <input
                  type="file"
                  multiple
                  hidden
                  data-testid="pr-attach-input"
                  onChange={(e) => onFilesPicked(e.target.files)}
                />
              </label>
              {form.attachments?.length > 0 && (
                <ul className="attach-list">
                  {form.attachments.map((a, i) => (
                    <li key={i} data-testid={`pr-attach-item-${i}`}>
                      <FileText size={14} /> {a.name}
                      <small>{Math.round((a.size || 0) / 1024)} KB</small>
                      <button type="button" className="icon-button" onClick={() => removeAttach(i)}>
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => { setModal(null); setEditingId(null); }}>Cancel</button>
              <button data-testid="pr-save-button" className="primary-button" type="submit" disabled={saving}>
                <Check size={16} /> {saving ? "Saving..." : editingId ? "Update PR" : "Save draft"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "detail" && detail && (
        <Modal title={`PR ${detail.pr_number}`} onClose={() => setModal(null)}>
          <PRDetailView pr={detail} flow={flow} />
        </Modal>
      )}

      {modal && typeof modal === "object" && modal.decide && (
        <Modal
          title={`${modal.decision === "approved" ? "Approve" : modal.decision === "rejected" ? "Reject" : "Return"} ${modal.pr.pr_number}`}
          onClose={() => setModal(null)}
        >
          <form className="form-grid" onSubmit={submitDecision}>
            <p className="form-hint" style={{ gridColumn: "1/-1" }}>
              {modal.decision === "approved"
                ? "Optional comment — will be visible in the PR history."
                : modal.decision === "rejected"
                ? "Rejection is final. Please explain why."
                : "Returning sends the PR back to the requester for revision."}
            </p>
            <label className="field" style={{ gridColumn: "1/-1" }}>
              <span>Comment{modal.decision !== "approved" ? " (required)" : ""}</span>
              <textarea
                data-testid="pr-decide-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add remarks..."
                rows={4}
                autoFocus
                required={modal.decision !== "approved"}
              />
            </label>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button>
              <button
                data-testid="pr-decide-confirm"
                type="submit"
                disabled={saving}
                className={`primary-button ${modal.decision === "rejected" ? "danger" : ""}`}
              >
                {saving ? "Processing..." : `Confirm ${modal.decision}`}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "convert" && detail && (
        <Modal title={`Convert ${detail.pr_number} to PO(s)`} onClose={() => setModal(null)}>
          <form className="form-grid" onSubmit={submitConvert}>
            <p className="form-hint" style={{ gridColumn: "1/-1" }}>
              Assign a supplier and unit price to each line. Lines sharing a supplier are merged into one PO.
            </p>
            <div className="table-wrap" style={{ gridColumn: "1/-1", maxHeight: 400, overflow: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Supplier</th>
                    <th>Unit price (IDR)</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map((it, idx) => (
                    <tr key={idx}>
                      <td>{idx + 1}</td>
                      <td>
                        <strong>{it.name}</strong>
                        {it.sku && <small>SKU {it.sku}</small>}
                      </td>
                      <td>{it.qty} {it.unit}</td>
                      <td>
                        <input
                          list={`convert-supplier-list`}
                          data-testid={`pr-convert-supplier-${idx}`}
                          value={convertLines[idx]?.supplier || ""}
                          onChange={(e) => {
                            const next = [...convertLines];
                            next[idx] = { ...next[idx], supplier: e.target.value };
                            setConvertLines(next);
                          }}
                          placeholder="Vendor name"
                          required
                          style={{ width: "100%", padding: 8, border: "1px solid var(--line)", borderRadius: 5 }}
                        />
                      </td>
                      <td>
                        <input
                          data-testid={`pr-convert-price-${idx}`}
                          type="number"
                          min="0"
                          value={convertLines[idx]?.price || ""}
                          onChange={(e) => {
                            const next = [...convertLines];
                            next[idx] = { ...next[idx], price: e.target.value };
                            setConvertLines(next);
                          }}
                          placeholder="0"
                          required
                          style={{ width: 140, padding: 8, border: "1px solid var(--line)", borderRadius: 5 }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="convert-supplier-list">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button>
              <button data-testid="pr-convert-confirm" type="submit" disabled={saving} className="primary-button">
                <Layers size={16} /> {saving ? "Generating..." : "Generate PO(s)"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function PRDetailView({ pr, flow }) {
  const currentApprover = (pr.approval_flow || [])[pr.current_level || 0];
  return (
    <div className="pr-detail">
      <div className="pr-header-grid">
        <div><span className="lbl">Requester</span><strong>{pr.requester_name}</strong><small>@{pr.requester_username}</small></div>
        <div><span className="lbl">Requested</span><strong>{formatDate(pr.request_date)}</strong></div>
        <div><span className="lbl">Department</span><strong>{pr.department}</strong></div>
        <div><span className="lbl">Cost center</span><strong>{pr.cost_center || "-"}</strong></div>
        <div><span className="lbl">Required by</span><strong>{pr.required_delivery_date || "-"}</strong></div>
        <div><span className="lbl">Project</span><strong>{pr.project || "-"}</strong></div>
        <div><span className="lbl">Priority</span><Badge tone={PRIORITY_TONE[pr.priority]}>{pr.priority}</Badge></div>
        <div><span className="lbl">Status</span><Badge tone={STATUS_TONE[pr.status]}>{STATUS_LABEL[pr.status]}</Badge></div>
      </div>
      {pr.notes && (
        <div className="pr-notes">
          <span className="lbl">Remarks</span>
          <p>{pr.notes}</p>
        </div>
      )}
      <p className="eyebrow" style={{ marginTop: 16 }}>Line items</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>SKU</th><th>Item</th><th>Category</th><th>Qty</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {(pr.items || []).map((it, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{it.sku || "-"}</td>
                <td><strong>{it.name}</strong></td>
                <td>{it.category || "-"}</td>
                <td>{it.qty} {it.unit}</td>
                <td><small>{it.notes || "-"}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="eyebrow" style={{ marginTop: 16 }}>
        Approval flow — {(pr.approval_flow || flow).map((r) => r.toUpperCase()).join(" → ")}
        {pr.status === "pending_approval" && currentApprover && <span> · <b>waiting on {currentApprover}</b></span>}
      </p>
      <ul className="approval-list">
        {(pr.approvals || []).map((a, i) => (
          <li key={i} data-testid={`pr-approval-log-${i}`}>
            <Badge tone={a.decision === "approved" ? "green" : a.decision === "rejected" ? "neutral" : "amber"}>
              {a.decision}
            </Badge>
            <div>
              <strong>Level {a.level + 1} · {a.role}</strong>
              <small>{a.decided_by} · {formatDate(a.decided_at)}</small>
              {a.comment && <p>“{a.comment}”</p>}
            </div>
          </li>
        ))}
        {(pr.approvals || []).length === 0 && <li className="empty">No approvals yet.</li>}
      </ul>

      {pr.attachments && pr.attachments.length > 0 && (
        <>
          <p className="eyebrow" style={{ marginTop: 16 }}>Attachments</p>
          <ul className="attach-list">
            {pr.attachments.map((a, i) => (
              <li key={i}>
                <FileText size={14} />
                <a href={a.data} download={a.name} target="_blank" rel="noreferrer">{a.name}</a>
                <small>{Math.round((a.size || 0) / 1024)} KB</small>
              </li>
            ))}
          </ul>
        </>
      )}

      {pr.status === "converted" && (pr.converted_po_ids || []).length > 0 && (
        <p className="form-hint" style={{ marginTop: 12 }}>
          Converted into {pr.converted_po_ids.length} PO(s). Check the Purchase Order module.
        </p>
      )}
    </div>
  );
}

function blankLine() {
  return { item_id: "", sku: "", name: "", category: "", qty: "1", unit: "pcs", notes: "" };
}

function defaultForm() {
  return {
    department: "",
    cost_center: "",
    required_delivery_date: "",
    project: "",
    priority: "medium",
    notes: "",
    items: [blankLine()],
    attachments: [],
  };
}
