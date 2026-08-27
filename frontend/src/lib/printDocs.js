// Reusable print utility that opens a new window with a print-ready HTML
// document. The generated document uses the Lago logo as header and mirrors
// a professional PO/GRN template.
import { outletNames, statusLabels } from "./format";

const money = (v) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));

const fmtDate = (iso) => {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const LOGO_URL = `${window.location.origin}/lago-logo.png`;

const BASE_STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #14181c; font-family: 'Helvetica Neue', Arial, sans-serif; }
  .sheet { max-width: 820px; margin: 0 auto; padding: 44px 52px 60px; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #14181c; padding-bottom: 22px; margin-bottom: 30px; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand img { height: 68px; width: auto; }
  .brand .brand-meta { font-size: 10px; letter-spacing: .28em; text-transform: uppercase; color: #7d8a86; margin-top: 8px; }
  .brand h2 { margin: 0; font-size: 13px; letter-spacing: .18em; font-weight: 700; color: #14181c; text-transform: uppercase; }
  .doc-title { text-align: right; }
  .doc-title small { display: block; font-size: 10px; letter-spacing: .3em; text-transform: uppercase; color: #7d8a86; }
  .doc-title h1 { margin: 6px 0 0; font-family: 'Georgia', serif; font-size: 34px; letter-spacing: -.02em; }
  .doc-title .doc-no { font-size: 15px; letter-spacing: .12em; color: #14181c; margin-top: 4px; font-weight: 600; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 24px; }
  .meta-block { border: 1px solid #d8dedb; border-radius: 4px; padding: 14px 18px; }
  .meta-block h3 { margin: 0 0 10px; font-size: 9px; letter-spacing: .28em; text-transform: uppercase; color: #7d8a86; font-weight: 600; }
  .meta-block .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; }
  .meta-block .row span { color: #7d8a86; }
  .meta-block .row strong { color: #14181c; font-weight: 600; text-align: right; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.items thead th { background: #14181c; color: #fff; padding: 12px 14px; font-size: 10px; letter-spacing: .18em; text-transform: uppercase; text-align: left; font-weight: 600; }
  table.items thead th.num, table.items tbody td.num { text-align: right; }
  table.items tbody td { padding: 12px 14px; border-bottom: 1px solid #eaeeeb; font-size: 12px; vertical-align: top; }
  table.items tbody tr:nth-child(even) td { background: #fafcfa; }
  table.items tbody td strong { color: #14181c; }
  table.items tbody td small { display: block; color: #7d8a86; font-size: 10px; margin-top: 2px; }
  .totals { margin-top: 18px; display: flex; justify-content: flex-end; }
  .totals table { border-collapse: collapse; }
  .totals td { padding: 7px 12px; font-size: 12px; }
  .totals td.label { color: #7d8a86; text-align: right; letter-spacing: .05em; }
  .totals td.value { text-align: right; font-weight: 600; min-width: 140px; }
  .totals tr.grand td { border-top: 2px solid #14181c; font-family: 'Georgia', serif; font-size: 18px; padding-top: 12px; }
  .notes { margin-top: 24px; padding: 12px 16px; background: #fafcfa; border-left: 3px solid #14181c; font-size: 12px; color: #52605a; }
  .notes h4 { margin: 0 0 4px; font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: #14181c; }
  .signatures { margin-top: 48px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; }
  .sig { text-align: center; }
  .sig .line { height: 62px; border-bottom: 1px solid #14181c; margin-bottom: 10px; }
  .sig .name { font-size: 12px; color: #14181c; font-weight: 600; letter-spacing: .04em; }
  .sig .role { font-size: 10px; color: #7d8a86; text-transform: uppercase; letter-spacing: .18em; margin-top: 2px; }
  .footer { margin-top: 44px; padding-top: 14px; border-top: 1px solid #eaeeeb; text-align: center; font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: #7d8a86; }
  .footer strong { color: #14181c; letter-spacing: .18em; }
  .status-badge { display: inline-block; padding: 3px 8px; border-radius: 3px; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; background: #eaeeeb; color: #14181c; margin-left: 8px; font-weight: 600; vertical-align: middle; }
  @media print {
    @page { size: A4; margin: 12mm; }
    .sheet { max-width: none; padding: 0; }
    .no-print { display: none !important; }
  }
`;

const headerBlock = (title, docNo) => `
  <div class="doc-header">
    <div class="brand">
      <img src="${LOGO_URL}" alt="Lago Bali" onerror="this.style.display='none'"/>
      <div>
        <h2>Lago Bali</h2>
        <div class="brand-meta">Hotel · F&amp;B Operations</div>
      </div>
    </div>
    <div class="doc-title">
      <small>Official document</small>
      <h1>${title}</h1>
      <div class="doc-no">${docNo}</div>
    </div>
  </div>
`;

const footerBlock = `
  <div class="footer">
    Printed from LAGO BALI system — <strong>Created by NANDA HARY</strong>
  </div>
`;

function openAndPrint(html, title) {
  const w = window.open("", "_blank", "width=980,height=1100");
  if (!w) {
    alert("Popup blocked by browser. Please allow popups to print.");
    return;
  }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${BASE_STYLES}</style></head><body><div class="sheet">${html}</div><script>window.addEventListener('load',()=>{setTimeout(()=>{window.focus();window.print();},250)});<\/script></body></html>`);
  w.document.close();
}

// ---------- Purchase Order ----------
export function printPurchaseOrder(po, supplier = null) {
  const items = po.items || [];
  const totalQty = items.reduce((s, l) => s + Number(l.qty || 0), 0);
  const rows = items
    .map(
      (l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>
        <strong>${escapeHtml(l.name)}</strong>
        ${l.received_qty ? `<small>Received so far: ${l.received_qty} ${l.unit || ""}</small>` : ""}
      </td>
      <td class="num">${l.qty} ${escapeHtml(l.unit || "")}</td>
      <td class="num">${money(l.price)}</td>
      <td class="num"><strong>${money(Number(l.qty) * Number(l.price))}</strong></td>
    </tr>`
    )
    .join("");

  const html = `
    ${headerBlock("Purchase Order", po.po_number || "-")}
    <div class="meta-grid">
      <div class="meta-block">
        <h3>PO Information</h3>
        <div class="row"><span>Number</span><strong>${escapeHtml(po.po_number || "-")}</strong></div>
        <div class="row"><span>Date</span><strong>${fmtDate(po.created_at)}</strong></div>
        <div class="row"><span>Destination outlet</span><strong>${escapeHtml(outletNames[po.outlet_code] || po.outlet_code)}</strong></div>
        <div class="row"><span>Status</span><strong>${escapeHtml(statusLabels[po.status] || po.status)}</strong></div>
      </div>
      <div class="meta-block">
        <h3>Supplier</h3>
        <div class="row"><span>Name</span><strong>${escapeHtml(po.supplier || "-")}</strong></div>
        ${supplier?.contact_person ? `<div class="row"><span>Contact</span><strong>${escapeHtml(supplier.contact_person)}</strong></div>` : ""}
        ${supplier?.phone ? `<div class="row"><span>Phone</span><strong>${escapeHtml(supplier.phone)}</strong></div>` : ""}
        ${supplier?.email ? `<div class="row"><span>Email</span><strong>${escapeHtml(supplier.email)}</strong></div>` : ""}
        ${(po?.payment_terms || supplier?.payment_terms) ? `<div class="row"><span>Payment</span><strong>${escapeHtml(po?.payment_terms || supplier?.payment_terms)}</strong></div>` : ""}
        ${supplier?.lead_time_days ? `<div class="row"><span>Lead time</span><strong>${supplier.lead_time_days} days</strong></div>` : ""}
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Item description</th>
          <th class="num" style="width:110px">Qty</th>
          <th class="num" style="width:130px">Unit price</th>
          <th class="num" style="width:150px">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5" style="text-align:center;padding:22px;color:#7d8a86">No items.</td></tr>`}</tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td class="label">Total items</td><td class="value">${items.length} lines · ${totalQty} qty</td></tr>
        <tr class="grand"><td class="label">GRAND TOTAL</td><td class="value">${money(po.total)}</td></tr>
      </table>
    </div>

    ${po.notes ? `<div class="notes"><h4>Notes</h4>${escapeHtml(po.notes)}</div>` : ""}

    <div class="signatures">
      <div class="sig"><div class="line"></div><div class="name">${escapeHtml(po.created_by || "Purchasing")}</div><div class="role">Created by</div></div>
      <div class="sig"><div class="line"></div><div class="name">${escapeHtml(po.approved_by || "_______________")}</div><div class="role">Approved (Finance)</div></div>
      <div class="sig"><div class="line"></div><div class="name">_______________</div><div class="role">Supplier</div></div>
    </div>
    ${footerBlock}
  `;
  openAndPrint(html, `PO ${po.po_number || ""}`);
}

// ---------- Goods Received Note ----------
export function printGRN(grn) {
  const items = grn.items || [];
  const totalQty = items.reduce((s, l) => s + Number(l.qty || 0), 0);
  const rows = items
    .map(
      (l, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>
        <strong>${escapeHtml(l.name)}</strong>
        ${l.new_avg_cost ? `<small>New COGS: ${money(l.new_avg_cost)} / ${l.unit || ""}</small>` : ""}
      </td>
      <td class="num">${l.qty} ${escapeHtml(l.unit || "")}</td>
      <td class="num">${money(l.price)}</td>
      <td class="num"><strong>${money(Number(l.qty) * Number(l.price))}</strong></td>
    </tr>`
    )
    .join("");

  const html = `
    ${headerBlock("Goods Received Note", grn.grn_number || "-")}
    <div class="meta-grid">
      <div class="meta-block">
        <h3>Receiving information</h3>
        <div class="row"><span>GRN Number</span><strong>${escapeHtml(grn.grn_number || "-")}</strong></div>
        <div class="row"><span>Received date</span><strong>${fmtDate(grn.received_at)}</strong></div>
        <div class="row"><span>Destination outlet</span><strong>${escapeHtml(outletNames[grn.outlet_code] || grn.outlet_code)}</strong></div>
        ${grn.po_number ? `<div class="row"><span>PO Ref.</span><strong>${escapeHtml(grn.po_number)}</strong></div>` : ""}
        <div class="row"><span>Received by</span><strong>${escapeHtml(grn.received_by || "-")}</strong></div>
      </div>
      <div class="meta-block">
        <h3>Supplier</h3>
        <div class="row"><span>Name</span><strong>${escapeHtml(grn.supplier || "-")}</strong></div>
        <div class="row"><span>Total lines</span><strong>${items.length} item</strong></div>
        <div class="row"><span>Total qty received</span><strong>${totalQty}</strong></div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th style="width:36px">#</th>
          <th>Item description</th>
          <th class="num" style="width:110px">Qty received</th>
          <th class="num" style="width:130px">Unit price</th>
          <th class="num" style="width:150px">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5" style="text-align:center;padding:22px;color:#7d8a86">No items.</td></tr>`}</tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td class="label">Total items received</td><td class="value">${items.length} lines · ${totalQty} qty</td></tr>
        <tr class="grand"><td class="label">GRAND TOTAL</td><td class="value">${money(grn.total)}</td></tr>
      </table>
    </div>

    ${grn.notes ? `<div class="notes"><h4>Receiving notes</h4>${escapeHtml(grn.notes)}</div>` : ""}

    <div class="signatures">
      <div class="sig"><div class="line"></div><div class="name">${escapeHtml(grn.received_by || "_______________")}</div><div class="role">Warehouse officer</div></div>
      <div class="sig"><div class="line"></div><div class="name">_______________</div><div class="role">Checker</div></div>
      <div class="sig"><div class="line"></div><div class="name">_______________</div><div class="role">Supplier / Courier</div></div>
    </div>
    ${footerBlock}
  `;
  openAndPrint(html, `GRN ${grn.grn_number || ""}`);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
