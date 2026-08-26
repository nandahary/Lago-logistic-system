import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Check } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { money, outletNames, formatDate, today } from "../lib/format";
import { PageIntro, PanelHead, Modal, Field, SelectField } from "../components/UI";
import { useAuth } from "../context/AuthContext";

export default function RevenuePage() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [modal, setModal] = useState(false);
  const [date, setDate] = useState(today());
  const [outletCode, setOutletCode] = useState("kitchen");
  const [amount, setAmount] = useState("0");
  const [saving, setSaving] = useState(false);

  const canEdit = ["admin", "finance"].includes(user?.role);

  const load = () => api.get("/revenues").then((r) => setList(r.data));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/revenues", { date, outlet_code: outletCode, amount: Number(amount || 0) });
      toast.success("Revenue tersimpan");
      setModal(false);
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
        eyebrow="Finance · pendapatan harian"
        title="Revenue harian"
        subtitle="Input revenue tiap outlet setiap hari agar flash cost dapat dihitung."
        testid="revenue-title"
        action={
          canEdit && (
            <button data-testid="revenue-primary-action" className="primary-button" onClick={() => setModal(true)}>
              <Plus size={17} /> Input revenue
            </button>
          )
        }
      />
      <section className="panel">
        <PanelHead title="Riwayat revenue" detail={`${list.length} entri`} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Outlet</th>
                <th>Amount</th>
                <th>Diperbarui</th>
                <th>Oleh</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", padding: 40 }}>Belum ada data revenue.</td></tr>
              )}
              {list.map((r) => (
                <tr key={r.id} data-testid={`revenue-row-${r.id}`}>
                  <td><strong>{r.date}</strong></td>
                  <td>{outletNames[r.outlet_code] || r.outlet_code}</td>
                  <td><strong>{money(r.amount)}</strong></td>
                  <td><small>{formatDate(r.updated_at)}</small></td>
                  <td><small>{r.created_by}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <Modal title="Input revenue" onClose={() => setModal(false)}>
          <form className="form-grid" onSubmit={submit}>
            <Field label="Tanggal" testid="revenue-date-input" type="date" value={date} onChange={setDate} />
            <SelectField label="Outlet" testid="revenue-outlet-select" value={outletCode} onChange={setOutletCode} options={[{ value: "kitchen", label: "Kitchen" }, { value: "bar", label: "Bar" }, { value: "housekeeping", label: "Housekeeping" }]} />
            <Field label="Amount (IDR)" testid="revenue-amount-input" type="number" value={amount} onChange={setAmount} />
            <div className="form-actions">
              <button type="button" className="secondary-button" onClick={() => setModal(false)}>Batal</button>
              <button data-testid="revenue-save-button" className="primary-button" type="submit" disabled={saving}>
                <Check size={16} /> {saving ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
