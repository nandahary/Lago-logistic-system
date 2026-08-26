import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Check, Trash2 } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { money, outletNames } from "../lib/format";
import { useOutlets } from "../lib/useOutlets";
import { PageIntro, PanelHead, Modal, Field, SelectField, Badge } from "../components/UI";
import { useAuth } from "../context/AuthContext";

export default function COGSPage() {
  const { user } = useAuth();
  const outletsList = useOutlets();
  const [recipes, setRecipes] = useState([]);
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null);
  const [name, setName] = useState("");
  const [outletCode, setOutletCode] = useState("kitchen");
  const [sellingPrice, setSellingPrice] = useState("0");
  const [lines, setLines] = useState([{ item_id: "", qty: "1" }]);
  const [saving, setSaving] = useState(false);

  const canCreate = ["admin", "finance"].includes(user?.role);

  const load = () => api.get("/recipes").then((r) => setRecipes(r.data));
  useEffect(() => {
    load();
    api.get("/items").then((r) => setItems(r.data));
  }, []);

  const openNew = () => {
    setName("");
    setOutletCode("kitchen");
    setSellingPrice("0");
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
    if (!name) return toast.error("Menu name is required");
    const clean = lines.filter((l) => l.item_id && Number(l.qty) > 0);
    if (clean.length === 0) return toast.error("Add at least 1 ingredient");
    setSaving(true);
    try {
      await api.post("/recipes", {
        name,
        outlet_code: outletCode,
        selling_price: Number(sellingPrice || 0),
        ingredients: clean.map((l) => {
          const it = items.find((i) => i.id === l.item_id);
          return { item_id: l.item_id, name: it.name, qty: Number(l.qty), unit: it.unit };
        }),
      });
      toast.success("Recipe saved");
      setModal(null);
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const previewCOGS = lines.reduce((sum, l) => {
    const it = items.find((i) => i.id === l.item_id);
    if (!it) return sum;
    return sum + Number(l.qty || 0) * Number(it.cost || 0);
  }, 0);

  return (
    <>
      <PageIntro
        eyebrow="Cost engineering · menu recipes"
        title="COGS & recipes"
        subtitle="Calculate ingredient cost and margin per menu based on real-time COGS."
        testid="hpp-title"
        action={
          canCreate && (
            <button data-testid="hpp-primary-action" className="primary-button" onClick={openNew}>
              <Plus size={17} /> Add recipe
            </button>
          )
        }
      />
      <section className="panel">
        <PanelHead title="Recipe list" detail={`${recipes.length} menus recorded`} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Menu</th>
                <th>Outlet</th>
                <th>Ingredient</th>
                <th>COGS</th>
                <th>Selling price</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {recipes.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 40 }}>No recipes yet.</td></tr>
              )}
              {recipes.map((r) => (
                <tr key={r.id} data-testid={`recipe-row-${r.id}`}>
                  <td><strong>{r.name}</strong></td>
                  <td>{outletNames[r.outlet_code] || r.outlet_code}</td>
                  <td>{r.ingredients?.length || 0} ingredients</td>
                  <td><strong>{money(r.hpp)}</strong></td>
                  <td>{money(r.selling_price)}</td>
                  <td>
                    <Badge tone={r.margin_pct >= 60 ? "green" : r.margin_pct >= 40 ? "amber" : "neutral"}>
                      {r.margin_pct}%
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal === "new" && (
        <Modal title="Add recipe menu" onClose={() => setModal(null)}>
          <form className="form-grid" onSubmit={submit}>
            <Field label="Menu name" testid="recipe-name-input" value={name} onChange={setName} placeholder="Beef tenderloin steak" />
            <SelectField
              label="Outlet"
              testid="recipe-outlet-select"
              value={outletCode}
              onChange={setOutletCode}
              options={outletsList
                .filter((o) => ["kitchen", "bar", "restaurant"].includes(o.type))
                .map((o) => ({ value: o.code, label: o.name }))}
            />
            <Field label="Selling price (IDR)" testid="recipe-price-input" type="number" value={sellingPrice} onChange={setSellingPrice} />
            <div style={{ gridColumn: "1/-1" }}>
              <p className="eyebrow">Raw ingredients</p>
              <div className="line-editor">
                {lines.map((l, idx) => (
                  <div className="line-row simple" key={idx}>
                    <select value={l.item_id} onChange={(e) => updateLine(idx, "item_id", e.target.value)}>
                      <option value="">Pick ingredient...</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>{it.name} ({money(it.cost)}/{it.unit})</option>
                      ))}
                    </select>
                    <input type="number" value={l.qty} onChange={(e) => updateLine(idx, "qty", e.target.value)} placeholder="Qty" />
                    <button type="button" className="icon-button" onClick={() => removeLine(idx)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" className="chip small" onClick={addLine}>
                  <Plus size={12} /> Add ingredient
                </button>
              </div>
              <div className="line-total">
                COGS: <strong>{money(previewCOGS)}</strong> ·
                Selling price: <strong>{money(Number(sellingPrice || 0))}</strong> ·
                Margin: <strong>{Number(sellingPrice) > 0 ? Math.round(((Number(sellingPrice) - previewCOGS) / Number(sellingPrice)) * 100) : 0}%</strong>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button>
              <button data-testid="recipe-save-button" className="primary-button" type="submit" disabled={saving}>
                <Check size={16} /> {saving ? "Saving..." : "Save recipe"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
