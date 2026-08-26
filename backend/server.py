from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import csv
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from bson import ObjectId
from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

# ==============================================================================
# Config
# ==============================================================================
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 12

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("hinto")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="HINTO Inventory API")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)


# ==============================================================================
# Helpers
# ==============================================================================
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": now_utc() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def serialize_doc(doc: dict) -> dict:
    if doc is None:
        return None
    d = dict(doc)
    if "_id" in d:
        d["id"] = str(d.pop("_id"))
    d.pop("password_hash", None)
    return d


def to_oid(value: str) -> ObjectId:
    """Safely convert string to ObjectId, raising 400 on invalid input."""
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=400, detail=f"ID tidak valid: {value}")


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return serialize_doc(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_roles(*roles: str):
    async def checker(user: dict = Depends(get_current_user)):
        if user.get("role") not in roles and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail=f"Requires role: {', '.join(roles)}")
        return user
    return checker


# ==============================================================================
# Pydantic Schemas (input)
# ==============================================================================
class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserCreateIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str  # admin | purchasing | warehouse | finance


class OutletIn(BaseModel):
    name: str
    code: str
    type: str  # warehouse | kitchen | bar | housekeeping


class SupplierIn(BaseModel):
    name: str
    code: Optional[str] = None
    contact_person: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    lead_time_days: Optional[int] = 0
    payment_terms: Optional[str] = ""
    notes: Optional[str] = ""


class SupplierUpdateIn(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    lead_time_days: Optional[int] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None


class ItemIn(BaseModel):
    sku: Optional[str] = None
    name: str
    category: str
    unit: str
    cost: float = 0
    min_stock: float = 0
    stock: float = 0
    supplier: Optional[str] = ""
    outlet_code: Optional[str] = "main_wh"


class ItemUpdateIn(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    cost: Optional[float] = None
    min_stock: Optional[float] = None
    stock: Optional[float] = None
    supplier: Optional[str] = None


class POLineIn(BaseModel):
    item_id: str
    name: str
    qty: float
    unit: str
    price: float


class POCreateIn(BaseModel):
    supplier: str
    outlet_code: str
    items: List[POLineIn]
    notes: Optional[str] = ""


class ReceivingLineIn(BaseModel):
    item_id: str
    name: str
    qty: float
    unit: str
    price: float


class ReceivingCreateIn(BaseModel):
    po_id: Optional[str] = None
    supplier: Optional[str] = None
    outlet_code: str = "main_wh"
    items: List[ReceivingLineIn]
    notes: Optional[str] = ""


class IssueLineIn(BaseModel):
    item_id: str
    name: str
    qty: float
    unit: str


class IssueCreateIn(BaseModel):
    to_outlet: str
    from_outlet: str = "main_wh"
    items: List[IssueLineIn]
    notes: Optional[str] = ""


class OpnameLineIn(BaseModel):
    item_id: str
    name: str
    physical_qty: float


class OpnameCreateIn(BaseModel):
    outlet_code: str = "main_wh"
    items: List[OpnameLineIn]
    notes: Optional[str] = ""


class RevenueIn(BaseModel):
    date: str  # YYYY-MM-DD
    outlet_code: str
    amount: float


# ==============================================================================
# Auth Endpoints
# ==============================================================================
@api.post("/auth/login")
async def login(payload: LoginIn):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email atau password salah")
    token = create_access_token(str(user["_id"]), user["email"], user["role"])
    return {"token": token, "user": serialize_doc(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api.post("/auth/register")
async def register(payload: UserCreateIn, user: dict = Depends(require_roles("admin"))):
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    if payload.role not in {"admin", "purchasing", "warehouse", "finance"}:
        raise HTTPException(status_code=400, detail="Role tidak valid")
    doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": payload.role,
        "created_at": iso(now_utc()),
    }
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


@api.get("/users")
async def list_users(user: dict = Depends(require_roles("admin"))):
    users = await db.users.find({}).sort("created_at", -1).to_list(500)
    return [serialize_doc(u) for u in users]


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None


@api.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    payload: UserUpdateIn,
    current_user: dict = Depends(require_roles("admin")),
):
    updates: Dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.role is not None:
        if payload.role not in {"admin", "purchasing", "warehouse", "finance"}:
            raise HTTPException(status_code=400, detail="Role tidak valid")
        updates["role"] = payload.role
    if payload.password:
        updates["password_hash"] = hash_password(payload.password)
    if not updates:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan")
    updates["updated_at"] = iso(now_utc())
    result = await db.users.update_one({"_id": to_oid(user_id)}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    doc = await db.users.find_one({"_id": to_oid(user_id)})
    return serialize_doc(doc)


@api.delete("/users/{user_id}")
async def delete_user(
    user_id: str, current_user: dict = Depends(require_roles("admin"))
):
    if str(current_user.get("id")) == user_id:
        raise HTTPException(status_code=400, detail="Tidak dapat menghapus akun sendiri")
    target = await db.users.find_one({"_id": to_oid(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    # Prevent deleting the last admin
    if target.get("role") == "admin":
        admin_count = await db.users.count_documents({"role": "admin"})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Minimal harus ada 1 admin")
    await db.users.delete_one({"_id": to_oid(user_id)})
    return {"deleted": True}


# ==============================================================================
# Outlets
# ==============================================================================
@api.get("/outlets")
async def list_outlets(user: dict = Depends(get_current_user)):
    outlets = await db.outlets.find({}).to_list(100)
    return [serialize_doc(o) for o in outlets]


@api.post("/outlets")
async def create_outlet(payload: OutletIn, user: dict = Depends(require_roles("admin"))):
    if await db.outlets.find_one({"code": payload.code}):
        raise HTTPException(status_code=400, detail="Kode outlet sudah ada")
    doc = payload.model_dump()
    doc["created_at"] = iso(now_utc())
    res = await db.outlets.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


# ==============================================================================
# Suppliers (Catalog)
# ==============================================================================
async def next_supplier_code() -> str:
    count = await db.suppliers.count_documents({})
    return f"SUP-{count + 1:04d}"


@api.get("/suppliers")
async def list_suppliers(
    search: Optional[str] = None, user: dict = Depends(get_current_user)
):
    query: Dict[str, Any] = {}
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"code": {"$regex": search, "$options": "i"}},
        ]
    docs = await db.suppliers.find(query).sort("name", 1).to_list(500)
    return [serialize_doc(d) for d in docs]


@api.post("/suppliers")
async def create_supplier(
    payload: SupplierIn, user: dict = Depends(require_roles("admin", "purchasing"))
):
    code = payload.code or await next_supplier_code()
    if await db.suppliers.find_one({"code": code}):
        raise HTTPException(status_code=400, detail="Kode supplier sudah ada")
    doc = payload.model_dump()
    doc["code"] = code
    doc["created_at"] = iso(now_utc())
    doc["updated_at"] = iso(now_utc())
    res = await db.suppliers.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


@api.patch("/suppliers/{supplier_id}")
async def update_supplier(
    supplier_id: str,
    payload: SupplierUpdateIn,
    user: dict = Depends(require_roles("admin", "purchasing")),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    updates["updated_at"] = iso(now_utc())
    result = await db.suppliers.update_one({"_id": to_oid(supplier_id)}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    doc = await db.suppliers.find_one({"_id": to_oid(supplier_id)})
    return serialize_doc(doc)


@api.delete("/suppliers/{supplier_id}")
async def delete_supplier(
    supplier_id: str, user: dict = Depends(require_roles("admin"))
):
    result = await db.suppliers.delete_one({"_id": to_oid(supplier_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    return {"deleted": True}


@api.get("/suppliers/{supplier_id}")
async def get_supplier(supplier_id: str, user: dict = Depends(get_current_user)):
    doc = await db.suppliers.find_one({"_id": to_oid(supplier_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    return serialize_doc(doc)


@api.get("/suppliers/{supplier_id}/orders")
async def supplier_orders(supplier_id: str, user: dict = Depends(get_current_user)):
    """Return purchase orders that reference this supplier (by name match)."""
    supplier = await db.suppliers.find_one({"_id": to_oid(supplier_id)})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier tidak ditemukan")
    # Match by exact supplier name (POs store name as string)
    orders = (
        await db.purchase_orders.find({"supplier": supplier["name"]})
        .sort("created_at", -1)
        .to_list(500)
    )
    orders_out = [serialize_doc(o) for o in orders]
    # Compute aggregates
    total_value = sum(float(o.get("total", 0)) for o in orders_out)
    by_status: Dict[str, int] = {}
    for o in orders_out:
        by_status[o["status"]] = by_status.get(o["status"], 0) + 1
    # Recent GRNs from this supplier
    grns = (
        await db.receivings.find({"supplier": supplier["name"]})
        .sort("received_at", -1)
        .to_list(100)
    )
    grns_out = [serialize_doc(g) for g in grns]
    total_grn = sum(float(g.get("total", 0)) for g in grns_out)
    return {
        "supplier": serialize_doc(supplier),
        "orders": orders_out,
        "receivings": grns_out,
        "stats": {
            "order_count": len(orders_out),
            "order_total": total_value,
            "grn_count": len(grns_out),
            "grn_total": total_grn,
            "by_status": by_status,
        },
    }


@api.post("/suppliers/bulk-upload")
async def suppliers_bulk_upload(
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("admin", "purchasing")),
):
    """CSV header: name,contact_person,phone,email,address,lead_time_days,payment_terms[,code,notes]"""
    content = await file.read()
    rows = _parse_csv(content)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV kosong atau format tidak dikenali")
    created, updated, errors = 0, 0, []
    for i, r in enumerate(rows, start=2):
        try:
            name = (r.get("name") or "").strip()
            if not name:
                errors.append(f"Baris {i}: nama supplier kosong")
                continue
            code = (r.get("code") or "").strip() or await next_supplier_code()
            lead = 0
            try:
                lead = int(_num(r.get("lead_time_days"), default=0))
            except Exception:
                lead = 0
            doc = {
                "code": code,
                "name": name,
                "contact_person": (r.get("contact_person") or "").strip(),
                "phone": (r.get("phone") or "").strip(),
                "email": (r.get("email") or "").strip(),
                "address": (r.get("address") or "").strip(),
                "lead_time_days": lead,
                "payment_terms": (r.get("payment_terms") or "").strip(),
                "notes": (r.get("notes") or "").strip(),
                "updated_at": iso(now_utc()),
            }
            existing = await db.suppliers.find_one({"code": code}) if r.get("code") else None
            if existing:
                await db.suppliers.update_one({"_id": existing["_id"]}, {"$set": doc})
                updated += 1
            else:
                doc["created_at"] = iso(now_utc())
                await db.suppliers.insert_one(doc)
                created += 1
        except Exception as e:
            errors.append(f"Baris {i}: {str(e)}")
    return {"created": created, "updated": updated, "errors": errors, "total": len(rows)}


# ==============================================================================
# Reset transactions (Admin only) — for demo/cleanup
# ==============================================================================
@api.post("/admin/reset-transactions")
async def reset_transactions(user: dict = Depends(require_roles("admin"))):
    """Hapus semua transaksi (PO, GRN, Issue, Opname, Revenue, Recipe) dan
    reset stok/HPP item ke nilai seed. Master data (users, outlets, suppliers, items metadata) tetap."""
    pos = await db.purchase_orders.delete_many({})
    grns = await db.receivings.delete_many({})
    iss = await db.issues.delete_many({})
    opn = await db.opnames.delete_many({})
    rev = await db.revenues.delete_many({})
    rec = await db.recipes.delete_many({})
    # Reset items — drop dan seed ulang (memakai fungsi seed yang skip jika ada)
    await db.items.delete_many({})
    await seed_data()
    return {
        "deleted": {
            "purchase_orders": pos.deleted_count,
            "receivings": grns.deleted_count,
            "issues": iss.deleted_count,
            "opnames": opn.deleted_count,
            "revenues": rev.deleted_count,
            "recipes": rec.deleted_count,
        },
        "items_reseeded": True,
    }


# ==============================================================================
# Items (Master Barang)
# ==============================================================================
async def next_sku() -> str:
    count = await db.items.count_documents({})
    return f"INV-{count + 1:04d}"


@api.get("/items")
async def list_items(
    outlet: Optional[str] = None,
    search: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    if outlet and outlet != "all":
        query["outlet_code"] = outlet
    if search:
        # Match either item name OR SKU (case-insensitive)
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"sku": {"$regex": search, "$options": "i"}},
        ]
    items = await db.items.find(query).sort("name", 1).to_list(1000)
    return [serialize_doc(i) for i in items]


@api.post("/items")
async def create_item(
    payload: ItemIn, user: dict = Depends(require_roles("admin", "purchasing", "warehouse"))
):
    if not payload.sku or not payload.sku.strip():
        raise HTTPException(status_code=400, detail="Kode SKU wajib diisi")
    sku = payload.sku.strip()
    if await db.items.find_one({"sku": sku}):
        raise HTTPException(status_code=400, detail=f"SKU '{sku}' sudah digunakan")
    doc = payload.model_dump()
    doc["sku"] = sku
    doc["created_at"] = iso(now_utc())
    doc["updated_at"] = iso(now_utc())
    res = await db.items.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


@api.patch("/items/{item_id}")
async def update_item(
    item_id: str,
    payload: ItemUpdateIn,
    user: dict = Depends(require_roles("admin", "purchasing", "warehouse")),
):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    updates["updated_at"] = iso(now_utc())
    result = await db.items.update_one({"_id": to_oid(item_id)}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Item tidak ditemukan")
    doc = await db.items.find_one({"_id": to_oid(item_id)})
    return serialize_doc(doc)


@api.delete("/items/{item_id}")
async def delete_item(item_id: str, user: dict = Depends(require_roles("admin"))):
    result = await db.items.delete_one({"_id": to_oid(item_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item tidak ditemukan")
    return {"deleted": True}


# ==============================================================================
# Purchase Orders
# ==============================================================================
async def next_po_number() -> str:
    count = await db.purchase_orders.count_documents({})
    return f"PO-{count + 1:04d}"


@api.get("/orders")
async def list_orders(user: dict = Depends(get_current_user)):
    orders = await db.purchase_orders.find({}).sort("created_at", -1).to_list(500)
    return [serialize_doc(o) for o in orders]


@api.post("/orders")
async def create_order(
    payload: POCreateIn, user: dict = Depends(require_roles("purchasing", "admin"))
):
    total = sum(line.qty * line.price for line in payload.items)
    doc = {
        "po_number": await next_po_number(),
        "supplier": payload.supplier,
        "outlet_code": payload.outlet_code,
        "items": [
            {**line.model_dump(), "received_qty": 0} for line in payload.items
        ],
        "total": total,
        "status": "waiting_approval",
        "notes": payload.notes,
        "created_by": user["email"],
        "created_at": iso(now_utc()),
        "approved_by": None,
        "approved_at": None,
    }
    res = await db.purchase_orders.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


@api.post("/orders/{order_id}/approve")
async def approve_order(order_id: str, user: dict = Depends(require_roles("finance", "admin"))):
    order = await db.purchase_orders.find_one({"_id": to_oid(order_id)})
    if not order:
        raise HTTPException(status_code=404, detail="PO tidak ditemukan")
    if order["status"] != "waiting_approval":
        raise HTTPException(status_code=400, detail="PO tidak dalam status menunggu approval")
    await db.purchase_orders.update_one(
        {"_id": to_oid(order_id)},
        {"$set": {"status": "approved", "approved_by": user["email"], "approved_at": iso(now_utc())}},
    )
    doc = await db.purchase_orders.find_one({"_id": to_oid(order_id)})
    return serialize_doc(doc)


@api.post("/orders/{order_id}/cancel")
async def cancel_order(
    order_id: str, user: dict = Depends(require_roles("purchasing", "admin", "finance"))
):
    await db.purchase_orders.update_one(
        {"_id": to_oid(order_id)}, {"$set": {"status": "cancelled"}}
    )
    doc = await db.purchase_orders.find_one({"_id": to_oid(order_id)})
    return serialize_doc(doc)


# ==============================================================================
# Receiving (GRN) — updates stock + weighted-average HPP
# ==============================================================================
async def next_grn_number() -> str:
    count = await db.receivings.count_documents({})
    return f"GRN-{count + 1:04d}"


async def apply_weighted_average(item_id: str, qty: float, price: float):
    """Update item stock and weighted-average cost after receiving."""
    item = await db.items.find_one({"_id": to_oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail=f"Item {item_id} tidak ditemukan")
    current_stock = float(item.get("stock", 0))
    current_cost = float(item.get("cost", 0))
    if current_stock + qty <= 0:
        new_cost = price
    else:
        new_cost = (current_stock * current_cost + qty * price) / (current_stock + qty)
    new_stock = current_stock + qty
    await db.items.update_one(
        {"_id": to_oid(item_id)},
        {"$set": {"stock": new_stock, "cost": new_cost, "updated_at": iso(now_utc())}},
    )
    return new_stock, new_cost


@api.get("/receivings")
async def list_receivings(user: dict = Depends(get_current_user)):
    docs = await db.receivings.find({}).sort("received_at", -1).to_list(500)
    return [serialize_doc(d) for d in docs]


@api.post("/receivings")
async def create_receiving(
    payload: ReceivingCreateIn, user: dict = Depends(require_roles("warehouse", "admin"))
):
    # Penerimaan WAJIB terkait dengan Purchase Order yang sudah disetujui
    if not payload.po_id:
        raise HTTPException(
            status_code=400,
            detail="Penerimaan barang wajib merujuk Purchase Order. Buat & setujui PO terlebih dahulu.",
        )
    po = await db.purchase_orders.find_one({"_id": to_oid(payload.po_id)})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase Order tidak ditemukan")
    # Support partial receive: allow status "approved" and "partial"
    if po["status"] not in ("approved", "partial"):
        raise HTTPException(
            status_code=400,
            detail=f"PO {po['po_number']} tidak dapat diterima (status: {po['status']})",
        )
    # Build a map of PO lines by item_id
    po_lines_by_item = {str(it["item_id"]): it for it in po["items"]}
    # Validate every incoming line + qty ≤ remaining
    for line in payload.items:
        po_line = po_lines_by_item.get(line.item_id)
        if not po_line:
            raise HTTPException(
                status_code=400,
                detail=f"Item {line.name} tidak terdapat pada PO {po['po_number']}",
            )
        remaining = float(po_line["qty"]) - float(po_line.get("received_qty", 0))
        if line.qty <= 0:
            raise HTTPException(status_code=400, detail=f"Qty {line.name} harus > 0")
        if line.qty > remaining + 1e-9:
            raise HTTPException(
                status_code=400,
                detail=f"Qty {line.name} melebihi sisa PO ({remaining} {po_line.get('unit','')} tersedia)",
            )

    total = 0.0
    lines_out = []
    # Apply weighted average + update received_qty on PO line
    for line in payload.items:
        new_stock, new_cost = await apply_weighted_average(line.item_id, line.qty, line.price)
        po_line = po_lines_by_item[line.item_id]
        po_line["received_qty"] = float(po_line.get("received_qty", 0)) + float(line.qty)
        total += line.qty * line.price
        lines_out.append(
            {**line.model_dump(), "new_stock": new_stock, "new_avg_cost": new_cost}
        )

    # Determine new PO status: fully-received vs partial
    fully_received = all(
        float(l.get("received_qty", 0)) >= float(l["qty"]) - 1e-9 for l in po["items"]
    )
    new_status = "received" if fully_received else "partial"
    await db.purchase_orders.update_one(
        {"_id": po["_id"]},
        {
            "$set": {
                "items": po["items"],
                "status": new_status,
                "received_at": iso(now_utc()) if fully_received else po.get("received_at"),
                "updated_at": iso(now_utc()),
            }
        },
    )

    doc = {
        "grn_number": await next_grn_number(),
        "po_id": payload.po_id,
        "po_number": po["po_number"],
        "supplier": payload.supplier or po.get("supplier", ""),
        "outlet_code": payload.outlet_code,
        "items": lines_out,
        "total": total,
        "notes": payload.notes,
        "received_by": user["email"],
        "received_at": iso(now_utc()),
    }
    res = await db.receivings.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


# ==============================================================================
# Issue (Barang Keluar) — deducts stock, records cost at time of issue
# ==============================================================================
async def next_issue_number() -> str:
    count = await db.issues.count_documents({})
    return f"ISS-{count + 1:04d}"


@api.get("/issues")
async def list_issues(user: dict = Depends(get_current_user)):
    docs = await db.issues.find({}).sort("issued_at", -1).to_list(500)
    return [serialize_doc(d) for d in docs]


@api.post("/issues")
async def create_issue(
    payload: IssueCreateIn, user: dict = Depends(require_roles("warehouse", "admin"))
):
    lines = []
    total_cost = 0.0
    for line in payload.items:
        item = await db.items.find_one({"_id": to_oid(line.item_id)})
        if not item:
            raise HTTPException(status_code=404, detail=f"Item {line.name} tidak ditemukan")
        if float(item.get("stock", 0)) < line.qty:
            raise HTTPException(
                status_code=400,
                detail=f"Stok {line.name} tidak mencukupi (tersedia {item.get('stock', 0)})",
            )
        cost_at_issue = float(item.get("cost", 0))
        new_stock = float(item.get("stock", 0)) - line.qty
        await db.items.update_one(
            {"_id": to_oid(line.item_id)},
            {"$set": {"stock": new_stock, "updated_at": iso(now_utc())}},
        )
        line_total = line.qty * cost_at_issue
        total_cost += line_total
        lines.append(
            {**line.model_dump(), "cost_at_issue": cost_at_issue, "line_total": line_total}
        )
    today = now_utc().strftime("%Y-%m-%d")
    doc = {
        "issue_number": await next_issue_number(),
        "from_outlet": payload.from_outlet,
        "to_outlet": payload.to_outlet,
        "items": lines,
        "total_cost": total_cost,
        "notes": payload.notes,
        "issued_by": user["email"],
        "issued_at": iso(now_utc()),
        "issue_date": today,
    }
    res = await db.issues.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


# ==============================================================================
# Stock Opname — compare fisik vs sistem
# ==============================================================================
async def next_opname_number() -> str:
    count = await db.opnames.count_documents({})
    return f"OPN-{count + 1:04d}"


@api.get("/opnames")
async def list_opnames(user: dict = Depends(get_current_user)):
    docs = await db.opnames.find({}).sort("created_at", -1).to_list(500)
    return [serialize_doc(d) for d in docs]


@api.post("/opnames")
async def create_opname(
    payload: OpnameCreateIn, user: dict = Depends(require_roles("warehouse", "admin"))
):
    lines = []
    total_variance_value = 0.0
    for line in payload.items:
        item = await db.items.find_one({"_id": to_oid(line.item_id)})
        if not item:
            raise HTTPException(status_code=404, detail=f"Item {line.name} tidak ditemukan")
        sys_qty = float(item.get("stock", 0))
        variance = line.physical_qty - sys_qty
        variance_value = variance * float(item.get("cost", 0))
        total_variance_value += variance_value
        lines.append(
            {
                "item_id": line.item_id,
                "name": line.name,
                "unit": item.get("unit"),
                "system_qty": sys_qty,
                "physical_qty": line.physical_qty,
                "variance": variance,
                "cost": float(item.get("cost", 0)),
                "variance_value": variance_value,
            }
        )
    doc = {
        "opname_number": await next_opname_number(),
        "outlet_code": payload.outlet_code,
        "items": lines,
        "total_variance_value": total_variance_value,
        "status": "draft",
        "counted_by": user["email"],
        "approved_by": None,
        "notes": payload.notes,
        "created_at": iso(now_utc()),
    }
    res = await db.opnames.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


@api.post("/opnames/{opname_id}/approve")
async def approve_opname(
    opname_id: str, user: dict = Depends(require_roles("finance", "admin"))
):
    op = await db.opnames.find_one({"_id": to_oid(opname_id)})
    if not op:
        raise HTTPException(status_code=404, detail="Opname tidak ditemukan")
    if op["status"] == "approved":
        raise HTTPException(status_code=400, detail="Opname sudah disetujui")
    # Adjust stock in items to physical quantities
    for line in op["items"]:
        await db.items.update_one(
            {"_id": ObjectId(line["item_id"])},
            {"$set": {"stock": line["physical_qty"], "updated_at": iso(now_utc())}},
        )
    await db.opnames.update_one(
        {"_id": to_oid(opname_id)},
        {
            "$set": {
                "status": "approved",
                "approved_by": user["email"],
                "approved_at": iso(now_utc()),
            }
        },
    )
    doc = await db.opnames.find_one({"_id": to_oid(opname_id)})
    return serialize_doc(doc)


# ==============================================================================
# Revenue
# ==============================================================================
@api.get("/revenues")
async def list_revenues(
    date: Optional[str] = None,
    outlet: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    if date:
        query["date"] = date
    if outlet:
        query["outlet_code"] = outlet
    docs = await db.revenues.find(query).sort("date", -1).to_list(500)
    return [serialize_doc(d) for d in docs]


@api.post("/revenues")
async def upsert_revenue(
    payload: RevenueIn, user: dict = Depends(require_roles("finance", "admin"))
):
    query = {"date": payload.date, "outlet_code": payload.outlet_code}
    await db.revenues.update_one(
        query,
        {
            "$set": {
                **payload.model_dump(),
                "created_by": user["email"],
                "updated_at": iso(now_utc()),
            }
        },
        upsert=True,
    )
    doc = await db.revenues.find_one(query)
    return serialize_doc(doc)


# ==============================================================================
# Flash Cost — daily cost vs revenue per outlet
# ==============================================================================
@api.get("/flash-cost")
async def flash_cost(
    date: Optional[str] = None, user: dict = Depends(get_current_user)
):
    target_date = date or now_utc().strftime("%Y-%m-%d")
    # Aggregate issues by to_outlet on target_date
    pipeline = [
        {"$match": {"issue_date": target_date}},
        {"$group": {"_id": "$to_outlet", "total_cost": {"$sum": "$total_cost"}}},
    ]
    cost_agg = await db.issues.aggregate(pipeline).to_list(50)
    cost_by_outlet = {row["_id"]: row["total_cost"] for row in cost_agg}

    revenues = await db.revenues.find({"date": target_date}).to_list(50)
    revenue_by_outlet = {r["outlet_code"]: float(r["amount"]) for r in revenues}

    outlets = await db.outlets.find({}).to_list(50)
    result = []
    for o in outlets:
        code = o["code"]
        cost = float(cost_by_outlet.get(code, 0))
        rev = float(revenue_by_outlet.get(code, 0))
        pct = (cost / rev * 100) if rev > 0 else 0
        result.append(
            {
                "outlet_code": code,
                "outlet_name": o["name"],
                "outlet_type": o["type"],
                "cost": cost,
                "revenue": rev,
                "cost_percentage": round(pct, 2),
            }
        )
    total_cost = sum(r["cost"] for r in result)
    total_rev = sum(r["revenue"] for r in result)
    total_pct = round((total_cost / total_rev * 100), 2) if total_rev > 0 else 0
    return {
        "date": target_date,
        "outlets": result,
        "total_cost": total_cost,
        "total_revenue": total_rev,
        "total_percentage": total_pct,
    }


# ==============================================================================
# Dashboard summary
# ==============================================================================
@api.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    items = await db.items.find({}).to_list(2000)
    valuation = sum(float(i.get("stock", 0)) * float(i.get("cost", 0)) for i in items)
    low_stock_docs = [i for i in items if float(i.get("stock", 0)) <= float(i.get("min_stock", 0))]
    pending_po = await db.purchase_orders.count_documents({"status": "waiting_approval"})

    today = now_utc().strftime("%Y-%m-%d")
    flash = await flash_cost(today, user)

    # Recent activity: last 5 issues + last 5 receivings + last 5 opnames
    recent_issues = await db.issues.find({}).sort("issued_at", -1).to_list(3)
    recent_recv = await db.receivings.find({}).sort("received_at", -1).to_list(3)
    recent_op = await db.opnames.find({}).sort("created_at", -1).to_list(3)
    activities: List[dict] = []
    for r in recent_recv:
        activities.append(
            {
                "type": "receiving",
                "label": f"Penerimaan {r['grn_number']} selesai",
                "detail": f"{r['supplier']} · {sum(l['qty'] for l in r['items'])} item",
                "at": r["received_at"],
            }
        )
    for r in recent_issues:
        activities.append(
            {
                "type": "issue",
                "label": f"Barang keluar ke {r['to_outlet']}",
                "detail": f"{r['issue_number']} · {sum(l['qty'] for l in r['items'])} item",
                "at": r["issued_at"],
            }
        )
    for r in recent_op:
        activities.append(
            {
                "type": "opname",
                "label": f"Opname {r['opname_number']} {r['status']}",
                "detail": f"Outlet {r['outlet_code']}",
                "at": r["created_at"],
            }
        )
    activities.sort(key=lambda x: x["at"], reverse=True)

    return {
        "valuation": valuation,
        "low_stock_count": len(low_stock_docs),
        "low_stock_items": [serialize_doc(i) for i in low_stock_docs[:8]],
        "pending_po": pending_po,
        "flash_cost_pct": flash["total_percentage"],
        "activities": activities[:6],
    }


# ==============================================================================
# HPP — recipes / cost per menu
# ==============================================================================
class RecipeLineIn(BaseModel):
    item_id: str
    name: str
    qty: float
    unit: str


class RecipeIn(BaseModel):
    name: str
    outlet_code: str = "kitchen"
    selling_price: float = 0
    ingredients: List[RecipeLineIn]


@api.get("/recipes")
async def list_recipes(user: dict = Depends(get_current_user)):
    docs = await db.recipes.find({}).sort("name", 1).to_list(500)
    result = []
    for r in docs:
        total_cost = 0.0
        for ing in r.get("ingredients", []):
            item = await db.items.find_one({"_id": ObjectId(ing["item_id"])})
            if item:
                total_cost += float(ing["qty"]) * float(item.get("cost", 0))
        d = serialize_doc(r)
        d["hpp"] = total_cost
        sp = float(r.get("selling_price", 0))
        d["margin_pct"] = round(((sp - total_cost) / sp * 100), 2) if sp > 0 else 0
        result.append(d)
    return result


@api.post("/recipes")
async def create_recipe(
    payload: RecipeIn, user: dict = Depends(require_roles("admin", "finance"))
):
    doc = {
        **payload.model_dump(),
        "created_by": user["email"],
        "created_at": iso(now_utc()),
    }
    res = await db.recipes.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


# ==============================================================================
# CSV Bulk Upload
# ==============================================================================
def _parse_csv(file_bytes: bytes) -> List[dict]:
    """Parse CSV bytes into list of dicts. Auto-detect delimiter (, or ;)."""
    text = file_bytes.decode("utf-8-sig", errors="replace")
    sample = text[:1024]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows = []
    for r in reader:
        rows.append({(k or "").strip(): (v or "").strip() for k, v in r.items() if k})
    return rows


def _num(val, default=0.0) -> float:
    if val is None or val == "":
        return default
    try:
        return float(str(val).replace(",", "").replace(" ", ""))
    except ValueError:
        return default


@api.post("/items/bulk-upload")
async def items_bulk_upload(
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("admin", "purchasing", "warehouse")),
):
    """CSV header: name,category,unit,cost,min_stock,stock,supplier,outlet_code[,sku]"""
    content = await file.read()
    rows = _parse_csv(content)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV kosong atau format tidak dikenali")
    created, updated, errors = 0, 0, []
    for i, r in enumerate(rows, start=2):
        try:
            name = r.get("name", "").strip()
            if not name:
                errors.append(f"Baris {i}: nama barang kosong")
                continue
            sku = r.get("sku", "").strip()
            if not sku:
                errors.append(f"Baris {i}: kolom sku wajib diisi")
                continue
            doc = {
                "sku": sku,
                "name": name,
                "category": r.get("category", "Uncategorized") or "Uncategorized",
                "unit": r.get("unit", "pcs") or "pcs",
                "cost": _num(r.get("cost")),
                "min_stock": _num(r.get("min_stock")),
                "stock": _num(r.get("stock")),
                "supplier": r.get("supplier", ""),
                "outlet_code": r.get("outlet_code", "main_wh") or "main_wh",
                "updated_at": iso(now_utc()),
            }
            existing = await db.items.find_one({"sku": sku})
            if existing:
                await db.items.update_one({"_id": existing["_id"]}, {"$set": doc})
                updated += 1
            else:
                doc["created_at"] = iso(now_utc())
                await db.items.insert_one(doc)
                created += 1
        except Exception as e:
            errors.append(f"Baris {i}: {str(e)}")
    return {"created": created, "updated": updated, "errors": errors, "total": len(rows)}


@api.post("/orders/bulk-upload")
async def orders_bulk_upload(
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("purchasing", "admin")),
):
    """CSV header: po_ref,supplier,outlet_code,item_sku,qty,price[,notes]
    Rows are grouped by po_ref → one PO per unique po_ref."""
    content = await file.read()
    rows = _parse_csv(content)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV kosong atau format tidak dikenali")
    groups: Dict[str, List[dict]] = {}
    for i, r in enumerate(rows, start=2):
        ref = r.get("po_ref", "") or f"batch-{i}"
        groups.setdefault(ref, []).append({"row": i, **r})
    created, errors = 0, []
    for ref, group in groups.items():
        try:
            supplier = group[0].get("supplier", "").strip()
            outlet_code = group[0].get("outlet_code", "main_wh") or "main_wh"
            notes = group[0].get("notes", "")
            if not supplier:
                errors.append(f"Grup {ref}: supplier kosong")
                continue
            items_out = []
            for row in group:
                sku = row.get("item_sku", "").strip()
                item = await db.items.find_one({"sku": sku})
                if not item:
                    errors.append(f"Baris {row['row']}: SKU '{sku}' tidak ditemukan")
                    continue
                qty = _num(row.get("qty"))
                price = _num(row.get("price"), default=float(item.get("cost", 0)))
                items_out.append(
                    {
                        "item_id": str(item["_id"]),
                        "name": item["name"],
                        "qty": qty,
                        "unit": item.get("unit", "pcs"),
                        "price": price,
                    }
                )
            if not items_out:
                continue
            total = sum(l["qty"] * l["price"] for l in items_out)
            doc = {
                "po_number": await next_po_number(),
                "supplier": supplier,
                "outlet_code": outlet_code,
                "items": items_out,
                "total": total,
                "status": "waiting_approval",
                "notes": notes,
                "created_by": user["email"],
                "created_at": iso(now_utc()),
                "approved_by": None,
                "approved_at": None,
            }
            await db.purchase_orders.insert_one(doc)
            created += 1
        except Exception as e:
            errors.append(f"Grup {ref}: {str(e)}")
    return {"created": created, "errors": errors, "total_rows": len(rows)}


@api.post("/receivings/bulk-upload")
async def receivings_bulk_upload(
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("warehouse", "admin")),
):
    """CSV header: po_number,item_sku,qty,price[,notes]
    Rows grouped by po_number → one GRN per approved PO. Applies weighted-average HPP."""
    content = await file.read()
    rows = _parse_csv(content)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV kosong atau format tidak dikenali")
    groups: Dict[str, List[dict]] = {}
    for i, r in enumerate(rows, start=2):
        ref = (r.get("po_number") or "").strip()
        if not ref:
            continue
        groups.setdefault(ref, []).append({"row": i, **r})
    created, errors = 0, []
    for po_number, group in groups.items():
        try:
            po = await db.purchase_orders.find_one({"po_number": po_number})
            if not po:
                errors.append(f"PO {po_number}: tidak ditemukan")
                continue
            if po["status"] not in ("approved", "partial"):
                errors.append(f"PO {po_number}: tidak dapat diterima (status {po['status']})")
                continue
            po_lines_by_id = {str(it["item_id"]): it for it in po["items"]}
            po_skus = {}
            for it in po["items"]:
                item_doc = await db.items.find_one({"_id": to_oid(str(it["item_id"]))})
                if item_doc:
                    po_skus[item_doc["sku"]] = str(item_doc["_id"])
            notes = group[0].get("notes", "")
            lines, total = [], 0.0
            for row in group:
                sku = row.get("item_sku", "").strip()
                if sku not in po_skus:
                    errors.append(
                        f"Baris {row['row']}: SKU '{sku}' tidak ada dalam PO {po_number}"
                    )
                    continue
                item_id = po_skus[sku]
                item = await db.items.find_one({"_id": to_oid(item_id)})
                qty = _num(row.get("qty"))
                price = _num(row.get("price"), default=float(item.get("cost", 0)))
                po_line = po_lines_by_id.get(item_id)
                remaining = float(po_line["qty"]) - float(po_line.get("received_qty", 0))
                if qty <= 0:
                    errors.append(f"Baris {row['row']}: qty harus > 0")
                    continue
                if qty > remaining + 1e-9:
                    errors.append(
                        f"Baris {row['row']}: qty {qty} melebihi sisa PO {po_number} ({remaining} tersisa)"
                    )
                    continue
                new_stock, new_cost = await apply_weighted_average(item_id, qty, price)
                po_line["received_qty"] = float(po_line.get("received_qty", 0)) + qty
                total += qty * price
                lines.append(
                    {
                        "item_id": item_id,
                        "name": item["name"],
                        "qty": qty,
                        "unit": item.get("unit", "pcs"),
                        "price": price,
                        "new_stock": new_stock,
                        "new_avg_cost": new_cost,
                    }
                )
            if not lines:
                continue
            fully_received = all(
                float(l.get("received_qty", 0)) >= float(l["qty"]) - 1e-9 for l in po["items"]
            )
            new_status = "received" if fully_received else "partial"
            doc = {
                "grn_number": await next_grn_number(),
                "po_id": str(po["_id"]),
                "po_number": po["po_number"],
                "supplier": po.get("supplier", ""),
                "outlet_code": po.get("outlet_code", "main_wh"),
                "items": lines,
                "total": total,
                "notes": notes,
                "received_by": user["email"],
                "received_at": iso(now_utc()),
            }
            await db.receivings.insert_one(doc)
            await db.purchase_orders.update_one(
                {"_id": po["_id"]},
                {
                    "$set": {
                        "items": po["items"],
                        "status": new_status,
                        "received_at": iso(now_utc()) if fully_received else po.get("received_at"),
                        "updated_at": iso(now_utc()),
                    }
                },
            )
            created += 1
        except HTTPException as e:
            errors.append(f"PO {po_number}: {e.detail}")
        except Exception as e:
            errors.append(f"PO {po_number}: {str(e)}")
    return {"created": created, "errors": errors, "total_rows": len(rows)}


@api.post("/issues/bulk-upload")
async def issues_bulk_upload(
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("warehouse", "admin")),
):
    """CSV header: issue_ref,from_outlet,to_outlet,item_sku,qty[,notes]
    Rows grouped by issue_ref → one Issue per group. Deducts stock."""
    content = await file.read()
    rows = _parse_csv(content)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV kosong atau format tidak dikenali")
    groups: Dict[str, List[dict]] = {}
    for i, r in enumerate(rows, start=2):
        ref = r.get("issue_ref", "") or f"batch-{i}"
        groups.setdefault(ref, []).append({"row": i, **r})
    created, errors = 0, []
    for ref, group in groups.items():
        try:
            from_outlet = group[0].get("from_outlet", "main_wh") or "main_wh"
            to_outlet = group[0].get("to_outlet", "").strip()
            notes = group[0].get("notes", "")
            if not to_outlet:
                errors.append(f"Grup {ref}: to_outlet kosong")
                continue
            lines, total_cost = [], 0.0
            for row in group:
                sku = row.get("item_sku", "").strip()
                item = await db.items.find_one({"sku": sku})
                if not item:
                    errors.append(f"Baris {row['row']}: SKU '{sku}' tidak ditemukan")
                    continue
                qty = _num(row.get("qty"))
                if float(item.get("stock", 0)) < qty:
                    errors.append(
                        f"Baris {row['row']}: stok {item['name']} tidak cukup ({item.get('stock', 0)} < {qty})"
                    )
                    continue
                cost_at_issue = float(item.get("cost", 0))
                new_stock = float(item.get("stock", 0)) - qty
                await db.items.update_one(
                    {"_id": item["_id"]},
                    {"$set": {"stock": new_stock, "updated_at": iso(now_utc())}},
                )
                line_total = qty * cost_at_issue
                total_cost += line_total
                lines.append(
                    {
                        "item_id": str(item["_id"]),
                        "name": item["name"],
                        "qty": qty,
                        "unit": item.get("unit", "pcs"),
                        "cost_at_issue": cost_at_issue,
                        "line_total": line_total,
                    }
                )
            if not lines:
                continue
            doc = {
                "issue_number": await next_issue_number(),
                "from_outlet": from_outlet,
                "to_outlet": to_outlet,
                "items": lines,
                "total_cost": total_cost,
                "notes": notes,
                "issued_by": user["email"],
                "issued_at": iso(now_utc()),
                "issue_date": now_utc().strftime("%Y-%m-%d"),
            }
            await db.issues.insert_one(doc)
            created += 1
        except Exception as e:
            errors.append(f"Grup {ref}: {str(e)}")
    return {"created": created, "errors": errors, "total_rows": len(rows)}


# ==============================================================================
# Analytics
# ==============================================================================
@api.get("/analytics")
async def analytics(days: int = 7, user: dict = Depends(get_current_user)):
    """Dashboard analytics: top consumed items, daily flash cost trend,
    category distribution, outlet valuation."""
    days = max(1, min(days, 60))
    today_dt = now_utc().date()
    date_list = [(today_dt - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]

    # 1. Top consumed items (by cost value over the window)
    since = (now_utc() - timedelta(days=days)).strftime("%Y-%m-%d")
    top_pipeline = [
        {"$match": {"issue_date": {"$gte": since}}},
        {"$unwind": "$items"},
        {
            "$group": {
                "_id": {"item_id": "$items.item_id", "name": "$items.name"},
                "qty": {"$sum": "$items.qty"},
                "value": {"$sum": "$items.line_total"},
            }
        },
        {"$sort": {"value": -1}},
        {"$limit": 6},
    ]
    top_docs = await db.issues.aggregate(top_pipeline).to_list(10)
    top_consumed = [
        {
            "item_id": row["_id"]["item_id"],
            "name": row["_id"]["name"],
            "qty": row["qty"],
            "value": row["value"],
        }
        for row in top_docs
    ]

    # 2. Daily flash-cost trend
    outlets = await db.outlets.find({}).to_list(50)
    trend = []
    for d in date_list:
        issues = await db.issues.aggregate(
            [
                {"$match": {"issue_date": d}},
                {"$group": {"_id": None, "cost": {"$sum": "$total_cost"}}},
            ]
        ).to_list(1)
        revs = await db.revenues.aggregate(
            [
                {"$match": {"date": d}},
                {"$group": {"_id": None, "rev": {"$sum": "$amount"}}},
            ]
        ).to_list(1)
        cost = issues[0]["cost"] if issues else 0
        rev = revs[0]["rev"] if revs else 0
        pct = round((cost / rev * 100), 2) if rev > 0 else 0
        trend.append({"date": d, "cost": cost, "revenue": rev, "percentage": pct})

    # 3. Category distribution (stock valuation)
    cat_pipeline = [
        {
            "$group": {
                "_id": "$category",
                "value": {
                    "$sum": {"$multiply": [{"$ifNull": ["$stock", 0]}, {"$ifNull": ["$cost", 0]}]}
                },
                "items": {"$sum": 1},
            }
        },
        {"$sort": {"value": -1}},
    ]
    cat_docs = await db.items.aggregate(cat_pipeline).to_list(20)
    categories = [
        {"category": row["_id"] or "Uncategorized", "value": row["value"], "items": row["items"]}
        for row in cat_docs
    ]

    # 4. Outlet valuation
    outlet_pipeline = [
        {
            "$group": {
                "_id": "$outlet_code",
                "value": {
                    "$sum": {"$multiply": [{"$ifNull": ["$stock", 0]}, {"$ifNull": ["$cost", 0]}]}
                },
                "items": {"$sum": 1},
            }
        },
        {"$sort": {"value": -1}},
    ]
    outlet_docs = await db.items.aggregate(outlet_pipeline).to_list(20)
    outlet_map = {o["code"]: o["name"] for o in outlets}
    outlet_valuation = [
        {
            "outlet_code": row["_id"] or "unknown",
            "outlet_name": outlet_map.get(row["_id"], row["_id"] or "-"),
            "value": row["value"],
            "items": row["items"],
        }
        for row in outlet_docs
    ]

    # 5. Purchase totals (window)
    since_iso = iso(now_utc() - timedelta(days=days))
    po_agg = await db.purchase_orders.aggregate(
        [
            {"$match": {"created_at": {"$gte": since_iso}}},
            {"$group": {"_id": None, "count": {"$sum": 1}, "total": {"$sum": "$total"}}},
        ]
    ).to_list(1)
    grn_agg = await db.receivings.aggregate(
        [
            {"$match": {"received_at": {"$gte": since_iso}}},
            {"$group": {"_id": None, "count": {"$sum": 1}, "total": {"$sum": "$total"}}},
        ]
    ).to_list(1)
    procurement = {
        "po_count": po_agg[0]["count"] if po_agg else 0,
        "po_total": po_agg[0]["total"] if po_agg else 0,
        "grn_count": grn_agg[0]["count"] if grn_agg else 0,
        "grn_total": grn_agg[0]["total"] if grn_agg else 0,
    }

    return {
        "window_days": days,
        "top_consumed": top_consumed,
        "trend": trend,
        "categories": categories,
        "outlet_valuation": outlet_valuation,
        "procurement": procurement,
    }


# ==============================================================================
# Seeding
# ==============================================================================
async def seed_data():
    # Users
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@lagobali.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    demo_users = [
        {"email": admin_email, "password": admin_password, "name": "Admin Lago Bali", "role": "admin"},
        {"email": "purchasing@lagobali.com", "password": "demo123", "name": "Rina (Purchasing)", "role": "purchasing"},
        {"email": "warehouse@lagobali.com", "password": "demo123", "name": "Budi (Gudang)", "role": "warehouse"},
        {"email": "finance@lagobali.com", "password": "demo123", "name": "Sari (Finance)", "role": "finance"},
    ]
    for u in demo_users:
        existing = await db.users.find_one({"email": u["email"]})
        if existing is None:
            await db.users.insert_one(
                {
                    "email": u["email"],
                    "password_hash": hash_password(u["password"]),
                    "name": u["name"],
                    "role": u["role"],
                    "created_at": iso(now_utc()),
                }
            )
        elif not verify_password(u["password"], existing["password_hash"]):
            await db.users.update_one(
                {"email": u["email"]},
                {"$set": {"password_hash": hash_password(u["password"])}},
            )

    # Outlets
    outlets = [
        {"name": "Gudang utama", "code": "main_wh", "type": "warehouse"},
        {"name": "Kitchen", "code": "kitchen", "type": "kitchen"},
        {"name": "Bar", "code": "bar", "type": "bar"},
        {"name": "Housekeeping", "code": "housekeeping", "type": "housekeeping"},
        {"name": "Dusk", "code": "dusk", "type": "restaurant"},
        {"name": "Dawn", "code": "dawn", "type": "restaurant"},
        {"name": "Pontoon", "code": "pontoon", "type": "bar"},
        {"name": "Beach House", "code": "beach_house", "type": "restaurant"},
        {"name": "Sundeck", "code": "sundeck", "type": "bar"},
        {"name": "Firm", "code": "firm", "type": "restaurant"},
        {"name": "Kitchen Dusk", "code": "kitchen_dusk", "type": "kitchen"},
        {"name": "Kitchen BOH", "code": "kitchen_boh", "type": "kitchen"},
        {"name": "Office", "code": "office", "type": "office"},
    ]
    for o in outlets:
        await db.outlets.update_one(
            {"code": o["code"]},
            {"$setOnInsert": {**o, "created_at": iso(now_utc())}},
            upsert=True,
        )

    # Suppliers — seeded only if collection empty; users can add their own catalog
    # (Sample suppliers removed per user request. Uncomment block below to reseed.)
    # seed_suppliers = []
    # for code, name, contact, phone, email, address, lead, terms in seed_suppliers:
    #     await db.suppliers.update_one(...)

    # Seed items — removed per user request. Users add items manually with custom SKU.
    # (Kode seeding barang di-disable. Uncomment blok di bawah untuk mengaktifkan kembali.)
    # if await db.items.count_documents({}) == 0: ...

    # Sample PO removed per user request — collection remains empty on fresh install.


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.outlets.create_index("code", unique=True)
    await db.suppliers.create_index("code", unique=True)
    await db.items.create_index("sku", unique=True)
    await db.purchase_orders.create_index("po_number", unique=True)
    await db.receivings.create_index("grn_number", unique=True)
    await db.issues.create_index("issue_number", unique=True)
    await db.opnames.create_index("opname_number", unique=True)
    await db.revenues.create_index([("date", 1), ("outlet_code", 1)], unique=True)


# ==============================================================================
# Startup / app assembly
# ==============================================================================
@app.on_event("startup")
async def startup():
    logger.info("Starting HINTO backend")
    await ensure_indexes()
    await seed_data()
    logger.info("Startup complete")


@app.on_event("shutdown")
async def shutdown():
    client.close()


@api.get("/health")
async def health():
    return {"status": "ok", "time": iso(now_utc())}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
