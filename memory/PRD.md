# LAGO BALI · Inventory & F&B OS — PRD

## Original problem statement
Aplikasi untuk mengontrol inventory perusahaan hotel dan F&B: order barang, penerimaan, barang keluar, stock opname, HPP, flash cost. Digunakan oleh **Lago Bali**, dibuat oleh **NANDA HARY**.

## User personas & roles
- **Admin** — semua akses
- **Purchasing** — buat PO
- **Warehouse (Gudang)** — terima barang, catat pengeluaran, stock opname
- **Finance** — approve PO, approve opname, input revenue, monitor flash cost

## Architecture
- Backend: FastAPI + MongoDB, JWT Bearer auth (12h TTL), routes under `/api`
- Frontend: React 19 + Tailwind + shadcn/ui + recharts
- Weighted-average HPP di penerimaan barang
- Flash cost = total_konsumsi_harian / revenue_harian per outlet

## Modules implemented (2026-08-26)
- Auth: login/me, admin-seeded users, RBAC
- Master barang (item CRUD + SKU + search by name/SKU + CSV upload)
- Purchase Order (create by purchasing, approve/cancel by finance, CSV upload)
- Penerimaan barang (GRN) — **WAJIB terkait Approved PO**, weighted-average HPP auto-update, CSV upload (po_number-based)
- Barang keluar (issues) — deduct stock, stamp cost_at_issue, CSV upload
- Stock opname — warehouse count, finance approve → adjust stock
- Revenue harian — upsert per date+outlet
- Flash cost — per-outlet daily cost/revenue/pct
- HPP & Resep — resep menu dengan HPP computed
- Dashboard analytics — flash cost trend 7 hari, top consumed items, category donut, outlet valuation, procurement window

## Seed data
- 4 users (admin, purchasing, warehouse, finance)
- 4 outlets (main_wh, kitchen, bar, housekeeping)
- 13 items dengan category-prefix SKU (PRT/DRY/BEV/VEG/AMN)
- 1 PO contoh (waiting_approval)

## Testing status
- Backend: 47/47 pytest pass
- Frontend: E2E all core flows pass

## Backlog (P0/P1/P2)
- P1: URL routing (react-router) — deep-link/refresh currently resets to Dashboard
- P1: Prevent partial-receive double-charge (track received_qty per line)
- P2: Recipe CRUD (edit/delete)
- P2: Purge/reset endpoints for demo cleanup
- P2: Supplier master + PO auto-fill supplier catalog
