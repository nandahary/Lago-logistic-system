export const money = (v) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));

export const outletNames = {
  all: "All outlets",
  main_wh: "Main warehouse",
  kitchen: "Kitchen",
  bar: "Bar",
  housekeeping: "Housekeeping",
  dusk: "Dusk",
  dawn: "Dawn",
  pontoon: "Pontoon",
  beach_house: "Beach House",
  sundeck: "Sundeck",
  firm: "Firm",
  kitchen_dusk: "Kitchen Dusk",
  kitchen_boh: "Kitchen BOH",
  office: "Office",
};

export const roleLabels = {
  admin: "Admin",
  purchasing: "Purchasing",
  warehouse: "Warehouse",
  finance: "Finance",
  requestor: "Requestor",
};

export const statusLabels = {
  waiting_approval: "Awaiting approval",
  approved: "Approved · ready to receive",
  partial: "Partially received",
  received: "Closed (fully received)",
  cancelled: "Cancelled",
  draft: "Draft",
};

export const statusTone = {
  waiting_approval: "amber",
  approved: "blue",
  partial: "amber",
  received: "green",
  cancelled: "neutral",
  draft: "amber",
};

export const formatDate = (iso) => {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

export const today = () => new Date().toISOString().slice(0, 10);
