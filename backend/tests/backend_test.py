"""HINTO Inventory backend API tests (pytest)."""
import io
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "admin": ("admin@hinto.id", "admin123"),
    "purchasing": ("purchasing@hinto.id", "demo123"),
    "warehouse": ("warehouse@hinto.id", "demo123"),
    "finance": ("finance@hinto.id", "demo123"),
}

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _login(role):
    email, pwd = CREDS[role]
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login failed for {role}: {r.status_code} {r.text[:300]}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def tokens():
    return {role: _login(role) for role in CREDS}


def cl(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="session")
def admin(tokens):
    return cl(tokens["admin"])


# ------------------------------------------------------------------ health/auth
class TestHealthAuth:
    def test_health(self):
        r = requests.get(f"{API}/health", timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_login_all_roles(self, tokens):
        for role, tok in tokens.items():
            assert isinstance(tok, str) and len(tok) > 20, role

    def test_login_bad_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": "admin@hinto.id", "password": "nope"}, timeout=30)
        assert r.status_code == 401

    def test_me(self, admin):
        r = admin.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == "admin@hinto.id"
        assert d["role"] == "admin"
        assert "password_hash" not in d
        assert "_id" not in d and "id" in d

    def test_no_token_401(self):
        r = requests.get(f"{API}/items", timeout=30)
        assert r.status_code == 401

    def test_bad_token_401(self):
        r = requests.get(f"{API}/items", headers={"Authorization": "Bearer garbage"}, timeout=30)
        assert r.status_code == 401


# ------------------------------------------------------------------ outlets/items
class TestItems:
    created = []

    def test_outlets_seeded(self, admin):
        r = admin.get(f"{API}/outlets", timeout=30)
        assert r.status_code == 200
        codes = {o["code"] for o in r.json()}
        assert {"main_wh", "kitchen", "bar", "housekeeping"} <= codes

    def test_items_seeded(self, admin):
        r = admin.get(f"{API}/items", timeout=30)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 10
        assert all("_id" not in i for i in items)
        assert all("id" in i and "sku" in i for i in items)

    def test_items_search_filter(self, admin):
        r = admin.get(f"{API}/items", params={"search": "salmon"}, timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 1
        assert all("salmon" in i["name"].lower() for i in r.json())

    def test_items_outlet_filter(self, admin):
        r = admin.get(f"{API}/items", params={"outlet": "bar"}, timeout=30)
        assert r.status_code == 200
        assert all(i["outlet_code"] == "bar" for i in r.json())

    def test_create_update_delete_item(self, admin):
        sku = f"TEST-{uuid.uuid4().hex[:8]}"
        payload = {"sku": sku, "name": "TEST_Item QA", "category": "QA", "unit": "pcs",
                   "cost": 1000, "min_stock": 2, "stock": 5, "supplier": "TEST_Sup",
                   "outlet_code": "kitchen"}
        r = admin.post(f"{API}/items", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        item_id = d["id"]
        assert d["name"] == "TEST_Item QA" and d["sku"] == sku and d["cost"] == 1000

        # GET verify persistence
        g = admin.get(f"{API}/items", params={"search": "TEST_Item QA"}, timeout=30)
        assert any(i["id"] == item_id for i in g.json())

        # duplicate SKU
        dup = admin.post(f"{API}/items", json=payload, timeout=30)
        assert dup.status_code == 400

        # PATCH
        p = admin.patch(f"{API}/items/{item_id}", json={"cost": 2500, "name": "TEST_Item QA2"}, timeout=30)
        assert p.status_code == 200
        assert p.json()["cost"] == 2500
        g = admin.get(f"{API}/items", params={"search": "TEST_Item QA2"}, timeout=30)
        got = [i for i in g.json() if i["id"] == item_id]
        assert got and got[0]["cost"] == 2500

        # DELETE
        dl = admin.delete(f"{API}/items/{item_id}", timeout=30)
        assert dl.status_code == 200
        g = admin.get(f"{API}/items", params={"search": "TEST_Item QA2"}, timeout=30)
        assert not [i for i in g.json() if i["id"] == item_id]

    def test_create_item_missing_name_422(self, admin):
        r = admin.post(f"{API}/items", json={"category": "x", "unit": "pcs"}, timeout=30)
        assert r.status_code == 422

    def test_patch_unknown_item_404(self, admin):
        r = admin.patch(f"{API}/items/{'a'*24}", json={"cost": 1}, timeout=30)
        assert r.status_code == 404

    def test_patch_invalid_objectid(self, admin):
        r = admin.patch(f"{API}/items/not-an-oid", json={"cost": 1}, timeout=30)
        assert r.status_code in (400, 404, 422), f"got {r.status_code} {r.text[:200]}"


# ------------------------------------------------------------------ RBAC
class TestRBAC:
    def test_purchasing_cannot_approve_po(self, tokens, admin):
        c = cl(tokens["purchasing"])
        items = admin.get(f"{API}/items", timeout=30).json()
        po = c.post(f"{API}/orders", json={"supplier": "TEST_S", "outlet_code": "kitchen",
                    "items": [{"item_id": items[0]["id"], "name": items[0]["name"], "qty": 1,
                               "unit": items[0]["unit"], "price": 100}]}, timeout=30)
        assert po.status_code == 200, po.text
        pid = po.json()["id"]
        r = c.post(f"{API}/orders/{pid}/approve", timeout=30)
        assert r.status_code == 403
        # finance can approve
        f = cl(tokens["finance"])
        r2 = f.post(f"{API}/orders/{pid}/approve", timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "approved"
        # double approve rejected
        assert f.post(f"{API}/orders/{pid}/approve", timeout=30).status_code == 400

    def test_finance_cannot_create_issue(self, tokens, admin):
        f = cl(tokens["finance"])
        items = admin.get(f"{API}/items", timeout=30).json()
        r = f.post(f"{API}/issues", json={"to_outlet": "kitchen", "from_outlet": "main_wh",
                   "items": [{"item_id": items[0]["id"], "name": items[0]["name"], "qty": 1,
                              "unit": items[0]["unit"]}]}, timeout=30)
        assert r.status_code == 403

    def test_warehouse_cannot_approve_opname(self, tokens, admin):
        w = cl(tokens["warehouse"])
        items = admin.get(f"{API}/items", timeout=30).json()
        op = w.post(f"{API}/opnames", json={"outlet_code": "kitchen",
                    "items": [{"item_id": items[0]["id"], "name": items[0]["name"],
                               "physical_qty": float(items[0]["stock"])}]}, timeout=30)
        assert op.status_code == 200, op.text
        r = w.post(f"{API}/opnames/{op.json()['id']}/approve", timeout=30)
        assert r.status_code == 403

    def test_warehouse_cannot_create_po(self, tokens):
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/orders", json={"supplier": "x", "outlet_code": "kitchen", "items": []}, timeout=30)
        assert r.status_code == 403

    def test_non_admin_cannot_list_users(self, tokens):
        r = cl(tokens["warehouse"]).get(f"{API}/users", timeout=30)
        assert r.status_code == 403

    def test_purchasing_cannot_post_revenue(self, tokens):
        r = cl(tokens["purchasing"]).post(f"{API}/revenues",
                json={"date": TODAY, "outlet_code": "bar", "amount": 1}, timeout=30)
        assert r.status_code == 403


# ------------------------------------------------------------------ receiving / HPP
class TestReceivingHPP:
    """Receiving now REQUIRES an approved Purchase Order (iteration 3)."""

    def _make_item(self, admin, tag, cost=100, stock=10):
        sku = f"TEST{tag}-{uuid.uuid4().hex[:6]}"
        r = admin.post(f"{API}/items", json={"sku": sku, "name": f"TEST_{tag} item", "category": "QA",
                       "unit": "kg", "cost": cost, "stock": stock, "min_stock": 1,
                       "outlet_code": "kitchen"}, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def _make_po(self, tokens, item, qty=10, price=200, approve=True):
        p = cl(tokens["purchasing"])
        r = p.post(f"{API}/orders", json={"supplier": "TEST_Sup", "outlet_code": "main_wh",
                   "items": [{"item_id": item["id"], "name": item["name"], "qty": qty,
                              "unit": item.get("unit", "kg"), "price": price}]}, timeout=30)
        assert r.status_code == 200, r.text
        po = r.json()
        if approve:
            f = cl(tokens["finance"])
            ra = f.post(f"{API}/orders/{po['id']}/approve", timeout=30)
            assert ra.status_code == 200, ra.text
            po = ra.json()
            assert po["status"] == "approved"
        return po

    def test_receiving_without_po_400(self, tokens, admin):
        it = self._make_item(admin, "NOPO")
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/receivings", json={"supplier": "TEST_Sup", "outlet_code": "main_wh",
                   "items": [{"item_id": it["id"], "name": it["name"], "qty": 5, "unit": "kg",
                              "price": 100}]}, timeout=30)
        assert r.status_code == 400, r.text
        assert "wajib merujuk Purchase Order" in r.json()["detail"]
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_receiving_invalid_po_id_400(self, tokens, admin):
        it = self._make_item(admin, "BADPO")
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/receivings", json={"po_id": "notavalidid", "supplier": "x",
                   "outlet_code": "main_wh",
                   "items": [{"item_id": it["id"], "name": it["name"], "qty": 1, "unit": "kg",
                              "price": 1}]}, timeout=30)
        assert r.status_code == 400, r.text
        r2 = w.post(f"{API}/receivings", json={"po_id": "a" * 24, "supplier": "x",
                    "outlet_code": "main_wh",
                    "items": [{"item_id": it["id"], "name": it["name"], "qty": 1, "unit": "kg",
                               "price": 1}]}, timeout=30)
        assert r2.status_code == 404, r2.text
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_receiving_unapproved_po_400(self, tokens, admin):
        it = self._make_item(admin, "WAIT")
        po = self._make_po(tokens, it, approve=False)
        assert po["status"] == "waiting_approval"
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                   "outlet_code": "main_wh",
                   "items": [{"item_id": it["id"], "name": it["name"], "qty": 1, "unit": "kg",
                              "price": 100}]}, timeout=30)
        assert r.status_code == 400, r.text
        assert "tidak dapat diterima" in r.json()["detail"], r.text
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_receiving_item_not_in_po_400(self, tokens, admin):
        it = self._make_item(admin, "INPO")
        other = self._make_item(admin, "OUTPO")
        po = self._make_po(tokens, it)
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                   "outlet_code": "main_wh",
                   "items": [{"item_id": other["id"], "name": other["name"], "qty": 1,
                              "unit": "kg", "price": 100}]}, timeout=30)
        assert r.status_code == 400, r.text
        assert "tidak terdapat pada PO" in r.json()["detail"]
        admin.delete(f"{API}/items/{it['id']}", timeout=30)
        admin.delete(f"{API}/items/{other['id']}", timeout=30)

    def test_weighted_average_hpp_via_po(self, tokens, admin):
        it = self._make_item(admin, "WA", cost=100, stock=10)
        po = self._make_po(tokens, it, qty=10, price=200)
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                   "outlet_code": "main_wh",
                   "items": [{"item_id": it["id"], "name": it["name"], "qty": 10, "unit": "kg",
                              "price": 200}]}, timeout=30)
        assert r.status_code == 200, r.text
        grn = r.json()
        assert grn["total"] == 2000
        assert grn["po_number"] == po["po_number"]
        line = grn["items"][0]
        assert line["new_stock"] == 20
        assert abs(line["new_avg_cost"] - 150) < 1e-6, line
        # verify persisted on item
        got = [i for i in admin.get(f"{API}/items", params={"search": "TEST_WA item"}, timeout=30).json()
               if i["id"] == it["id"]][0]
        assert got["stock"] == 20 and abs(got["cost"] - 150) < 1e-6
        # PO auto-moved to received
        orders = admin.get(f"{API}/orders", timeout=30).json()
        po_after = [o for o in orders if o["id"] == po["id"]][0]
        assert po_after["status"] == "received", po_after["status"]
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_list_receivings(self, admin):
        r = admin.get(f"{API}/receivings", timeout=30)
        assert r.status_code == 200 and isinstance(r.json(), list)


# ------------------------------------------------------------------ iteration 3: SKU search, analytics, seed
class TestSkuAndAnalytics:
    def test_seed_items_unique_category_skus(self, admin):
        items = admin.get(f"{API}/items", timeout=30).json()
        seeded = [i for i in items if not i["name"].startswith("TEST_")]
        assert len(seeded) >= 13, f"expected >=13 seeded items, got {len(seeded)}"
        skus = [i["sku"] for i in seeded]
        assert len(skus) == len(set(skus)), "duplicate SKUs in seed"
        prefixes = {s.split("-")[0] for s in skus}
        for expected in ["PRT", "VEG", "AMN", "DRY", "BEV"]:
            assert expected in prefixes, f"missing SKU prefix {expected}: {sorted(prefixes)}"

    def test_search_matches_sku_and_name(self, admin):
        r = admin.get(f"{API}/items", params={"search": "PRT"}, timeout=30)
        assert r.status_code == 200
        by_sku = r.json()
        assert by_sku, "search=PRT returned no items"
        assert all("prt" in i["sku"].lower() or "prt" in i["name"].lower() for i in by_sku)
        assert any(i["category"] == "Protein" for i in by_sku)
        # lowercase must work too (case-insensitive)
        r_low = admin.get(f"{API}/items", params={"search": "prt"}, timeout=30)
        assert len(r_low.json()) == len(by_sku)
        r2 = admin.get(f"{API}/items", params={"search": "daging"}, timeout=30)
        assert r2.status_code == 200
        assert any("daging" in i["name"].lower() for i in r2.json()), r2.json()

    def test_analytics_shape(self, admin):
        r = admin.get(f"{API}/analytics", params={"days": 7}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ["trend", "top_consumed", "categories", "outlet_valuation", "procurement"]:
            assert key in d, f"missing key {key}: {list(d.keys())}"
        assert len(d["trend"]) == 7, len(d["trend"])
        for row in d["trend"]:
            assert {"date", "cost", "revenue", "percentage"} <= set(row.keys())
        assert isinstance(d["top_consumed"], list)
        assert d["categories"] and {"category", "value", "items"} <= set(d["categories"][0].keys())
        assert d["outlet_valuation"] and "value" in d["outlet_valuation"][0]
        assert isinstance(d["procurement"], dict) or isinstance(d["procurement"], list)

    def test_analytics_days_clamped(self, admin):
        r = admin.get(f"{API}/analytics", params={"days": 1}, timeout=60)
        assert r.status_code == 200 and len(r.json()["trend"]) == 1
        r2 = admin.get(f"{API}/analytics", params={"days": 999}, timeout=60)
        assert r2.status_code == 200 and len(r2.json()["trend"]) == 60

    def test_analytics_requires_auth(self):
        r = requests.get(f"{API}/analytics", timeout=30)
        assert r.status_code == 401

    def test_create_item_autogenerates_sku(self, admin):
        r = admin.post(f"{API}/items", json={"name": f"TEST_autosku {uuid.uuid4().hex[:5]}",
                       "category": "QA", "unit": "pcs", "cost": 10, "stock": 1,
                       "min_stock": 0, "outlet_code": "kitchen"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("sku"), "SKU not auto-generated"
        admin.delete(f"{API}/items/{d['id']}", timeout=30)

    def test_duplicate_sku_400(self, admin):
        items = admin.get(f"{API}/items", timeout=30).json()
        existing = items[0]["sku"]
        r = admin.post(f"{API}/items", json={"sku": existing, "name": "TEST_dupe",
                       "category": "QA", "unit": "pcs", "cost": 1, "stock": 0,
                       "min_stock": 0, "outlet_code": "kitchen"}, timeout=30)
        assert r.status_code == 400 and "SKU" in r.json()["detail"]


# ------------------------------------------------------------------ issues / flash cost
class TestIssuesFlash:
    def test_issue_deducts_stock_and_flash_cost(self, tokens, admin):
        sku = f"TESTIS-{uuid.uuid4().hex[:6]}"
        it = admin.post(f"{API}/items", json={"sku": sku, "name": "TEST_Issue item", "category": "QA",
                        "unit": "kg", "cost": 1000, "stock": 50, "min_stock": 1,
                        "outlet_code": "main_wh"}, timeout=30).json()
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/issues", json={"to_outlet": "bar", "from_outlet": "main_wh",
                   "items": [{"item_id": it["id"], "name": it["name"], "qty": 5, "unit": "kg"}]}, timeout=30)
        assert r.status_code == 200, r.text
        iss = r.json()
        assert iss["total_cost"] == 5000
        assert iss["items"][0]["cost_at_issue"] == 1000
        assert iss["issue_date"] == TODAY
        got = [i for i in admin.get(f"{API}/items", params={"search": "TEST_Issue item"}, timeout=30).json()
               if i["id"] == it["id"]][0]
        assert got["stock"] == 45

        # revenue upsert by finance
        f = cl(tokens["finance"])
        rev = f.post(f"{API}/revenues", json={"date": TODAY, "outlet_code": "bar", "amount": 100000}, timeout=30)
        assert rev.status_code == 200, rev.text
        assert rev.json()["amount"] == 100000
        # upsert same key updates
        rev2 = f.post(f"{API}/revenues", json={"date": TODAY, "outlet_code": "bar", "amount": 50000}, timeout=30)
        assert rev2.status_code == 200 and rev2.json()["amount"] == 50000
        lst = f.get(f"{API}/revenues", params={"date": TODAY, "outlet": "bar"}, timeout=30).json()
        assert len(lst) == 1 and lst[0]["amount"] == 50000

        # flash cost reflects
        fc = admin.get(f"{API}/flash-cost", params={"date": TODAY}, timeout=30)
        assert fc.status_code == 200, fc.text
        data = fc.json()
        bar = [o for o in data["outlets"] if o["outlet_code"] == "bar"][0]
        assert bar["revenue"] == 50000
        assert bar["cost"] >= 5000
        expected = round(bar["cost"] / bar["revenue"] * 100, 2)
        assert abs(bar["cost_percentage"] - expected) < 0.01
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_issue_insufficient_stock_400(self, tokens, admin):
        items = admin.get(f"{API}/items", timeout=30).json()
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/issues", json={"to_outlet": "kitchen",
                   "items": [{"item_id": items[0]["id"], "name": items[0]["name"],
                              "qty": 999999, "unit": items[0]["unit"]}]}, timeout=30)
        assert r.status_code == 400
        assert "tidak mencukupi" in r.json()["detail"]

    def test_flash_cost_no_data_date(self, admin):
        r = admin.get(f"{API}/flash-cost", params={"date": "1999-01-01"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["total_cost"] == 0 and d["total_revenue"] == 0 and d["total_percentage"] == 0
        assert len(d["outlets"]) >= 4


# ------------------------------------------------------------------ opname
class TestOpname:
    def test_opname_flow_adjusts_stock(self, tokens, admin):
        sku = f"TESTOP-{uuid.uuid4().hex[:6]}"
        it = admin.post(f"{API}/items", json={"sku": sku, "name": "TEST_Opname item", "category": "QA",
                        "unit": "pcs", "cost": 500, "stock": 30, "min_stock": 1,
                        "outlet_code": "kitchen"}, timeout=30).json()
        w = cl(tokens["warehouse"])
        op = w.post(f"{API}/opnames", json={"outlet_code": "kitchen",
                    "items": [{"item_id": it["id"], "name": it["name"], "physical_qty": 25}]}, timeout=30)
        assert op.status_code == 200, op.text
        d = op.json()
        assert d["status"] == "draft"
        assert d["items"][0]["variance"] == -5
        assert d["total_variance_value"] == -2500
        f = cl(tokens["finance"])
        ap = f.post(f"{API}/opnames/{d['id']}/approve", timeout=30)
        assert ap.status_code == 200, ap.text
        assert ap.json()["status"] == "approved"
        got = [i for i in admin.get(f"{API}/items", params={"search": "TEST_Opname item"}, timeout=30).json()
               if i["id"] == it["id"]][0]
        assert got["stock"] == 25
        # re-approve rejected
        assert f.post(f"{API}/opnames/{d['id']}/approve", timeout=30).status_code == 400
        admin.delete(f"{API}/items/{it['id']}", timeout=30)


# ------------------------------------------------------------------ dashboard / recipes
class TestDashboardRecipes:
    def test_dashboard(self, admin):
        r = admin.get(f"{API}/dashboard", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("valuation", "low_stock_count", "pending_po", "flash_cost_pct", "activities"):
            assert k in d
        assert d["valuation"] > 0
        assert isinstance(d["activities"], list)
        assert all("_id" not in i for i in d.get("low_stock_items", []))

    def test_recipe_hpp(self, tokens, admin):
        # use a dedicated item so parallel cleanup of shared items cannot zero out HPP
        it = admin.post(f"{API}/items", json={"sku": f"TESTRCP-{uuid.uuid4().hex[:6]}",
                        "name": "TEST_RCP item", "category": "QA", "unit": "kg", "cost": 5000,
                        "stock": 10, "min_stock": 1, "outlet_code": "kitchen"}, timeout=30).json()
        f = cl(tokens["finance"])
        rname = f"TEST_Nasi goreng {uuid.uuid4().hex[:6]}"
        r = f.post(f"{API}/recipes", json={"name": rname, "outlet_code": "kitchen",
                   "selling_price": 100000, "ingredients": [
                       {"item_id": it["id"], "name": it["name"], "qty": 1,
                        "unit": it["unit"]}]}, timeout=30)
        assert r.status_code == 200, r.text
        lst = f.get(f"{API}/recipes", timeout=30).json()
        mine = [x for x in lst if x["name"] == rname]
        assert mine, "recipe not persisted"
        assert mine[0]["hpp"] == 5000, mine[0]
        assert "margin_pct" in mine[0]
        admin.delete(f"{API}/items/{it['id']}", timeout=30)


# ------------------------------------------------------------------ CSV bulk uploads
def _csv(text):
    return io.BytesIO(text.encode("utf-8"))


class TestBulkUpload:
    def test_items_bulk_upload_create_and_update(self, admin):
        sku = f"TESTB-{uuid.uuid4().hex[:6]}"
        text = ("name,category,unit,cost,min_stock,stock,supplier,outlet_code,sku\n"
                f"TEST_Sabun cair,Amenities,liter,25000,5,10,CV Test,housekeeping,{sku}\n"
                "TEST_Tanpa sku,Amenities,pcs,1000,1,2,CV Test,housekeeping,\n")
        r = admin.post(f"{API}/items/bulk-upload",
                       files={"file": ("items.csv", _csv(text), "text/csv")}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 2, d
        assert d["errors"] == []
        got = admin.get(f"{API}/items", params={"search": "TEST_Sabun cair"}, timeout=30).json()
        assert got and got[0]["cost"] == 25000 and got[0]["unit"] == "liter"
        iid = got[0]["id"]

        # re-upload same sku -> update
        text2 = ("name,category,unit,cost,min_stock,stock,supplier,outlet_code,sku\n"
                 f"TEST_Sabun cair,Amenities,liter,30000,5,12,CV Test,housekeeping,{sku}\n")
        r2 = admin.post(f"{API}/items/bulk-upload",
                        files={"file": ("items.csv", _csv(text2), "text/csv")}, timeout=60)
        assert r2.status_code == 200
        assert r2.json()["updated"] == 1, r2.json()
        got2 = [i for i in admin.get(f"{API}/items", params={"search": "TEST_Sabun cair"}, timeout=30).json()
                if i["id"] == iid][0]
        assert got2["cost"] == 30000 and got2["stock"] == 12

        # cleanup
        for i in admin.get(f"{API}/items", params={"search": "TEST_Sabun cair"}, timeout=30).json():
            admin.delete(f"{API}/items/{i['id']}", timeout=30)
        for i in admin.get(f"{API}/items", params={"search": "TEST_Tanpa sku"}, timeout=30).json():
            admin.delete(f"{API}/items/{i['id']}", timeout=30)

    def test_items_bulk_missing_name_error_row(self, admin):
        text = ("name,category,unit,cost,min_stock,stock,supplier,outlet_code\n"
                ",Amenities,pcs,1000,1,2,CV Test,housekeeping\n")
        r = admin.post(f"{API}/items/bulk-upload",
                       files={"file": ("items.csv", _csv(text), "text/csv")}, timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["created"] == 0 and len(d["errors"]) == 1

    def test_bulk_empty_csv_400(self, admin):
        r = admin.post(f"{API}/items/bulk-upload",
                       files={"file": ("items.csv", _csv(""), "text/csv")}, timeout=60)
        assert r.status_code == 400

    def test_orders_bulk_upload(self, tokens, admin):
        items = admin.get(f"{API}/items", timeout=30).json()
        sku_a, sku_b = items[0]["sku"], items[1]["sku"]
        ref = f"TESTPO-{uuid.uuid4().hex[:6]}"
        text = ("po_ref,supplier,outlet_code,item_sku,qty,price,notes\n"
                f"{ref},TEST_Supplier,kitchen,{sku_a},2,1000,bulk test\n"
                f"{ref},TEST_Supplier,kitchen,{sku_b},3,2000,\n"
                f"{ref}-bad,TEST_Supplier,kitchen,NOPE-9999,1,1,\n")
        p = cl(tokens["purchasing"])
        r = p.post(f"{API}/orders/bulk-upload",
                   files={"file": ("po.csv", _csv(text), "text/csv")}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 1, d
        assert any("NOPE-9999" in e for e in d["errors"]), d
        orders = p.get(f"{API}/orders", timeout=30).json()
        mine = [o for o in orders if o["supplier"] == "TEST_Supplier" and len(o["items"]) == 2]
        assert mine, "bulk PO not persisted"
        assert mine[0]["total"] == 2 * 1000 + 3 * 2000
        assert mine[0]["status"] == "waiting_approval"

    def test_receivings_bulk_upload_applies_wa(self, tokens, admin):
        """New CSV shape: po_number,item_sku,qty,price[,notes] — grouped per PO."""
        sku = f"TESTRB-{uuid.uuid4().hex[:6]}"
        it = admin.post(f"{API}/items", json={"sku": sku, "name": "TEST_RB item", "category": "QA",
                        "unit": "kg", "cost": 100, "stock": 10, "min_stock": 1,
                        "outlet_code": "kitchen"}, timeout=30).json()
        p = cl(tokens["purchasing"])
        po = p.post(f"{API}/orders", json={"supplier": "TEST_Sup", "outlet_code": "main_wh",
                    "items": [{"item_id": it["id"], "name": it["name"], "qty": 10, "unit": "kg",
                               "price": 300}]}, timeout=30).json()
        f = cl(tokens["finance"])
        approved = f.post(f"{API}/orders/{po['id']}/approve", timeout=30).json()
        assert approved["status"] == "approved"
        text = ("po_number,item_sku,qty,price,notes\n"
                f"{po['po_number']},{sku},10,300,bulk grn\n"
                f"{po['po_number']},NOPE-9999,1,1,\n")
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/receivings/bulk-upload",
                   files={"file": ("grn.csv", _csv(text), "text/csv")}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 1, d
        assert any("NOPE-9999" in e for e in d["errors"]), d
        got = [i for i in admin.get(f"{API}/items", params={"search": "TEST_RB item"}, timeout=30).json()
               if i["id"] == it["id"]][0]
        assert got["stock"] == 20
        assert abs(got["cost"] - 200) < 1e-6, got["cost"]
        orders = admin.get(f"{API}/orders", timeout=30).json()
        assert [o for o in orders if o["id"] == po["id"]][0]["status"] == "received"
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_receivings_bulk_upload_rejects_unapproved_and_unknown_po(self, tokens, admin):
        sku = f"TESTRU-{uuid.uuid4().hex[:6]}"
        it = admin.post(f"{API}/items", json={"sku": sku, "name": "TEST_RU item", "category": "QA",
                        "unit": "kg", "cost": 100, "stock": 5, "min_stock": 1,
                        "outlet_code": "kitchen"}, timeout=30).json()
        p = cl(tokens["purchasing"])
        po = p.post(f"{API}/orders", json={"supplier": "TEST_Sup", "outlet_code": "main_wh",
                    "items": [{"item_id": it["id"], "name": it["name"], "qty": 5, "unit": "kg",
                               "price": 100}]}, timeout=30).json()
        text = ("po_number,item_sku,qty,price\n"
                f"{po['po_number']},{sku},5,100\n"
                f"PO-DOESNOTEXIST,{sku},1,100\n")
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/receivings/bulk-upload",
                   files={"file": ("grn.csv", _csv(text), "text/csv")}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 0, d
        assert any("tidak dapat diterima" in e for e in d["errors"]), d
        assert any("tidak ditemukan" in e for e in d["errors"]), d
        got = [i for i in admin.get(f"{API}/items", params={"search": "TEST_RU item"}, timeout=30).json()
               if i["id"] == it["id"]][0]
        assert got["stock"] == 5, "stock must not change when PO rejected"
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_issues_bulk_upload_deducts_and_reports_errors(self, tokens, admin):
        sku = f"TESTIB-{uuid.uuid4().hex[:6]}"
        it = admin.post(f"{API}/items", json={"sku": sku, "name": "TEST_IB item", "category": "QA",
                        "unit": "kg", "cost": 500, "stock": 20, "min_stock": 1,
                        "outlet_code": "main_wh"}, timeout=30).json()
        ref = f"TESTISS-{uuid.uuid4().hex[:6]}"
        text = ("issue_ref,from_outlet,to_outlet,item_sku,qty,notes\n"
                f"{ref},main_wh,kitchen,{sku},4,bulk\n"
                f"{ref}-over,main_wh,kitchen,{sku},99999,\n"
                f"{ref}-noout,main_wh,,{sku},1,\n")
        w = cl(tokens["warehouse"])
        r = w.post(f"{API}/issues/bulk-upload",
                   files={"file": ("iss.csv", _csv(text), "text/csv")}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["created"] == 1, d
        assert any("tidak cukup" in e for e in d["errors"]), d
        assert any("to_outlet kosong" in e for e in d["errors"]), d
        got = [i for i in admin.get(f"{API}/items", params={"search": "TEST_IB item"}, timeout=30).json()
               if i["id"] == it["id"]][0]
        assert got["stock"] == 16
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_bulk_upload_rbac(self, tokens):
        f = cl(tokens["finance"])
        text = "name,category,unit,cost\nTEST_x,QA,pcs,1\n"
        r = f.post(f"{API}/items/bulk-upload",
                   files={"file": ("items.csv", _csv(text), "text/csv")}, timeout=60)
        assert r.status_code == 403
        r2 = f.post(f"{API}/issues/bulk-upload",
                    files={"file": ("i.csv", _csv("issue_ref,to_outlet,item_sku,qty\na,kitchen,X,1\n"), "text/csv")},
                    timeout=60)
        assert r2.status_code == 403


# ------------------------------------------------------------------ iteration 4: partial receive
class TestPartialReceive:
    """1 PO can be received across multiple GRNs; PO auto-closes when all lines complete."""

    def _item(self, admin, tag, cost=100, stock=0):
        sku = f"TEST{tag}-{uuid.uuid4().hex[:6]}"
        r = admin.post(f"{API}/items", json={"sku": sku, "name": f"TEST_{tag} item", "category": "QA",
                       "unit": "kg", "cost": cost, "stock": stock, "min_stock": 1,
                       "outlet_code": "kitchen"}, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def _po(self, tokens, lines, approve=True):
        p = cl(tokens["purchasing"])
        r = p.post(f"{API}/orders", json={"supplier": "TEST_Sup", "outlet_code": "main_wh",
                   "items": lines}, timeout=30)
        assert r.status_code == 200, r.text
        po = r.json()
        if approve:
            po = cl(tokens["finance"]).post(f"{API}/orders/{po['id']}/approve", timeout=30).json()
            assert po["status"] == "approved"
        return po

    def _po_state(self, admin, po_id):
        orders = admin.get(f"{API}/orders", timeout=30).json()
        return [o for o in orders if o["id"] == po_id][0]

    def test_two_step_partial_then_full(self, tokens, admin):
        it = self._item(admin, "PART", cost=100, stock=0)
        po = self._po(tokens, [{"item_id": it["id"], "name": it["name"], "qty": 20,
                                "unit": "kg", "price": 200}])
        w = cl(tokens["warehouse"])
        # GRN 1 - partial 5/20
        r1 = w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                    "outlet_code": "main_wh",
                    "items": [{"item_id": it["id"], "name": it["name"], "qty": 5,
                               "unit": "kg", "price": 200}]}, timeout=30)
        assert r1.status_code == 200, r1.text
        st = self._po_state(admin, po["id"])
        assert st["status"] == "partial", st["status"]
        assert st["items"][0]["received_qty"] == 5, st["items"][0]
        assert not st.get("received_at")
        # GRN 2 - completes 20/20
        r2 = w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                    "outlet_code": "main_wh",
                    "items": [{"item_id": it["id"], "name": it["name"], "qty": 15,
                               "unit": "kg", "price": 200}]}, timeout=30)
        assert r2.status_code == 200, r2.text
        st2 = self._po_state(admin, po["id"])
        assert st2["status"] == "received", st2["status"]
        assert st2["items"][0]["received_qty"] == 20
        assert st2.get("received_at"), "received_at must be set when fully received"
        # stock accumulated across both GRNs
        got = [i for i in admin.get(f"{API}/items", params={"search": it["sku"]}, timeout=30).json()
               if i["id"] == it["id"]][0]
        assert got["stock"] == 20, got["stock"]
        # third receive blocked
        r3 = w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                    "outlet_code": "main_wh",
                    "items": [{"item_id": it["id"], "name": it["name"], "qty": 1,
                               "unit": "kg", "price": 200}]}, timeout=30)
        assert r3.status_code == 400, r3.text
        assert "tidak dapat diterima (status: received)" in r3.json()["detail"], r3.text
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_receive_exceeding_remaining_400(self, tokens, admin):
        it = self._item(admin, "OVER", stock=0)
        po = self._po(tokens, [{"item_id": it["id"], "name": it["name"], "qty": 10,
                                "unit": "kg", "price": 100}])
        w = cl(tokens["warehouse"])
        # over on first receive
        r = w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                   "outlet_code": "main_wh",
                   "items": [{"item_id": it["id"], "name": it["name"], "qty": 11,
                              "unit": "kg", "price": 100}]}, timeout=30)
        assert r.status_code == 400, r.text
        assert "melebihi sisa PO" in r.json()["detail"], r.text
        # partial 4, then over on remaining 6
        assert w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                      "outlet_code": "main_wh",
                      "items": [{"item_id": it["id"], "name": it["name"], "qty": 4,
                                 "unit": "kg", "price": 100}]}, timeout=30).status_code == 200
        r2 = w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                    "outlet_code": "main_wh",
                    "items": [{"item_id": it["id"], "name": it["name"], "qty": 7,
                               "unit": "kg", "price": 100}]}, timeout=30)
        assert r2.status_code == 400, r2.text
        assert "melebihi sisa PO" in r2.json()["detail"], r2.text
        got = [i for i in admin.get(f"{API}/items", params={"search": it["sku"]}, timeout=30).json()
               if i["id"] == it["id"]][0]
        assert got["stock"] == 4, "rejected receive must not change stock"
        assert self._po_state(admin, po["id"])["status"] == "partial"
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_multi_line_partial(self, tokens, admin):
        a = self._item(admin, "MLA", stock=0)
        b = self._item(admin, "MLB", stock=0)
        po = self._po(tokens, [
            {"item_id": a["id"], "name": a["name"], "qty": 10, "unit": "kg", "price": 100},
            {"item_id": b["id"], "name": b["name"], "qty": 5, "unit": "kg", "price": 50},
        ])
        w = cl(tokens["warehouse"])
        # receive line A fully only -> still partial
        r = w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                   "outlet_code": "main_wh",
                   "items": [{"item_id": a["id"], "name": a["name"], "qty": 10,
                              "unit": "kg", "price": 100}]}, timeout=30)
        assert r.status_code == 200, r.text
        st = self._po_state(admin, po["id"])
        assert st["status"] == "partial", st["status"]
        # now receive B -> received
        r2 = w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
                    "outlet_code": "main_wh",
                    "items": [{"item_id": b["id"], "name": b["name"], "qty": 5,
                               "unit": "kg", "price": 50}]}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert self._po_state(admin, po["id"])["status"] == "received"
        admin.delete(f"{API}/items/{a['id']}", timeout=30)
        admin.delete(f"{API}/items/{b['id']}", timeout=30)

    def test_bulk_upload_partial_then_received(self, tokens, admin):
        it = self._item(admin, "BPART", cost=100, stock=0)
        po = self._po(tokens, [{"item_id": it["id"], "name": it["name"], "qty": 10,
                                "unit": "kg", "price": 100}])
        w = cl(tokens["warehouse"])
        text1 = f"po_number,item_sku,qty,price\n{po['po_number']},{it['sku']},6,100\n"
        r1 = w.post(f"{API}/receivings/bulk-upload",
                    files={"file": ("grn.csv", _csv(text1), "text/csv")}, timeout=60)
        assert r1.status_code == 200 and r1.json()["created"] == 1, r1.text
        assert self._po_state(admin, po["id"])["status"] == "partial"
        # over-remaining row rejected
        text_over = f"po_number,item_sku,qty,price\n{po['po_number']},{it['sku']},9,100\n"
        r_over = w.post(f"{API}/receivings/bulk-upload",
                        files={"file": ("grn.csv", _csv(text_over), "text/csv")}, timeout=60)
        assert r_over.status_code == 200, r_over.text
        assert r_over.json()["created"] == 0, r_over.json()
        assert any("melebihi sisa PO" in e for e in r_over.json()["errors"]), r_over.json()
        # complete remaining 4
        text2 = f"po_number,item_sku,qty,price\n{po['po_number']},{it['sku']},4,100\n"
        r2 = w.post(f"{API}/receivings/bulk-upload",
                    files={"file": ("grn.csv", _csv(text2), "text/csv")}, timeout=60)
        assert r2.status_code == 200 and r2.json()["created"] == 1, r2.text
        st = self._po_state(admin, po["id"])
        assert st["status"] == "received", st["status"]
        got = [i for i in admin.get(f"{API}/items", params={"search": it["sku"]}, timeout=30).json()
               if i["id"] == it["id"]][0]
        assert got["stock"] == 10, got["stock"]
        admin.delete(f"{API}/items/{it['id']}", timeout=30)

    def test_partial_status_visible_in_orders_list(self, tokens, admin):
        it = self._item(admin, "PSTAT", stock=0)
        po = self._po(tokens, [{"item_id": it["id"], "name": it["name"], "qty": 8,
                                "unit": "kg", "price": 10}])
        w = cl(tokens["warehouse"])
        w.post(f"{API}/receivings", json={"po_id": po["id"], "supplier": "TEST_Sup",
               "outlet_code": "main_wh",
               "items": [{"item_id": it["id"], "name": it["name"], "qty": 3,
                          "unit": "kg", "price": 10}]}, timeout=30)
        r = admin.get(f"{API}/orders", timeout=30)
        assert r.status_code == 200, r.text
        mine = [o for o in r.json() if o["id"] == po["id"]]
        assert mine and mine[0]["status"] == "partial", mine
        assert mine[0]["items"][0]["received_qty"] == 3
        admin.delete(f"{API}/items/{it['id']}", timeout=30)


# ------------------------------------------------------------------ iteration 4: supplier catalog
class TestSuppliers:
    def test_seeded_12_suppliers(self, admin):
        r = admin.get(f"{API}/suppliers", timeout=30)
        assert r.status_code == 200, r.text
        sups = r.json()
        codes = {s["code"] for s in sups}
        for i in range(1, 13):
            assert f"SUP-{i:04d}" in codes, f"missing SUP-{i:04d} in {sorted(codes)}"
        seeded = [s for s in sups if s["code"].startswith("SUP-00")]
        for s in seeded:
            assert "_id" not in s
            assert s.get("contact_person"), s
            assert s.get("phone"), s
            assert isinstance(s.get("lead_time_days"), (int, float)), s
            assert s.get("payment_terms"), s

    def test_search_by_name_and_code(self, admin):
        sups = admin.get(f"{API}/suppliers", timeout=30).json()
        target = [s for s in sups if s["code"] == "SUP-0003"][0]
        r = admin.get(f"{API}/suppliers", params={"search": "SUP-0003"}, timeout=30)
        assert r.status_code == 200
        assert [s["id"] for s in r.json()] == [target["id"]], r.json()
        name_frag = target["name"].split()[0]
        r2 = admin.get(f"{API}/suppliers", params={"search": name_frag}, timeout=30)
        assert r2.status_code == 200
        assert target["id"] in [s["id"] for s in r2.json()]
        r3 = admin.get(f"{API}/suppliers", params={"search": "ZZZNOTFOUND"}, timeout=30)
        assert r3.json() == []

    def test_crud_purchasing_create_admin_delete(self, tokens, admin):
        p = cl(tokens["purchasing"])
        code = f"TESTSUP-{uuid.uuid4().hex[:5]}"
        payload = {"code": code, "name": "TEST_Supplier QA", "contact_person": "Budi",
                   "phone": "0811", "email": "qa@test.id", "address": "Bali",
                   "lead_time_days": 3, "payment_terms": "NET 14"}
        r = p.post(f"{API}/suppliers", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        sup = r.json()
        assert sup["code"] == code and sup["lead_time_days"] == 3
        assert "_id" not in sup
        # GET verifies persistence
        got = admin.get(f"{API}/suppliers", params={"search": code}, timeout=30).json()
        assert len(got) == 1 and got[0]["payment_terms"] == "NET 14"
        # duplicate code
        assert p.post(f"{API}/suppliers", json=payload, timeout=30).status_code == 400
        # PATCH by purchasing
        r2 = p.patch(f"{API}/suppliers/{sup['id']}",
                     json={"name": "TEST_Supplier QA v2", "lead_time_days": 9}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["name"] == "TEST_Supplier QA v2" and r2.json()["lead_time_days"] == 9
        got2 = admin.get(f"{API}/suppliers", params={"search": code}, timeout=30).json()[0]
        assert got2["name"] == "TEST_Supplier QA v2" and got2["lead_time_days"] == 9
        # non-admin cannot delete
        assert p.delete(f"{API}/suppliers/{sup['id']}", timeout=30).status_code == 403
        # admin deletes
        assert admin.delete(f"{API}/suppliers/{sup['id']}", timeout=30).status_code == 200
        assert admin.get(f"{API}/suppliers", params={"search": code}, timeout=30).json() == []
        assert admin.delete(f"{API}/suppliers/{sup['id']}", timeout=30).status_code == 404

    def test_rbac_readonly_roles(self, tokens):
        for role in ("warehouse", "finance"):
            c = cl(tokens[role])
            assert c.get(f"{API}/suppliers", timeout=30).status_code == 200
            r = c.post(f"{API}/suppliers", json={"name": "TEST_x"}, timeout=30)
            assert r.status_code == 403, f"{role} POST -> {r.status_code}"

    def test_suppliers_requires_auth(self):
        assert requests.get(f"{API}/suppliers", timeout=30).status_code == 401

    def test_patch_unknown_and_invalid_id(self, admin):
        assert admin.patch(f"{API}/suppliers/{'a'*24}", json={"name": "x"}, timeout=30).status_code == 404
        assert admin.patch(f"{API}/suppliers/notanid", json={"name": "x"}, timeout=30).status_code == 400
