import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Check, Trash2, Pencil, Shield, Search, RotateCcw } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { formatDate, roleLabels } from "../lib/format";
import { PageIntro, PanelHead, Modal, Field, SelectField, Badge } from "../components/UI";
import { useAuth } from "../context/AuthContext";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin — akses penuh" },
  { value: "purchasing", label: "Purchasing — buat PO" },
  { value: "warehouse", label: "Gudang — terima, keluar, opname" },
  { value: "finance", label: "Finance — approve, revenue, flash cost" },
];

const roleTone = {
  admin: "amber",
  purchasing: "blue",
  warehouse: "green",
  finance: "neutral",
};

export default function UsersPage() {
  const { user: current } = useAuth();
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // { mode: "new" | "edit", user }
  const [form, setForm] = useState(defaultForm());
  const [saving, setSaving] = useState(false);

  const load = () => api.get("/users").then((r) => setList(r.data));
  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setForm(defaultForm());
    setModal({ mode: "new" });
  };
  const openEdit = (u) => {
    setForm({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      password: "",
    });
    setModal({ mode: "edit" });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.role) return toast.error("Nama dan role wajib diisi");
    if (modal.mode === "new" && (!form.email || !form.password))
      return toast.error("Email dan password wajib diisi");
    if (modal.mode === "new" && form.password.length < 6)
      return toast.error("Password minimal 6 karakter");
    setSaving(true);
    try {
      if (modal.mode === "new") {
        await api.post("/auth/register", {
          email: form.email,
          password: form.password,
          name: form.name,
          role: form.role,
        });
        toast.success(`User ${form.email} ditambahkan`);
      } else {
        const payload = { name: form.name, role: form.role };
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${form.id}`, payload);
        toast.success("User diperbarui");
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
    if (!window.confirm(`Hapus user ${u.email}?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("User dihapus");
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  const filtered = list.filter((u) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      (u.name || "").toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  const resetTransactions = async () => {
    if (
      !window.confirm(
        "Hapus SEMUA transaksi (PO, GRN, Barang keluar, Opname, Revenue, Resep) dan reset stok item ke nilai seed? Master data (user, outlet, supplier) tetap. Aksi ini tidak dapat dibatalkan."
      )
    )
      return;
    try {
      const { data } = await api.post("/admin/reset-transactions");
      const d = data.deleted;
      toast.success(
        `Reset selesai: ${d.purchase_orders} PO · ${d.receivings} GRN · ${d.issues} issue · ${d.opnames} opname · ${d.revenues} revenue · ${d.recipes} resep dihapus. Stok items direset.`
      );
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Administrasi · akses & keamanan"
        title="Manajemen user"
        subtitle="Kelola akun operasional dan atur hak akses per role."
        testid="users-title"
        action={
          <div className="action-cluster">
            <button
              data-testid="reset-transactions-button"
              className="secondary-button"
              onClick={resetTransactions}
              title="Hapus semua transaksi & reset stok"
            >
              <RotateCcw size={16} /> Reset transaksi
            </button>
            <button data-testid="user-add-button" className="primary-button" onClick={openNew}>
              <Plus size={17} /> Tambah user
            </button>
          </div>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              data-testid="user-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, email, atau role..."
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Email</th>
                <th>Role</th>
                <th>Dibuat</th>
                <th style={{ textAlign: "right" }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 40 }}>
                    Belum ada user.
                  </td>
                </tr>
              )}
              {filtered.map((u) => (
                <tr key={u.id} data-testid={`user-row-${u.id}`}>
                  <td>
                    <strong>{u.name}</strong>
                    {u.id === current?.id && <small>(Anda)</small>}
                  </td>
                  <td>{u.email}</td>
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
          title={modal.mode === "edit" ? "Edit user" : "Tambah user baru"}
          onClose={() => setModal(null)}
        >
          <form className="form-grid" onSubmit={submit}>
            <Field
              label="Nama lengkap"
              testid="user-name-input"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              placeholder="Nama pengguna"
            />
            <Field
              label={modal.mode === "edit" ? "Email (tidak bisa diubah)" : "Email"}
              testid="user-email-input"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              placeholder="user@lagobali.id"
            />
            <SelectField
              label="Role"
              testid="user-role-select"
              value={form.role}
              onChange={(v) => setForm({ ...form, role: v })}
              options={ROLE_OPTIONS}
            />
            <Field
              label={modal.mode === "edit" ? "Password baru (opsional)" : "Password"}
              testid="user-password-input"
              type="password"
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              placeholder={modal.mode === "edit" ? "Kosongkan bila tidak diubah" : "Min. 6 karakter"}
            />
            <div className="role-hint" style={{ gridColumn: "1/-1" }}>
              <p className="eyebrow">Hak akses per role</p>
              <ul>
                <li><b>Admin</b>: semua modul, kelola user & supplier</li>
                <li><b>Purchasing</b>: buat/edit Purchase Order, kelola supplier</li>
                <li><b>Gudang</b>: terima barang, catat pengeluaran, stock opname</li>
                <li><b>Finance</b>: approve PO/opname, input revenue, monitor flash cost</li>
              </ul>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>
                Batal
              </button>
              <button
                data-testid="user-save-button"
                className="primary-button"
                type="submit"
                disabled={saving}
              >
                <Check size={16} /> {saving ? "Menyimpan..." : "Simpan"}
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
    email: "",
    name: "",
    role: "warehouse",
    password: "",
  };
}
