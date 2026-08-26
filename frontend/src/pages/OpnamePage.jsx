import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Check } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { money, outletNames, formatDate } from "../lib/format";
import { useOutlets } from "../lib/useOutlets";
import { PageIntro, PanelHead, Modal, SelectField, Badge } from "../components/UI";
import { useAuth } from "../context/AuthContext";

export default function OpnamePage() {
  const { user } = useAuth();
  const outletsList = useOutlets();
  const [list, setList] = useState([]);
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null);
  const [outletCode, setOutletCode] = useState("main_wh");
  const [notes, setNotes] = useState("");
  const [physical, setPhysical] = useState({});
  const [saving, setSaving] = useState(false);

  const canCreate = ["admin", "warehouse"].includes(user?.role);
  const canApprove = ["admin", "finance"].includes(user?.role);

  const load = () => api.get("/opnames").then((r) => setList(r.data));
  useEffect(() => {
    load();
    api.get("/items").then((r) => setItems(r.data));
  }, []);

  const openNew = () => {
    setPhysical({});
    setOutletCode("main_wh");
    setNotes("");
    setModal("new");
  };

  const submit = async (e) => {
    e.preventDefault();
    const scoped = items.filter((i) => i.outlet_code === outletCode || outletCode === "all");
    const lines = scoped
      .map((i) => ({
        item_id: i.id,
        name: i.name,
        physical_qty: physical[i.id] !== undefined && physical[i.id] !== "" ? Number(physical[i.id]) : i.stock,
      }))
      .filter((l) => l.physical_qty !== null);
    if (lines.length === 0) return toast.error("Tidak ada item untuk outlet ini");
    setSaving(true);
    try {
      await api.post("/opnames", { outlet_code: outletCode, notes, items: lines });
      toast.success("Opname tersimpan (status draft)");
      setModal(null);
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setSaving(false);
    }
  };

  const approve = async (id) => {
    if (!window.confirm("Setujui opname ini? Stok akan disesuaikan ke jumlah fisik.")) return;
    try {
      await api.post(`/opnames/${id}/approve`);
      toast.success("Opname disetujui & stok disesuaikan");
      load();
      api.get("/items").then((r) => setItems(r.data));
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    }
  };

  const scoped = items.filter((i) => outletCode === "all" || i.outlet_code === outletCode);

  return (
    <>
      <PageIntro
        eyebrow="Operasional · rekonsiliasi"
        title="Stock opname"
        subtitle="Bandingkan stok fisik dengan sistem dan selesaikan selisih."
        testid="opname-title"
        action={
          canCreate && (
            <button data-testid="opname-primary-action" className="primary-button" onClick={openNew}>
              <Plus size={17} /> Mulai opname
            </button>
          )
        }
      />
      <section className="panel">
        <PanelHead title="Riwayat opname" detail={`${list.length} sesi opname`} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Outlet</th>
                <th>Baris</th>
                <th>Selisih nilai</th>
                <th>Status</th>
                <th>Tanggal</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 40 }}>Belum ada opname.</td></tr>
              )}
              {list.map((o) => (
                <tr key={o.id} data-testid={`opname-row-${o.id}`}>
                  <td><strong>{o.opname_number}</strong></td>
                  <td>{outletNames[o.outlet_code] || o.outlet_code}</td>
                  <td>{o.items.length}</td>
                  <td className={o.total_variance_value < 0 ? "danger-text" : ""}>
                    <strong>{money(o.total_variance_value)}</strong>
                  </td>
                  <td><Badge tone={o.status === "approved" ? "green" : "amber"}>{o.status === "approved" ? "Disetujui" : "Draft"}</Badge></td>
                  <td><small>{formatDate(o.created_at)}</small></td>
                  <td>
                    {o.status === "draft" && canApprove && (
                      <button
                        data-testid={`opname-approve-${o.id}`}
                        className="small-button success"
                        onClick={() => approve(o.id)}
                      >
                        <Check size={12} /> Approve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal === "new" && (
        <Modal title="Stock opname" onClose={() => setModal(null)}>
          <form onSubmit={submit}>
            <div className="form-grid">
              <SelectField
                label="Outlet"
                testid="opname-outlet-select"
                value={outletCode}
                onChange={setOutletCode}
                options={[
                  ...outletsList.map((o) => ({ value: o.code, label: o.name })),
                  { value: "all", label: "Semua outlet" },
                ]}
              />
              <label className="field">
                <span>Catatan</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opname bulanan..." />
              </label>
            </div>
            <div className="opname-list" data-testid="opname-item-list">
              <div className="opname-head">
                <span>Item</span>
                <span>Sistem</span>
                <span>Fisik</span>
                <span>Selisih</span>
              </div>
              {scoped.length === 0 && <p className="empty-hint">Tidak ada item untuk outlet ini.</p>}
              {scoped.map((i) => {
                const phys = physical[i.id] === undefined || physical[i.id] === "" ? i.stock : Number(physical[i.id]);
                const variance = phys - i.stock;
                return (
                  <div className="opname-row" key={i.id}>
                    <div>
                      <strong>{i.name}</strong>
                      <small>{i.sku} · {i.unit}</small>
                    </div>
                    <div><strong>{i.stock}</strong></div>
                    <input
                      data-testid={`opname-physical-${i.id}`}
                      type="number"
                      value={physical[i.id] ?? ""}
                      placeholder={String(i.stock)}
                      onChange={(e) => setPhysical({ ...physical, [i.id]: e.target.value })}
                    />
                    <div className={variance < 0 ? "danger-text" : variance > 0 ? "success-text" : ""}>
                      <strong>{variance > 0 ? `+${variance}` : variance}</strong>
                      <small>{money(variance * i.cost)}</small>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(null)}>Batal</button>
              <button data-testid="opname-save-button" className="primary-button" type="submit" disabled={saving}>
                <Check size={16} /> {saving ? "Menyimpan..." : "Simpan opname"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
