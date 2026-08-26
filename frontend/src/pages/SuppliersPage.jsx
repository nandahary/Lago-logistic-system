import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Check, Trash2, Search, Pencil, Upload } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { PageIntro, PanelHead, Modal, Field, Badge } from "../components/UI";
import { BulkUploadDialog } from "../components/BulkUpload";
import { useAuth } from "../context/AuthContext";

const TEMPLATE = {
  headers: ["name", "contact_person", "phone", "email", "address", "lead_time_days", "payment_terms", "code", "notes"],
  example: [
    ["PT Contoh Vendor", "Bapak Andi", "0811-1234-567", "andi@vendor.co.id", "Jl. Sunset Rd No.1, Kuta", "2", "Net 14", "", ""],
    ["CV Fresh Bahari", "Ibu Made", "0812-9876-543", "made@freshbahari.id", "Pelabuhan Benoa, Denpasar", "1", "COD", "", "Ikan & seafood"],
  ],
};

export default function SuppliersPage() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // {mode:"new"|"edit", data:{}}
  const [form, setForm] = useState(defaultForm());
  const [saving, setSaving] = useState(false);

  const canEdit = ["admin", "purchasing"].includes(user?.role);
  const canDelete = user?.role === "admin";

  const load = () => {
    const params = search ? { search } : {};
    api.get("/suppliers", { params }).then((r) => setList(r.data));
  };
  useEffect(load, [search]);

  const openNew = () => {
    setForm(defaultForm());
    setModal({ mode: "new" });
  };
  const openEdit = (s) => {
    setForm({
      code: s.code,
      name: s.name,
      contact_person: s.contact_person || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
      lead_time_days: String(s.lead_time_days ?? 0),
      payment_terms: s.payment_terms || "",
      notes: s.notes || "",
      id: s.id,
    });
    setModal({ mode: "edit", data: s });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name) return toast.error("Nama supplier wajib diisi");
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        contact_person: form.contact_person,
        phone: form.phone,
        email: form.email,
        address: form.address,
        lead_time_days: Number(form.lead_time_days || 0),
        payment_terms: form.payment_terms,
        notes: form.notes,
      };
      if (modal.mode === "edit") {
        await api.patch(`/suppliers/${form.id}`, payload);
        toast.success("Supplier diperbarui");
      } else {
        if (form.code) payload.code = form.code;
        await api.post("/suppliers", payload);
        toast.success("Supplier ditambahkan");
      }
      setModal(null);
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`Hapus supplier ${s.name}?`)) return;
    try {
      await api.delete(`/suppliers/${s.id}`);
      toast.success("Supplier dihapus");
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Master · vendor"
        title="Katalog supplier"
        subtitle="Data supplier terpusat: kontak, lead time, dan payment terms untuk mempermudah pembuatan PO."
        testid="suppliers-title"
        action={
          canEdit && (
            <div className="action-cluster">
              <button
                data-testid="supplier-upload-button"
                className="secondary-button"
                onClick={() => setModal({ mode: "upload" })}
              >
                <Upload size={16} /> Upload CSV
              </button>
              <button
                data-testid="supplier-add-button"
                className="primary-button"
                onClick={openNew}
              >
                <Plus size={17} /> Tambah supplier
              </button>
            </div>
          )
        }
      />
      <section className="panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              data-testid="supplier-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau kode supplier..."
            />
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Kontak</th>
                <th>Telepon</th>
                <th>Email</th>
                <th>Lead time</th>
                <th>Term bayar</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 40 }}>Belum ada supplier.</td></tr>
              )}
              {list.map((s) => (
                <tr key={s.id} data-testid={`supplier-row-${s.id}`}>
                  <td>
                    <strong>{s.name}</strong>
                    <small><Badge tone="neutral">{s.code}</Badge></small>
                  </td>
                  <td>{s.contact_person || "-"}</td>
                  <td>{s.phone || "-"}</td>
                  <td>{s.email || "-"}</td>
                  <td>
                    {s.lead_time_days > 0 ? (
                      <Badge tone={s.lead_time_days <= 2 ? "green" : "amber"}>
                        {s.lead_time_days} hari
                      </Badge>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{s.payment_terms || "-"}</td>
                  <td style={{ textAlign: "right" }}>
                    {canEdit && (
                      <button
                        data-testid={`supplier-edit-${s.id}`}
                        className="small-button"
                        onClick={() => openEdit(s)}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                    )}
                    {canDelete && (
                      <button
                        data-testid={`supplier-delete-${s.id}`}
                        className="small-button"
                        style={{ marginLeft: 6 }}
                        onClick={() => remove(s)}
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

      {modal && modal.mode === "upload" && (
        <BulkUploadDialog
          title="Upload katalog supplier (CSV)"
          endpoint="/suppliers/bulk-upload"
          templateName="supplier_template.csv"
          templateHeaders={TEMPLATE.headers}
          templateExample={TEMPLATE.example}
          instructions={
            <>
              Kolom <b>name</b> wajib. Jika kolom <b>code</b> disertakan dan sudah ada, data
              supplier akan di-update. <b>lead_time_days</b> berupa angka (hari).
            </>
          }
          onClose={() => setModal(null)}
          onSuccess={load}
          testid="supplier-upload"
        />
      )}

      {modal && modal.mode !== "upload" && (
        <Modal
          title={modal.mode === "edit" ? "Edit supplier" : "Tambah supplier"}
          onClose={() => setModal(null)}
        >
          <form className="form-grid" onSubmit={submit}>
            <Field label="Nama supplier" testid="supplier-name-input" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="PT Boga Utama" />
            <Field label="Kode (opsional)" testid="supplier-code-input" value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="Auto-generate" />
            <Field label="Contact person" testid="supplier-contact-input" value={form.contact_person} onChange={(v) => setForm({ ...form, contact_person: v })} placeholder="Bapak Andi" />
            <Field label="Telepon" testid="supplier-phone-input" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="0811-1234-567" />
            <Field label="Email" testid="supplier-email-input" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="contact@vendor.co.id" />
            <Field label="Lead time (hari)" testid="supplier-lead-input" type="number" value={form.lead_time_days} onChange={(v) => setForm({ ...form, lead_time_days: v })} />
            <Field label="Payment terms" testid="supplier-terms-input" value={form.payment_terms} onChange={(v) => setForm({ ...form, payment_terms: v })} placeholder="Net 14, COD, dsb" />
            <label className="field" style={{ gridColumn: "1/-1" }}>
              <span>Alamat</span>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Jl. Sunset Rd No. 88, Kuta, Bali" />
            </label>
            <label className="field" style={{ gridColumn: "1/-1" }}>
              <span>Catatan</span>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Info tambahan" />
            </label>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>Batal</button>
              <button
                data-testid="supplier-save-button"
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
    code: "",
    name: "",
    contact_person: "",
    phone: "",
    email: "",
    address: "",
    lead_time_days: "0",
    payment_terms: "Net 14",
    notes: "",
  };
}
