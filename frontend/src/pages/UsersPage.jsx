import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Check, Trash2, Pencil, Shield, Search, RotateCcw } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { formatDate, roleLabels } from "../lib/format";
import { PageIntro, PanelHead, Modal, Field, SelectField, Badge } from "../components/UI";
import { useAuth } from "../context/AuthContext";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin — full access" },
  { value: "purchasing", label: "Purchasing — create PO" },
  { value: "warehouse", label: "Warehouse — receive, issue, opname" },
  { value: "finance", label: "Finance — approve, revenue, flash cost" },
  { value: "requestor", label: "Requestor — submit & track own purchase requests only" },
];

const roleTone = {
  admin: "amber",
  purchasing: "blue",
  warehouse: "green",
  finance: "neutral",
  requestor: "blue",
};

export default function UsersPage() {
  const { user: current } = useAuth();
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // { mode: "new" | "edit", user }
  const [form, setForm] = useState(defaultForm());
  const [saving, setSaving] = useState(false);
  const [prFlow, setPrFlow] = useState([]);
  const [prFlowDraft, setPrFlowDraft] = useState("");

  const load = () => api.get("/users").then((r) => setList(r.data));
  const loadFlow = () =>
    api.get("/pr-config").then((r) => {
      setPrFlow(r.data.approval_flow || []);
      setPrFlowDraft((r.data.approval_flow || []).join(","));
    });
  useEffect(() => {
    load();
    loadFlow();
  }, []);

  const savePrFlow = async () => {
    const roles = prFlowDraft
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (roles.length === 0) return toast.error("At least one role is required");
    try {
      const { data } = await api.put("/pr-config", { approval_flow: roles });
      setPrFlow(data.approval_flow);
      toast.success("PR approval flow updated");
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  const openNew = () => {
    setForm(defaultForm());
    setModal({ mode: "new" });
  };
  const openEdit = (u) => {
    setForm({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      password: "",
    });
    setModal({ mode: "edit" });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.role) return toast.error("Name and role are required");
    if (modal.mode === "new" && (!form.username || !form.password))
      return toast.error("Username and password are required");
    if (modal.mode === "new" && form.password.length < 6)
      return toast.error("Password must be at least 6 characters");
    setSaving(true);
    try {
      if (modal.mode === "new") {
        await api.post("/auth/register", {
          username: form.username,
          password: form.password,
          name: form.name,
          role: form.role,
        });
        toast.success(`User ${form.username} added`);
      } else {
        const payload = { name: form.name, role: form.role };
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${form.id}`, payload);
        toast.success("User updated");
      }
      setModal(null);
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete user ${u.username}?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("User deleted");
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  const filtered = list.filter((u) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      (u.username || "").toLowerCase().includes(q) ||
      (u.name || "").toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  const resetTransactions = async () => {
    if (
      !window.confirm(
        "Delete ALL transactions (PO, GRN, Stock out, Opname, Revenue, Recipes) and reset item stock to seed values? Master data (users, outlets, suppliers) will remain. This action cannot be undone."
      )
    )
      return;
    try {
      const { data } = await api.post("/admin/reset-transactions");
      const d = data.deleted;
      toast.success(
        `Reset complete: ${d.purchase_orders} PO · ${d.receivings} GRN · ${d.issues} issues · ${d.opnames} opname · ${d.revenues} revenue · ${d.recipes} recipes deleted. Stock items reset.`
      );
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Administration · access & security"
        title="User management"
        subtitle="Manage operational accounts and role-based access."
        testid="users-title"
        action={
          <div className="action-cluster">
            <button
              data-testid="reset-transactions-button"
              className="secondary-button"
              onClick={resetTransactions}
              title="Delete all transactions & reset stock"
            >
              <RotateCcw size={16} /> Reset transactions
            </button>
            <button data-testid="user-add-button" className="primary-button" onClick={openNew}>
              <Plus size={17} /> Add user
            </button>
          </div>
        }
      />
      {current?.role === "admin" && (
      <section className="panel" data-testid="pr-config-panel">
        <PanelHead
          title="Purchase Request approval flow"
          detail="Configure the sequence of roles required to approve a PR"
        />
        <div className="pr-config-row">
          <div>
            <p className="eyebrow">Current flow</p>
            <p className="flow-preview">
              Requester → {(prFlow.length ? prFlow : ["—"]).map((r) => r.toUpperCase()).join(" → ")}
            </p>
          </div>
          <div style={{ flex: 1 }}>
            <label className="field">
              <span>Roles (comma separated) — allowed: admin, purchasing, warehouse, finance</span>
              <input
                data-testid="pr-flow-input"
                value={prFlowDraft}
                onChange={(e) => setPrFlowDraft(e.target.value)}
                placeholder="finance"
              />
            </label>
          </div>
          <button data-testid="pr-flow-save" className="primary-button" onClick={savePrFlow}>
            <Check size={14} /> Update flow
          </button>
        </div>
      </section>
      )}
      <section className="panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              data-testid="user-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, username, or role..."
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Created</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 40 }}>
                    No users yet.
                  </td>
                </tr>
              )}
              {filtered.map((u) => (
                <tr key={u.id} data-testid={`user-row-${u.id}`}>
                  <td>
                    <strong>{u.name}</strong>
                    {u.id === current?.id && <small>(You)</small>}
                  </td>
                  <td><code>{u.username}</code></td>
                  <td>
                    <Badge tone={roleTone[u.role] || "neutral"}>
                      <Shield size={10} style={{ marginRight: 4, verticalAlign: "middle" }} />
                      {roleLabels[u.role] || u.role}
                    </Badge>
                  </td>
                  <td>
                    <small>{formatDate(u.created_at)}</small>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      data-testid={`user-edit-${u.id}`}
                      className="small-button"
                      onClick={() => openEdit(u)}
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    {u.id !== current?.id && (
                      <button
                        data-testid={`user-delete-${u.id}`}
                        className="small-button"
                        style={{ marginLeft: 6 }}
                        onClick={() => remove(u)}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <Modal
          title={modal.mode === "edit" ? "Edit user" : "Add new user"}
          onClose={() => setModal(null)}
        >
          <form className="form-grid" onSubmit={submit}>
            <Field
              label="Full name"
              testid="user-name-input"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              placeholder="User name"
            />
            <Field
              label={modal.mode === "edit" ? "Username (cannot be changed)" : "Username"}
              testid="user-username-input"
              type="text"
              value={form.username}
              onChange={(v) => setForm({ ...form, username: v })}
              placeholder="e.g. rina, budi.k, ops01"
              disabled={modal.mode === "edit"}
            />
            <SelectField
              label="Role"
              testid="user-role-select"
              value={form.role}
              onChange={(v) => setForm({ ...form, role: v })}
              options={ROLE_OPTIONS}
            />
            <Field
              label={modal.mode === "edit" ? "New password (optional)" : "Password"}
              testid="user-password-input"
              type="password"
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              placeholder={modal.mode === "edit" ? "Leave empty to keep current" : "Min. 6 characters"}
            />
            <div className="role-hint" style={{ gridColumn: "1/-1" }}>
              <p className="eyebrow">Role permissions</p>
              <ul>
                <li><b>Admin</b>: all modules, manage users & suppliers</li>
                <li><b>Purchasing</b>: create/edit Purchase Orders, manage suppliers</li>
                <li><b>Warehouse</b>: receive goods, record issues, stock opname</li>
                <li><b>Finance</b>: approve PO/opname, input revenue, monitor flash cost</li>
                <li><b>Requestor</b>: Purchase Request module only — submit requests and track the status of their own requests</li>
              </ul>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                data-testid="user-save-button"
                className="primary-button"
                type="submit"
                disabled={saving}
              >
                <Check size={16} /> {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function defaultForm() {
  return {
    username: "",
    name: "",
    role: "warehouse",
    password: "",
  };
}
