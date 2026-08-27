import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Settings2, Upload, Check, Pencil } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { money, outletNames } from "../lib/format";
import { useOutlets } from "../lib/useOutlets";
import { PageIntro, Modal, Field, SelectField, Badge } from "../components/UI";
import { BulkUploadDialog } from "../components/BulkUpload";
import { useAuth } from "../context/AuthContext";

const ITEMS_TEMPLATE = {
  headers: ["sku", "name", "category", "unit", "cost", "min_stock", "stock", "supplier", "outlet_code"],
  example: [
    ["PRT-001", "Fresh ribeye 200g", "Protein", "kg", "225000", "10", "20", "PT Boga Utama", "kitchen"],
    ["BEV-042", "Mineral water 500ml bottle", "Beverage", "carton", "45000", "20", "40", "CV Aqua", "bar"],
  ],
};

export default function InventoryPage({ outlet }) {
  const { user } = useAuth();
  const outletsList = useOutlets();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [outlets, setOutlets] = useState([]);
  const [modal, setModal] = useState(null); // "add" | "edit" | "upload" | null
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(defaultForm());
  const [saving, setSaving] = useState(false);

  const canEdit = ["admin", "purchasing", "warehouse"].includes(user?.role);

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
    setEditingId(null);
    setForm(defaultForm());
    setModal("add");
  };

  const openEdit = (i) => {
    setEditingId(i.id);
    setForm({
      sku: i.sku || "",
      name: i.name || "",
      category: i.category || "Protein",
      unit: i.unit || "kg",
      stock: String(i.stock ?? 0),
      min_stock: String(i.min_stock ?? 0),
      cost: String(i.cost ?? 0),
      outlet_code: i.outlet_code || "kitchen",
      supplier: i.supplier || "",
      notes: i.notes || "",
    });
    setModal("edit");
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name) return toast.error("Item name is required");
    if (!form.sku || !form.sku.trim()) return toast.error("SKU must be entered manually");
    setSaving(true);
    try {
      if (editingId) {
        // Item master edits: name, category, unit, cost, supplier, outlet, min_stock, notes
        // Stock is NOT changed here — that flows through receiving/issue/opname.
        await api.patch(`/items/${editingId}`, {
          name: form.name,
          category: form.category,
          unit: form.unit,
          cost: Number(form.cost || 0),
          min_stock: Number(form.min_stock || 0),
          supplier: form.supplier,
          outlet_code: form.outlet_code,
          notes: form.notes || "",
        });
        toast.success("Item updated. New price/UOM will apply to future transactions only.");
      } else {
        await api.post("/items", {
          ...form,
          sku: form.sku.trim(),
          cost: Number(form.cost || 0),
          min_stock: Number(form.min_stock || 0),
          stock: Number(form.stock || 0),
        });
        toast.success("Item added successfully");
      }
      setModal(null);
      setEditingId(null);
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
        eyebrow="Master data · stock & costing"
        title="Items"
        subtitle="Central catalog for all hotel and F&B needs."
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
              <Plus size={17} /> Add item
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
              placeholder="Search by item name or SKU code..."
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
                <th>Item</th>
                <th>Category</th>
                <th>Outlet</th>
                <th>Stock</th>
                <th>COGS / unit</th>
                <th>Valuation</th>
                <th>Supplier</th>
                {canEdit && <th style={{ textAlign: "right" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} style={{ textAlign: "center", padding: 40 }}>
                    No items yet. Click "Add item" or "Upload CSV".
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
                  {canEdit && (
                    <td style={{ textAlign: "right" }}>
                      <button
                        data-testid={`inventory-edit-${i.id}`}
                        className="small-button"
                        onClick={() => openEdit(i)}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(modal === "add" || modal === "edit") && (
        <Modal
          title={modal === "edit" ? "Edit item master" : "Add item master"}
          onClose={() => { setModal(null); setEditingId(null); }}
        >
          <form className="form-grid" onSubmit={save}>
            <Field label="Item name" testid="item-name-input" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g., Fresh ribeye 200g" />
            <Field label={modal === "edit" ? "SKU code (cannot be changed)" : "SKU code (required)"} testid="item-sku-input" value={form.sku || ""} onChange={(v) => setForm({ ...form, sku: v })} placeholder="e.g., PRT-001 / BEV-042" required disabled={modal === "edit"} />
            <Field label="Main supplier" testid="item-supplier-input" value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} placeholder="Supplier name" />
            <SelectField label="Category" testid="item-category-select" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={["Protein", "Dry goods", "Beverage", "Dairy", "Amenities", "Vegetable", "Other"]} />
            <SelectField
              label="Outlet"
              testid="item-outlet-select"
              value={form.outlet_code}
              onChange={(v) => setForm({ ...form, outlet_code: v })}
              options={outletsList.map((o) => ({ value: o.code, label: o.name }))}
            />
            <SelectField label="Unit of measure (UOM)" testid="item-unit-select" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} options={["kg", "gram", "liter", "ml", "pcs", "carton", "box"]} />
            {modal !== "edit" && (
              <Field label="Initial stock" testid="item-stock-input" type="number" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} />
            )}
            <Field label="Minimum stock" testid="item-min-input" type="number" value={form.min_stock} onChange={(v) => setForm({ ...form, min_stock: v })} />
            <Field label="Price / COGS per unit (IDR)" testid="item-cost-input" type="number" value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} />
            <label className="field" style={{ gridColumn: "1/-1" }}>
              <span>Item description / notes</span>
              <textarea
                data-testid="item-notes-input"
                value={form.notes || ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Preferred brand, storage instructions, packaging spec..."
                rows={3}
              />
            </label>
            {modal === "edit" && (
              <p className="form-hint" style={{ gridColumn: "1/-1" }}>
                Note: updates to price or UOM apply to <b>new transactions only</b> — existing PO, GRN, and stock-out records keep their original values.
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => { setModal(null); setEditingId(null); }}>Cancel</button>
              <button data-testid="item-save-button" className="primary-button" type="submit" disabled={saving}>
                <Check size={16} /> {saving ? "Saving..." : editingId ? "Update item" : "Save item"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal === "upload" && (
        <BulkUploadDialog
          title="Upload item master (CSV)"
          endpoint="/items/bulk-upload"
          templateName="item_master_template.csv"
          templateHeaders={ITEMS_TEMPLATE.headers}
          templateExample={ITEMS_TEMPLATE.example}
          instructions={
            <>
              Use column <b>outlet_code</b>: main_wh, kitchen, bar, housekeeping, dusk, dawn,
              pontoon, beach_house, sundeck, firm, kitchen_dusk, kitchen_boh, office. The{" "}
              <b>sku</b> column is required and must be unique. If the SKU already exists, the item will be updated.
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
    notes: "",
  };
}
