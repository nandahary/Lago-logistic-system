import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Settings2, Upload, Check } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { money, outletNames } from "../lib/format";
import { useOutlets } from "../lib/useOutlets";
import { PageIntro, Modal, Field, SelectField, Badge } from "../components/UI";
import { BulkUploadDialog } from "../components/BulkUpload";

const ITEMS_TEMPLATE = {
  headers: ["sku", "name", "category", "unit", "cost", "min_stock", "stock", "supplier", "outlet_code"],
  example: [
    ["PRT-001", "Fresh ribeye 200g", "Protein", "kg", "225000", "10", "20", "PT Boga Utama", "kitchen"],
    ["BEV-042", "Botol air mineral 500ml", "Beverage", "carton", "45000", "20", "40", "CV Aqua", "bar"],
  ],
};

export default function InventoryPage({ outlet }) {
  const outletsList = useOutlets();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [outlets, setOutlets] = useState([]);
  const [modal, setModal] = useState(null); // "add" | "upload" | null
  const [form, setForm] = useState(defaultForm());
  const [saving, setSaving] = useState(false);

  const load = () => {
    const params = {};
    if (outlet && outlet !== "all") params.outlet = outlet;
    if (search) params.search = search;
    api.get("/items", { params }).then((r) => setItems(r.data));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlet, search]);
  useEffect(() => {
    api.get("/outlets").then((r) => setOutlets(r.data));
  }, []);

  const openAdd = () => {
    setForm(defaultForm());
    setModal("add");
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name) return toast.error("Nama barang wajib diisi");
    if (!form.sku || !form.sku.trim()) return toast.error("Kode SKU wajib diisi manual");
    setSaving(true);
    try {
      await api.post("/items", {
        ...form,
        sku: form.sku.trim(),
        cost: Number(form.cost || 0),
        min_stock: Number(form.min_stock || 0),
        stock: Number(form.stock || 0),
      });
      toast.success("Barang berhasil ditambahkan");
      setModal(null);
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageIntro
        eyebrow="Data dasar · stok & costing"
        title="Master barang"
        subtitle="Katalog terpusat untuk semua kebutuhan hotel dan F&B."
        testid="inventory-title"
        action={
          <div className="action-cluster">
            <button
              data-testid="inventory-upload-button"
              className="secondary-button"
              onClick={() => setModal("upload")}
            >
              <Upload size={16} /> Upload CSV
            </button>
            <button
              data-testid="add-item-button"
              className="primary-button"
              onClick={openAdd}
            >
              <Plus size={17} /> Tambah barang
            </button>
          </div>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              data-testid="inventory-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama barang atau kode SKU..."
            />
          </div>
          <button className="secondary-button">
            <Settings2 size={16} /> Filter
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Barang</th>
                <th>Kategori</th>
                <th>Outlet</th>
                <th>Stok</th>
                <th>HPP / unit</th>
                <th>Valuasi</th>
                <th>Supplier</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 40 }}>
                    Belum ada barang. Klik "Tambah barang" atau "Upload CSV".
                  </td>
                </tr>
              )}
              {items.map((i) => (
                <tr key={i.id} data-testid={`inventory-row-${i.id}`}>
                  <td>
                    <strong data-testid={`inventory-name-${i.id}`}>{i.name}</strong>
                    <small><Badge tone="neutral">{i.sku}</Badge></small>
                  </td>
                  <td>
                    <Badge>{i.category}</Badge>
                  </td>
                  <td>{outletNames[i.outlet_code] || i.outlet_code}</td>
                  <td className={i.stock <= i.min_stock ? "danger-text" : ""}>
                    <strong>
                      {i.stock} {i.unit}
                    </strong>
                    {i.stock <= i.min_stock && <small>Low stock</small>}
                  </td>
                  <td>{money(i.cost)}</td>
                  <td>
                    <strong>{money(i.stock * i.cost)}</strong>
                  </td>
                  <td>{i.supplier || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal === "add" && (
        <Modal title="Tambah barang master" onClose={() => setModal(null)}>
          <form className="form-grid" onSubmit={save}>
            <Field label="Nama barang" testid="item-name-input" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Contoh: Fresh ribeye 200g" />
            <Field label="Kode SKU (wajib)" testid="item-sku-input" value={form.sku || ""} onChange={(v) => setForm({ ...form, sku: v })} placeholder="Contoh: PRT-001 / BEV-042" required />
            <Field label="Supplier utama" testid="item-supplier-input" value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} placeholder="Nama supplier" />
            <SelectField label="Kategori" testid="item-category-select" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={["Protein", "Dry goods", "Beverage", "Dairy", "Amenities", "Vegetable", "Other"]} />
            <SelectField
              label="Outlet"
              testid="item-outlet-select"
              value={form.outlet_code}
              onChange={(v) => setForm({ ...form, outlet_code: v })}
              options={outletsList.map((o) => ({ value: o.code, label: o.name }))}
            />
            <SelectField label="Satuan" testid="item-unit-select" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} options={["kg", "gram", "liter", "ml", "pcs", "carton", "box"]} />
            <Field label="Stok awal" testid="item-stock-input" type="number" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} />
            <Field label="Minimum stok" testid="item-min-input" type="number" value={form.min_stock} onChange={(v) => setForm({ ...form, min_stock: v })} />
            <Field label="HPP satuan (IDR)" testid="item-cost-input" type="number" value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} />
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>Batal</button>
              <button data-testid="item-save-button" className="primary-button" type="submit" disabled={saving}>
                <Check size={16} /> {saving ? "Menyimpan..." : "Simpan barang"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "upload" && (
        <BulkUploadDialog
          title="Upload master barang (CSV)"
          endpoint="/items/bulk-upload"
          templateName="master_barang_template.csv"
          templateHeaders={ITEMS_TEMPLATE.headers}
          templateExample={ITEMS_TEMPLATE.example}
          instructions={
            <>
              Gunakan kolom <b>outlet_code</b>: main_wh, kitchen, bar, housekeeping, dusk, dawn,
              pontoon, beach_house, sundeck, firm, kitchen_dusk, kitchen_boh, office. Kolom{" "}
              <b>sku</b> wajib diisi dan unik. Jika SKU sudah ada, item akan di-update.
            </>
          }
          onClose={() => setModal(null)}
          onSuccess={load}
          testid="items-upload"
        />
      )}
    </>
  );
}

function defaultForm() {
  return {
    sku: "",
    name: "",
    category: "Protein",
    unit: "kg",
    stock: "0",
    min_stock: "10",
    cost: "",
    outlet_code: "kitchen",
    supplier: "",
  };
}
