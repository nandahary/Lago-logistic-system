import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { PageIntro, PanelHead, Badge } from "../components/UI";
import { today } from "../lib/format";

export default function FlashCostPage() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState(null);

  const load = () => api.get("/flash-cost", { params: { date } }).then((r) => setData(r.data));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const tone = (pct) => (pct <= 30 ? "green" : pct <= 40 ? "amber" : "neutral");

  return (
    <>
      <PageIntro
        eyebrow="Finance · daily control"
        title="Flash cost harian"
        subtitle="Konsumsi bahan baku dibandingkan revenue tiap outlet."
        testid="flash-title"
        action={
          <label className="field" style={{ minWidth: 200 }}>
            <span>Tanggal</span>
            <input
              data-testid="flash-date-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        }
      />
      {!data && <div className="loading-state">Memuat...</div>}
      {data && (
        <>
          <div className="metric-grid">
            <div className="metric" data-testid="flash-total-cost">
              <span>Total konsumsi</span>
              <strong>{money(data.total_cost)}</strong>
              <small>Semua outlet</small>
            </div>
            <div className="metric" data-testid="flash-total-revenue">
              <span>Total revenue</span>
              <strong>{money(data.total_revenue)}</strong>
              <small>Input harian</small>
            </div>
            <div className="metric" data-testid="flash-total-pct">
              <span>Flash cost total</span>
              <strong>{data.total_percentage}%</strong>
              <small>Target &lt; 32%</small>
            </div>
          </div>
          <section className="panel">
            <PanelHead title="Detail per outlet" detail={`Tanggal ${data.date}`} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Outlet</th>
                    <th>Tipe</th>
                    <th>Konsumsi</th>
                    <th>Revenue</th>
                    <th>Persentase</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outlets.map((o) => (
                    <tr key={o.outlet_code} data-testid={`flash-row-${o.outlet_code}`}>
                      <td><strong>{o.outlet_name}</strong></td>
                      <td>{o.outlet_type}</td>
                      <td>{money(o.cost)}</td>
                      <td>{money(o.revenue)}</td>
                      <td>
                        <Badge tone={tone(o.cost_percentage)}>{o.cost_percentage}%</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
