export const money = (v) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));

export const outletNames = {
  all: "Semua outlet",
  main_wh: "Gudang utama",
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
  warehouse: "Gudang",
  finance: "Finance",
};

export const statusLabels = {
  waiting_approval: "Menunggu approval",
  approved: "Disetujui · siap terima",
  partial: "Diterima sebagian",
  received: "Ditutup (received penuh)",
  cancelled: "Dibatalkan",
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
    return new Date(iso).toLocaleString("id-ID", {
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
