# LAGO BALI · Inventory & F&B OS — PRD

## Original problem statement
Aplikasi untuk mengontrol inventory perusahaan hotel dan F&B: order barang, penerimaan, barang keluar, stock opname, HPP, flash cost. Digunakan oleh **Lago Bali**, dibuat oleh **NANDA HARY**. UI harus dalam Bahasa Inggris.

## User personas & roles
- **Admin** — full access
- **Purchasing** — create PO
- **Warehouse** — receive goods, record issues, stock opname
- **Finance** — approve PO, approve opname, input revenue, monitor flash cost

## Architecture
- Backend: FastAPI + MongoDB, JWT Bearer auth (12h TTL), routes under `/api`
- Frontend: React 19 + Tailwind + shadcn/ui + recharts
- Weighted-average COGS on receiving
- Flash cost = daily_consumption / daily_revenue per outlet

## Modules implemented
- Auth: login/me, admin-seeded users, RBAC
- Item master (CRUD + manual SKU + search + CSV bulk upload)
- Purchase Order (create by purchasing, approve/cancel by finance, CSV upload, print PO with Lago logo)
- Receiving (GRN) — **must reference approved PO**, partial receive supported, weighted-average COGS auto-update, CSV upload, print GRN
- Stock out (issues) — deduct stock, stamp cost_at_issue, CSV upload
- Stock opname — warehouse count, finance approve → adjust stock
- Daily revenue — upsert per date+outlet
- Flash cost — per-outlet daily cost/revenue/pct
- COGS & Recipes — menu recipes with computed COGS + margin
- Dashboard analytics — 7-day flash cost trend, top consumed items, category donut, outlet valuation, procurement window
- Supplier drill-down page with metrics + PO/GRN history
- 7-tab Reports module (PO/supplier, PO outstanding, stock balance, stock movement, financial flash cost, low stock, top consumed) — CSV export each
- User management (admin CRUD + reset transactions)

## Seed data (current DB state)
- 4 users (admin/purchasing/warehouse/finance @lagobali.com)
- 13 outlets (Main Warehouse, Kitchen, Bar, Housekeeping, Dusk, Dawn, Pontoon, Beach House, Sundeck, Firm, Kitchen Dusk, Kitchen BOH, Office)
- No sample items / suppliers / transactions (wiped for production readiness)

## Changelog
- **2026-08-26 (later)**: Login migrated from **email → username**.
  - Backend: schema `LoginIn`/`UserCreateIn` use `username`, regex validated (3–30 chars letters/digits/dot/underscore), stored lowercase. JWT payload includes `username`. All audit trail fields (`created_by`, `approved_by`, `received_by`, etc.) now record username. Startup migration derives `username` from local-part of legacy email + strips the `email` field from every user doc, then drops the old email unique index and creates a unique index on `username`. `.env` renamed `ADMIN_EMAIL` → `ADMIN_USERNAME`.
  - Frontend: Login page shows Username field (text, autoComplete=username), demo chips use usernames. User Management table + create/edit modal use username (immutable on edit). AuthContext + Layout tooltip updated. `Field` UI component now supports `disabled`.
  - Existing users auto-migrated: `admin@lagobali.com` → `admin`, `purchasing@lagobali.com` → `purchasing`, `warehouse@lagobali.com` → `warehouse`, `finance@lagobali.com` → `finance` (passwords unchanged).
- **2026-08-26**: Full UI + backend error messages translated Indonesian → English.
  - Fixed compile break where sed renamed `HPPPage.jsx` import to `COGSPage.jsx` without renaming file.
  - Renamed file `HPPPage.jsx` → `COGSPage.jsx`.
  - Translated all pages: Login, Dashboard, Inventory, Orders, Receiving, Issues, Opname, Reports, Suppliers, SupplierDetail, Users, COGS, Revenue, FlashCost.
  - Translated `printDocs.js` (PO/GRN print templates), `format.js` (money/date locale → en-US, outletNames), `BulkUpload.jsx`.
  - Translated all backend HTTPException messages returned to UI.
  - Updated `Main Warehouse` outlet name (was "Warehouse utama") + `Budi (Warehouse)` user name (was "Budi (Gudang)") both in seed and existing DB.

## Testing status
- App compiles ✓
- Backend curl smoke test: login, users, outlets, dashboard, low-stock report, create/delete supplier + item ✓
- Frontend visual: Login, Dashboard, Orders, Users, Reports all render in English ✓

## Backlog (P0/P1/P2)
- P2: Consider printable Opname adjustment sheet
- P2: Multi-currency support (currently IDR only, Rp symbol via money formatter)
- P2: Refactor `server.py` (1400+ lines) into `/app/backend/routes/` modules
