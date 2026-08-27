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
- **2026-08-27 (later)**: Purchase Request (PR) module with multi-level approval → converts to PO(s).
  - Backend: new `purchase_requests` collection + `settings.pr_approval_flow` doc. 11 new endpoints:
    - `GET/PUT /api/pr-config` — read/update approval flow (admin), roles allowed: admin/purchasing/warehouse/finance.
    - `POST /api/purchase-requests` — any authenticated user creates a PR (draft). Validates priority (low/medium/high/urgent), non-empty department, ≥1 item with qty > 0, ≤5 attachments (base64, ≤2MB each).
    - `GET/GET/PUT /purchase-requests[/{id}]` — list, detail, edit (only when status=draft OR returned; only requester or admin).
    - `POST /submit` — moves draft/returned → pending_approval; snapshots the current flow.
    - `POST /approve|/reject|/return` — decision endpoint enforces that the caller role matches the current level's role (or admin override). Reject/Return require a comment. Approve advances the level; final level → approved. Reject → rejected. Return → returned (level reset to 0). All decisions are pushed to `approvals[]` with role/decided_by/comment/decided_at.
    - `POST /convert` — purchasing/admin. Assign supplier+price to every line; lines with the same supplier merge into one PO. Multiple POs created per PR. Sets PR status → converted, stores `converted_po_ids`. New POs get `from_pr_id`/`from_pr_number` fields.
  - Frontend:
    - New page `PurchaseRequestPage` (`/purchase-requests`) with sidebar entry "Purchase request".
    - PR list table with status badges + "Waiting: role" hint on pending rows.
    - Create/Edit modal: department, cost center, required delivery date, project/vessel, priority, remarks, line items via `ItemPicker` (typing a name works for items not in master), file attachments (base64 data URL, max 5 × 2MB).
    - Approve/Reject/Return modal with role-appropriate copy and mandatory comment for reject/return.
    - Convert modal: per-line supplier (with `<datalist>` from suppliers) + unit price → generates POs grouped by vendor.
    - Detail view with header grid, line-items table, approval history timeline, attachment list.
    - Print PR template (Lago logo, header info, line items, approval trail, signature block for Requester/Approver/Purchasing).
    - Admin-only PR approval flow config panel on User Management page (comma-separated roles).
- **2026-08-27**: Edit PO + Cancel PO with reason + Edit Item feature.
  - Backend:
    - `PUT /api/orders/{id}` — edit PO only when status=`waiting_approval` (405-esque 400 for any other status). Editable fields: supplier, outlet_code, payment_terms, notes, items[]. Total recomputed on save. Stamps `updated_by`/`updated_at`.
    - `POST /api/orders/{id}/cancel` — now **admin only**, requires JSON body `{ reason }`. Empty reason → 400. Stores `cancelled_reason`, `cancelled_by`, `cancelled_at`. Cannot cancel already-cancelled or fully-received POs.
    - New optional `payment_terms` field on POCreateIn / PO document; new `notes` field on ItemIn/ItemUpdateIn + outlet_code addable via PATCH.
  - Frontend:
    - OrdersPage: per-row **Edit** (visible only for waiting_approval, purchasing/admin) and **Cancel** (admin only, hidden for cancelled/received) buttons. Reuses the create modal for edit with title switching, payment-terms field, and dynamic "Save PO"/"Update PO" label. Cancel opens its own modal with a required reason textarea and a red "Confirm cancel" button.
    - InventoryPage: per-row **Edit** action (admin/purchasing/warehouse). Reuses the add modal — SKU is locked in edit mode, initial stock hidden, notes textarea added, and a business-rule notice reminds users that price/UOM updates apply to **new transactions only** (historical PO/GRN/issues keep original values via cost_at_issue snapshots).
    - Item picker CSS supports focus-styled combobox; new `.primary-button.danger` + `.form-hint` styles.
  - Print PO template now prefers `po.payment_terms` over supplier's default.
- **2026-08-26 (later³)**: Purchase Order item picker upgraded to a searchable typeahead combobox.
  - New reusable `ItemPicker` component (`/app/frontend/src/components/ItemPicker.jsx`) with type-to-filter (matches name/SKU/category), keyboard nav (↑/↓/Enter/Esc), clear button, category+outlet+unit metadata on each option, and a "show first 100 + refine" guard for very large catalogs.
  - Wired into OrdersPage line rows. Selecting an item still auto-fills price from item.cost.
- **2026-08-26 (later²)**: Added bulk delete for supplier catalog.
  - Backend: `POST /api/suppliers/bulk-delete` (admin only) accepts `{ ids: string[] }`, returns `{ deleted, requested, invalid }`. Invalid IDs are reported but do not block the operation.
  - Frontend: SuppliersPage now has a checkbox column, "Select all" master checkbox, per-row selection, and a red "Delete selected (n)" button that appears only when items are selected. Confirmation prompt guards the delete.
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
