import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Upload, Trash2, Check, X } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { money, outletNames, statusLabels, statusTone, formatDate } from "../lib/format";
import { useOutlets } from "../lib/useOutlets";
import { PageIntro, PanelHead, Modal, Field, SelectField, Badge } from "../components/UI";
import { BulkUploadDialog } from "../components/BulkUpload";
import { useAuth } from "../context/AuthContext";

const TEMPLATE = {
  headers: ["po_ref", "supplier", "outlet_code", "item_sku", "qty", "price", "notes"],
  example: [
    ["A1", "PT Boga Utama", "kitchen", "INV-0001", "20", "185000", "Restock mingguan"],
    ["A1", "PT Boga Utama", "kitchen", "INV-0006", "10", "220000", ""],
    ["A2", "PT Pernod Ricard", "bar", "INV-0004", "12", "450000", ""],
  ],
};

export default function OrdersPage() {
  const { user } = useAuth();
  const outletsList = useOutlets();
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [modal, setModal] = useState(null); // "new" | "upload"
  const [supplierId, setSupplierId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [outletCode, setOutletCode] = useState("kitchen");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ item_id: "", qty: "1", price: "0" }]);
  const [saving, setSaving] = useState(false);

  const load = () => api.get("/orders").then((r) => setOrders(r.data));
  useEffect(() => {
    load();
    api.get("/items").then((r) => setItems(r.data));
    api.get("/suppliers").then((r) => setSuppliers(r.data));
  }, []);

  const canCreate = ["admin", "purchasing"].includes(user?.role);
  const canApprove = ["admin", "finance"].includes(user?.role);

  const openNew = () => {
    setSupplierId("");
    setSupplier("");
    setOutletCode("kitchen");
    setNotes("");
    setLines([{ item_id: "", qty: "1", price: "0" }]);
    setModal("new");
  };

  const onPickSupplier = (id) => {
    setSupplierId(id);
    const s = suppliers.find((x) => x.id === id);
    if (s) setSupplier(s.name);
  };

  const addLine = () => setLines([...lines, { item_id: "", qty: "1", price: "0" }]);
  const removeLine = (idx) => setLines(lines.filter((_, i) => i !== idx));
  const updateLine = (idx, field, value) => {
    const next = [...lines];
    next[idx] = { ...next[idx], [field]: value };
    if (field === "item_id") {
      const it = items.find((i) => i.id === value);
      if (it) next[idx].price = String(it.cost);
    }
    setLines(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!supplier) return toast.error("Supplier wajib diisi");
    const cleanLines = lines.filter((l) => l.item_id && Number(l.qty) > 0);
    if (cleanLines.length === 0) return toast.error("Tambahkan minimal 1 item");
    setSaving(true);
    try {
      const payload = {
        supplier,
        outlet_code: outletCode,
        notes,
        items: cleanLines.map((l) => {
          const it = items.find((i) => i.id === l.item_id);
          return {
            item_id: l.item_id,
            name: it.name,
            qty: Number(l.qty),
            unit: it.unit,
            price: Number(l.price),
          };
        }),
      };
      await api.post("/orders", payload);
      toast.success("PO berhasil dibuat");
      setModal(null);
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const approve = async (id) => {
    try {
      await api.post(`/orders/${id}/approve`);
      toast.success("PO disetujui");
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  const cancel = async (id) => {
    if (!window.confirm("Batalkan PO ini?")) return;
    try {
      await api.post(`/orders/${id}/cancel`);
      toast.success("PO dibatalkan");
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  const linesTotal = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0);

  return (
    <>
      <PageIntro
        eyebrow="Procurement · workflow"
        title="Purchase order"
        subtitle="Pantau pengadaan dari permintaan sampai barang diterima."
        testid="orders-title"
        action={
          <div className="action-cluster">
            {canCreate && (
              <button
                data-testid="orders-upload-button"
                className="secondary-button"
                onClick={() => setModal("upload")}
              >
                <Upload size={16} /> Upload CSV
              </button>
            )}
            {canCreate && (
              <button
                data-testid="create-po-button"
                className="primary-button"
                onClick={openNew}
              >
                <Plus size={17} /> Buat PO baru
              </button>
            )}
          </div>
        }
      />
      <section className="panel">
        <PanelHead title="Daftar purchase order" detail={`${orders.length} PO tercatat`} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>No. PO</th>
                <th>Supplier</th>
                <th>Outlet</th>
                <th>Item</th>
                <th>Total</th>
                <th>Status</th>
                <th>Dibuat</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 40 }}>Belum ada PO.</td></tr>
              )}
              {orders.map((o) => {
                const totalQty = o.items.reduce((s, l) => s + Number(l.qty), 0);
                const recvQty = o.items.reduce((s, l) => s + Number(l.received_qty || 0), 0);
                const pct = totalQty > 0 ? Math.round((recvQty / totalQty) * 100) : 0;
                return (
                  <tr key={o.id} data-testid={`po-row-${o.id}`}>
                    <td>
                      <strong>{o.po_number}</strong>
                    </td>
                    <td>{o.supplier}</td>
                    <td>{outletNames[o.outlet_code] || o.outlet_code}</td>
                    <td>
                      {o.items.length} baris
                      {o.status !== "waiting_approval" && o.status !== "cancelled" && (
                        <small>
                          Diterima: {recvQty}/{totalQty} ({pct}%)
                        </small>
                      )}
                    </td>
                    <td><strong>{money(o.total)}</strong></td>
                    <td>
                      <Badge tone={statusTone[o.status]}>{statusLabels[o.status] || o.status}</Badge>
                    </td>
                    <td><small>{formatDate(o.created_at)}</small></td>
                    <td>
                      {o.status === "waiting_approval" && canApprove && (
                        <button
                          data-testid={`approve-${o.id}`}
                          className="small-button success"
                          onClick={() => approve(o.id)}
                        >
                          <Check size={12} /> Approve
                        </button>
                      )}
                      {o.status === "waiting_approval" && canCreate && (
                        <button
                          className="small-button"
                          style={{ marginLeft: 6 }}
                          onClick={() => cancel(o.id)}
                        >
                          <X size={12} /> Batal
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {modal === "new" && (
        <Modal title="Buat purchase order" onClose={() => setModal(null)}>
          <form className="form-grid" onSubmit={submit}>
            <label className="field">
              <span>Supplier</span>
              <select
                data-testid="po-supplier-select"
                value={supplierId}
                onChange={(e) => onPickSupplier(e.target.value)}
              >
                <option value="">-- Pilih dari katalog --</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code}) · lead {s.lead_time_days}d
                  </option>
                ))}
              </select>
            </label>
            <Field label="Atau nama supplier custom" testid="po-supplier-input" value={supplier} onChange={setSupplier} placeholder="PT Boga Utama" />
            <SelectField
              label="Outlet tujuan"
              testid="po-outlet-select"
              value={outletCode}
              onChange={setOutletCode}
              options={outletsList.map((o) => ({ value: o.code, label: o.name }))}
            />
            <label className="field" style={{ gridColumn: "1/-1" }}>
              <span>Catatan (opsional)</span>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Restock mingguan..." />
            </label>
            <div style={{ gridColumn: "1/-1" }}>
              <p className="eyebrow">Baris item</p>
              <div className="line-editor">
                {lines.map((l, idx) => (
                  <div className="line-row" key={idx}>
                    <select
                      data-testid={`po-line-item-${idx}`}
                      value={l.item_id}
                      onChange={(e) => updateLine(idx, "item_id", e.target.value)}
                    >
                      <option value="">Pilih item...</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({it.sku})
                        </option>
                      ))}
                    </select>
                    <input
                      data-testid={`po-line-qty-${idx}`}
                      type="number"
                      value={l.qty}
                      onChange={(e) => updateLine(idx, "qty", e.target.value)}
                      placeholder="Qty"
                    />
                    <input
                      data-testid={`po-line-price-${idx}`}
                      type="number"
                      value={l.price}
                      onChange={(e) => updateLine(idx, "price", e.target.value)}
                      placeholder="Harga"
                    />
                    <button type="button" className="icon-button" onClick={() => removeLine(idx)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" data-testid="po-add-line" className="chip small" onClick={addLine}>
                  <Plus size={12} /> Tambah baris
                </button>
              </div>
              <div className="line-total">Total: <strong>{money(linesTotal)}</strong></div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>Batal</button>
              <button data-testid="po-save-button" className="primary-button" type="submit" disabled={saving}>
                <Check size={16} /> {saving ? "Menyimpan..." : "Simpan PO"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "upload" && (
        <BulkUploadDialog
          title="Upload purchase order (CSV)"
          endpoint="/orders/bulk-upload"
          templateName="purchase_order_template.csv"
          templateHeaders={TEMPLATE.headers}
          templateExample={TEMPLATE.example}
          instructions={
            <>
              Kelompokkan baris dengan kolom <b>po_ref</b> yang sama untuk membuat satu PO.
              Kolom <b>item_sku</b> harus cocok dengan SKU master barang.
            </>
          }
          onClose={() => setModal(null)}
          onSuccess={load}
          testid="orders-upload"
        />
      )}
    </>
  );
}
