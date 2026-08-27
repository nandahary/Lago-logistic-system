from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import re
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
from pydantic import BaseModel, Field, field_validator

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


def create_access_token(user_id: str, username: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "exp": now_utc() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


# Username: 3–30 chars, letters/digits/dots/underscores; case-insensitive stored lowercase.
USERNAME_RE = re.compile(r"^[a-zA-Z0-9._]{3,30}$")


def normalize_username(raw: str) -> str:
    if not raw or not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="Username is required")
    u = raw.strip().lower()
    if not USERNAME_RE.match(u):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3–30 chars: letters, digits, dot, or underscore",
        )
    return u


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
        raise HTTPException(status_code=400, detail=f"Invalid ID: {value}")


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
    username: str
    password: str


class UserCreateIn(BaseModel):
    username: str
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
    notes: Optional[str] = ""


class ItemUpdateIn(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    cost: Optional[float] = None
    min_stock: Optional[float] = None
    stock: Optional[float] = None
    supplier: Optional[str] = None
    outlet_code: Optional[str] = None
    notes: Optional[str] = None


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
    payment_terms: Optional[str] = ""


class POCancelIn(BaseModel):
    reason: str


# ==============================================================================
# Purchase Request (PR) models
# ==============================================================================
class PRAttachmentIn(BaseModel):
    name: str
    data: str  # base64 data URL (data:image/png;base64,...) or plain base64
    size: Optional[int] = 0


class PRLineIn(BaseModel):
    item_id: Optional[str] = None
    sku: Optional[str] = ""
    name: str
    category: Optional[str] = ""
    qty: float
    unit: str
    notes: Optional[str] = ""


class PRCreateIn(BaseModel):
    department: str
    cost_center: Optional[str] = ""
    required_delivery_date: Optional[str] = None  # ISO date
    project: Optional[str] = ""
    priority: str = "medium"  # low | medium | high | urgent
    notes: Optional[str] = ""
    items: List[PRLineIn]
    attachments: List[PRAttachmentIn] = Field(default_factory=list)


class PRDecisionIn(BaseModel):
    comment: Optional[str] = ""


class PRConvertItemIn(BaseModel):
    line_index: int
    supplier: str
    price: float


class PRConvertIn(BaseModel):
    lines: List[PRConvertItemIn]


class PRConfigIn(BaseModel):
    approval_flow: List[str]  # list of roles in order


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
    username = normalize_username(payload.username)
    user = await db.users.find_one({"username": username})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_access_token(str(user["_id"]), user["username"], user["role"])
    return {"token": token, "user": serialize_doc(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api.post("/auth/register")
async def register(payload: UserCreateIn, user: dict = Depends(require_roles("admin"))):
    username = normalize_username(payload.username)
    if await db.users.find_one({"username": username}):
        raise HTTPException(status_code=400, detail="Username already registered")
    if payload.role not in {"admin", "purchasing", "warehouse", "finance"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    if not payload.password or len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    doc = {
        "username": username,
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
            raise HTTPException(status_code=400, detail="Invalid role")
        updates["role"] = payload.role
    if payload.password:
        updates["password_hash"] = hash_password(payload.password)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes")
    updates["updated_at"] = iso(now_utc())
    result = await db.users.update_one({"_id": to_oid(user_id)}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    doc = await db.users.find_one({"_id": to_oid(user_id)})
    return serialize_doc(doc)


@api.delete("/users/{user_id}")
async def delete_user(
    user_id: str, current_user: dict = Depends(require_roles("admin"))
):
    if str(current_user.get("id")) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = await db.users.find_one({"_id": to_oid(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Prevent deleting the last admin
    if target.get("role") == "admin":
        admin_count = await db.users.count_documents({"role": "admin"})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="At least 1 admin must remain")
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
        raise HTTPException(status_code=400, detail="Outlet code already exists")
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
        raise HTTPException(status_code=400, detail="Supplier code already exists")
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
        raise HTTPException(status_code=404, detail="Supplier not found")
    doc = await db.suppliers.find_one({"_id": to_oid(supplier_id)})
    return serialize_doc(doc)


@api.delete("/suppliers/{supplier_id}")
async def delete_supplier(
    supplier_id: str, user: dict = Depends(require_roles("admin"))
):
    result = await db.suppliers.delete_one({"_id": to_oid(supplier_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return {"deleted": True}


class SupplierBulkDeleteIn(BaseModel):
    ids: List[str]


@api.post("/suppliers/bulk-delete")
async def bulk_delete_suppliers(
    payload: SupplierBulkDeleteIn, user: dict = Depends(require_roles("admin"))
):
    if not payload.ids:
        raise HTTPException(status_code=400, detail="At least one supplier ID is required")
    oids = []
    invalid = []
    for sid in payload.ids:
        try:
            oids.append(to_oid(sid))
        except HTTPException:
            invalid.append(sid)
    if not oids:
        raise HTTPException(status_code=400, detail="No valid supplier IDs provided")
    result = await db.suppliers.delete_many({"_id": {"$in": oids}})
    return {
        "deleted": result.deleted_count,
        "requested": len(payload.ids),
        "invalid": invalid,
    }


@api.get("/suppliers/{supplier_id}")
async def get_supplier(supplier_id: str, user: dict = Depends(get_current_user)):
    doc = await db.suppliers.find_one({"_id": to_oid(supplier_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return serialize_doc(doc)


@api.get("/suppliers/{supplier_id}/orders")
async def supplier_orders(supplier_id: str, user: dict = Depends(get_current_user)):
    """Return purchase orders that reference this supplier (by name match)."""
    supplier = await db.suppliers.find_one({"_id": to_oid(supplier_id)})
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
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
        raise HTTPException(status_code=400, detail="CSV is empty or format not recognized")
    created, updated, errors = 0, 0, []
    for i, r in enumerate(rows, start=2):
        try:
            name = (r.get("name") or "").strip()
            if not name:
                errors.append(f"Line {i}: supplier name is empty")
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
            errors.append(f"Lines {i}: {str(e)}")
    return {"created": created, "updated": updated, "errors": errors, "total": len(rows)}


# ==============================================================================
# Reset transactions (Admin only) — for demo/cleanup
# ==============================================================================
@api.post("/admin/reset-transactions")
async def reset_transactions(user: dict = Depends(require_roles("admin"))):
    """Delete semua transaksi (PO, GRN, Issue, Opname, Revenue, Recipe) dan
    reset stok/COGS item ke nilai seed. Master data (users, outlets, suppliers, items metadata) tetap."""
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
# Items (Master Item)
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
        raise HTTPException(status_code=400, detail="SKU is required")
    sku = payload.sku.strip()
    if await db.items.find_one({"sku": sku}):
        raise HTTPException(status_code=400, detail=f"SKU '{sku}' is already in use")
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
        raise HTTPException(status_code=404, detail="Item not found")
    doc = await db.items.find_one({"_id": to_oid(item_id)})
    return serialize_doc(doc)


@api.delete("/items/{item_id}")
async def delete_item(item_id: str, user: dict = Depends(require_roles("admin"))):
    result = await db.items.delete_one({"_id": to_oid(item_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found")
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
        "payment_terms": payload.payment_terms or "",
        "created_by": user["username"],
        "created_at": iso(now_utc()),
        "approved_by": None,
        "approved_at": None,
    }
    res = await db.purchase_orders.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


@api.put("/orders/{order_id}")
async def update_order(
    order_id: str,
    payload: POCreateIn,
    user: dict = Depends(require_roles("purchasing", "admin")),
):
    order = await db.purchase_orders.find_one({"_id": to_oid(order_id)})
    if not order:
        raise HTTPException(status_code=404, detail="PO not found")
    if order["status"] != "waiting_approval":
        raise HTTPException(
            status_code=400,
            detail=f"PO cannot be edited (status: {order['status']}). Only PO in waiting approval can be edited.",
        )
    total = sum(line.qty * line.price for line in payload.items)
    await db.purchase_orders.update_one(
        {"_id": to_oid(order_id)},
        {
            "$set": {
                "supplier": payload.supplier,
                "outlet_code": payload.outlet_code,
                "items": [
                    {**line.model_dump(), "received_qty": 0}
                    for line in payload.items
                ],
                "total": total,
                "notes": payload.notes,
                "payment_terms": payload.payment_terms or "",
                "updated_by": user["username"],
                "updated_at": iso(now_utc()),
            }
        },
    )
    doc = await db.purchase_orders.find_one({"_id": to_oid(order_id)})
    return serialize_doc(doc)


@api.post("/orders/{order_id}/approve")
async def approve_order(order_id: str, user: dict = Depends(require_roles("finance", "admin"))):
    order = await db.purchase_orders.find_one({"_id": to_oid(order_id)})
    if not order:
        raise HTTPException(status_code=404, detail="PO not found")
    if order["status"] != "waiting_approval":
        raise HTTPException(status_code=400, detail="PO is not in waiting approval status")
    await db.purchase_orders.update_one(
        {"_id": to_oid(order_id)},
        {"$set": {"status": "approved", "approved_by": user["username"], "approved_at": iso(now_utc())}},
    )
    doc = await db.purchase_orders.find_one({"_id": to_oid(order_id)})
    return serialize_doc(doc)


@api.post("/orders/{order_id}/cancel")
async def cancel_order(
    order_id: str,
    payload: POCancelIn,
    user: dict = Depends(require_roles("admin")),
):
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Cancellation reason is required")
    order = await db.purchase_orders.find_one({"_id": to_oid(order_id)})
    if not order:
        raise HTTPException(status_code=404, detail="PO not found")
    if order["status"] in ("cancelled", "received"):
        raise HTTPException(
            status_code=400,
            detail=f"PO cannot be cancelled (status: {order['status']})",
        )
    await db.purchase_orders.update_one(
        {"_id": to_oid(order_id)},
        {
            "$set": {
                "status": "cancelled",
                "cancelled_reason": reason,
                "cancelled_by": user["username"],
                "cancelled_at": iso(now_utc()),
            }
        },
    )
    doc = await db.purchase_orders.find_one({"_id": to_oid(order_id)})
    return serialize_doc(doc)


# ==============================================================================
# Purchase Request (PR) — multi-level approval workflow → converts to PO(s)
# ==============================================================================
PR_STATUS_DRAFT = "draft"
PR_STATUS_PENDING = "pending_approval"
PR_STATUS_APPROVED = "approved"
PR_STATUS_REJECTED = "rejected"
PR_STATUS_RETURNED = "returned"
PR_STATUS_CONVERTED = "converted"

PR_PRIORITIES = {"low", "medium", "high", "urgent"}
PR_DEFAULT_FLOW = ["finance"]


async def next_pr_number() -> str:
    count = await db.purchase_requests.count_documents({})
    return f"PR-{count + 1:04d}"


async def get_pr_flow() -> List[str]:
    cfg = await db.settings.find_one({"_id": "pr_approval_flow"})
    if not cfg or not cfg.get("value"):
        return list(PR_DEFAULT_FLOW)
    return list(cfg["value"])


def _pr_can_view(pr: dict, user: dict) -> bool:
    role = user.get("role")
    if role == "admin":
        return True
    if pr.get("requester_username") == user.get("username"):
        return True
    # Approver at any level in the current or historical flow can view
    if role in (pr.get("approval_flow") or []):
        return True
    if role == "purchasing":
        return True
    return False


@api.get("/pr-config")
async def get_pr_config(user: dict = Depends(get_current_user)):
    return {"approval_flow": await get_pr_flow()}


@api.put("/pr-config")
async def set_pr_config(payload: PRConfigIn, user: dict = Depends(require_roles("admin"))):
    valid_roles = {"admin", "purchasing", "warehouse", "finance"}
    for r in payload.approval_flow:
        if r not in valid_roles:
            raise HTTPException(status_code=400, detail=f"Invalid role '{r}' in approval flow")
    if not payload.approval_flow:
        raise HTTPException(status_code=400, detail="Approval flow cannot be empty")
    await db.settings.update_one(
        {"_id": "pr_approval_flow"},
        {"$set": {"value": payload.approval_flow, "updated_at": iso(now_utc())}},
        upsert=True,
    )
    return {"approval_flow": payload.approval_flow}


@api.post("/purchase-requests")
async def create_pr(payload: PRCreateIn, user: dict = Depends(get_current_user)):
    if payload.priority not in PR_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority. Allowed: {sorted(PR_PRIORITIES)}")
    if not payload.department.strip():
        raise HTTPException(status_code=400, detail="Department is required")
    if not payload.items:
        raise HTTPException(status_code=400, detail="At least one line item is required")
    for i, l in enumerate(payload.items, start=1):
        if l.qty <= 0:
            raise HTTPException(status_code=400, detail=f"Line {i}: qty must be > 0")
        if not l.name.strip():
            raise HTTPException(status_code=400, detail=f"Line {i}: item name is required")
    # Basic attachment guard: max 5 files, per-file ≤ 2MB.
    if len(payload.attachments) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 attachments per PR")
    for a in payload.attachments:
        if a.size and a.size > 2 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"Attachment '{a.name}' exceeds 2MB limit")
    flow = await get_pr_flow()
    doc = {
        "pr_number": await next_pr_number(),
        "requester_username": user["username"],
        "requester_name": user.get("name") or user["username"],
        "request_date": iso(now_utc()),
        "department": payload.department.strip(),
        "cost_center": payload.cost_center or "",
        "required_delivery_date": payload.required_delivery_date,
        "project": payload.project or "",
        "priority": payload.priority,
        "notes": payload.notes or "",
        "items": [l.model_dump() for l in payload.items],
        "attachments": [a.model_dump() for a in payload.attachments],
        "approval_flow": flow,
        "current_level": 0,
        "approvals": [],
        "status": PR_STATUS_DRAFT,
        "converted_po_ids": [],
        "created_at": iso(now_utc()),
        "updated_at": iso(now_utc()),
    }
    res = await db.purchase_requests.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


@api.get("/purchase-requests")
async def list_prs(
    status_filter: Optional[str] = None,
    mine: Optional[bool] = False,
    user: dict = Depends(get_current_user),
):
    query: Dict[str, Any] = {}
    if status_filter:
        query["status"] = status_filter
    if mine:
        query["requester_username"] = user["username"]
    docs = await db.purchase_requests.find(query).sort("created_at", -1).to_list(500)
    # Visibility filter — hide draft PRs of other users
    visible = []
    for d in docs:
        if d["status"] == PR_STATUS_DRAFT and d["requester_username"] != user["username"] and user["role"] != "admin":
            continue
        visible.append(d)
    return [serialize_doc(d) for d in visible]


@api.get("/purchase-requests/{pr_id}")
async def get_pr(pr_id: str, user: dict = Depends(get_current_user)):
    pr = await db.purchase_requests.find_one({"_id": to_oid(pr_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="PR not found")
    if not _pr_can_view(pr, user):
        raise HTTPException(status_code=403, detail="Not allowed to view this PR")
    return serialize_doc(pr)


@api.put("/purchase-requests/{pr_id}")
async def update_pr(pr_id: str, payload: PRCreateIn, user: dict = Depends(get_current_user)):
    pr = await db.purchase_requests.find_one({"_id": to_oid(pr_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="PR not found")
    if pr["requester_username"] != user["username"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only the requester or admin can edit")
    if pr["status"] not in (PR_STATUS_DRAFT, PR_STATUS_RETURNED):
        raise HTTPException(
            status_code=400,
            detail=f"PR cannot be edited (status: {pr['status']}). Only draft or returned PRs can be edited.",
        )
    if payload.priority not in PR_PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority")
    if not payload.items:
        raise HTTPException(status_code=400, detail="At least one line item is required")
    if len(payload.attachments) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 attachments per PR")
    await db.purchase_requests.update_one(
        {"_id": to_oid(pr_id)},
        {
            "$set": {
                "department": payload.department.strip(),
                "cost_center": payload.cost_center or "",
                "required_delivery_date": payload.required_delivery_date,
                "project": payload.project or "",
                "priority": payload.priority,
                "notes": payload.notes or "",
                "items": [l.model_dump() for l in payload.items],
                "attachments": [a.model_dump() for a in payload.attachments],
                "updated_at": iso(now_utc()),
            }
        },
    )
    doc = await db.purchase_requests.find_one({"_id": to_oid(pr_id)})
    return serialize_doc(doc)


@api.post("/purchase-requests/{pr_id}/submit")
async def submit_pr(pr_id: str, user: dict = Depends(get_current_user)):
    pr = await db.purchase_requests.find_one({"_id": to_oid(pr_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="PR not found")
    if pr["requester_username"] != user["username"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only the requester or admin can submit")
    if pr["status"] not in (PR_STATUS_DRAFT, PR_STATUS_RETURNED):
        raise HTTPException(status_code=400, detail=f"PR cannot be submitted (status: {pr['status']})")
    # Re-fetch the current flow at submit time so late admin changes apply
    flow = await get_pr_flow()
    await db.purchase_requests.update_one(
        {"_id": to_oid(pr_id)},
        {
            "$set": {
                "status": PR_STATUS_PENDING,
                "approval_flow": flow,
                "current_level": 0,
                "approvals": pr.get("approvals", []),
                "submitted_at": iso(now_utc()),
                "updated_at": iso(now_utc()),
            }
        },
    )
    doc = await db.purchase_requests.find_one({"_id": to_oid(pr_id)})
    return serialize_doc(doc)


def _current_approver_role(pr: dict) -> Optional[str]:
    flow = pr.get("approval_flow") or []
    lvl = pr.get("current_level", 0)
    if 0 <= lvl < len(flow):
        return flow[lvl]
    return None


async def _record_pr_decision(pr: dict, user: dict, decision: str, comment: str) -> dict:
    """Append the decision to approvals[]. Advance level or terminate as appropriate."""
    approver_role = _current_approver_role(pr)
    if not approver_role:
        raise HTTPException(status_code=400, detail="No pending approval level on this PR")
    if user["role"] != approver_role and user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail=f"Only role '{approver_role}' can decide this level (or admin override)",
        )
    if pr["status"] != PR_STATUS_PENDING:
        raise HTTPException(status_code=400, detail=f"PR is not pending approval (status: {pr['status']})")
    entry = {
        "level": pr.get("current_level", 0),
        "role": approver_role,
        "decision": decision,
        "decided_by": user["username"],
        "comment": (comment or "").strip(),
        "decided_at": iso(now_utc()),
    }
    updates = {"$push": {"approvals": entry}, "$set": {"updated_at": iso(now_utc())}}
    if decision == "approved":
        next_level = pr.get("current_level", 0) + 1
        if next_level >= len(pr.get("approval_flow") or []):
            updates["$set"]["status"] = PR_STATUS_APPROVED
            updates["$set"]["approved_at"] = iso(now_utc())
        else:
            updates["$set"]["current_level"] = next_level
    elif decision == "rejected":
        updates["$set"]["status"] = PR_STATUS_REJECTED
    elif decision == "returned":
        updates["$set"]["status"] = PR_STATUS_RETURNED
        updates["$set"]["current_level"] = 0
    await db.purchase_requests.update_one({"_id": pr["_id"]}, updates)
    return await db.purchase_requests.find_one({"_id": pr["_id"]})


@api.post("/purchase-requests/{pr_id}/approve")
async def approve_pr(pr_id: str, payload: PRDecisionIn, user: dict = Depends(get_current_user)):
    pr = await db.purchase_requests.find_one({"_id": to_oid(pr_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="PR not found")
    doc = await _record_pr_decision(pr, user, "approved", payload.comment or "")
    return serialize_doc(doc)


@api.post("/purchase-requests/{pr_id}/reject")
async def reject_pr(pr_id: str, payload: PRDecisionIn, user: dict = Depends(get_current_user)):
    if not payload.comment or not payload.comment.strip():
        raise HTTPException(status_code=400, detail="Comment is required when rejecting a PR")
    pr = await db.purchase_requests.find_one({"_id": to_oid(pr_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="PR not found")
    doc = await _record_pr_decision(pr, user, "rejected", payload.comment)
    return serialize_doc(doc)


@api.post("/purchase-requests/{pr_id}/return")
async def return_pr(pr_id: str, payload: PRDecisionIn, user: dict = Depends(get_current_user)):
    if not payload.comment or not payload.comment.strip():
        raise HTTPException(status_code=400, detail="Comment is required when returning a PR")
    pr = await db.purchase_requests.find_one({"_id": to_oid(pr_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="PR not found")
    doc = await _record_pr_decision(pr, user, "returned", payload.comment)
    return serialize_doc(doc)


@api.post("/purchase-requests/{pr_id}/convert")
async def convert_pr_to_po(
    pr_id: str,
    payload: PRConvertIn,
    user: dict = Depends(require_roles("purchasing", "admin")),
):
    pr = await db.purchase_requests.find_one({"_id": to_oid(pr_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="PR not found")
    if pr["status"] != PR_STATUS_APPROVED:
        raise HTTPException(
            status_code=400,
            detail=f"Only fully approved PR can be converted (status: {pr['status']})",
        )
    if not payload.lines:
        raise HTTPException(status_code=400, detail="No lines provided to convert")
    # Build the vendor → line groups. Every requested line must be represented.
    groups: Dict[str, List[dict]] = {}
    seen_indices = set()
    for l in payload.lines:
        if l.line_index in seen_indices:
            raise HTTPException(status_code=400, detail=f"Duplicate line_index {l.line_index}")
        if l.line_index < 0 or l.line_index >= len(pr["items"]):
            raise HTTPException(status_code=400, detail=f"Invalid line_index {l.line_index}")
        if not l.supplier or not l.supplier.strip():
            raise HTTPException(status_code=400, detail="Supplier is required for every line")
        if l.price <= 0:
            raise HTTPException(status_code=400, detail=f"Line {l.line_index}: price must be > 0")
        seen_indices.add(l.line_index)
        seller = l.supplier.strip()
        groups.setdefault(seller, []).append({"line_index": l.line_index, "price": l.price})
    if len(seen_indices) != len(pr["items"]):
        raise HTTPException(
            status_code=400,
            detail=f"All PR lines must be assigned a vendor (got {len(seen_indices)}/{len(pr['items'])})",
        )
    created_pos = []
    for supplier, mapped in groups.items():
        po_items = []
        for m in mapped:
            src_line = pr["items"][m["line_index"]]
            # Resolve item_id: prefer the one stored on the PR line, else look up by SKU
            item_id = src_line.get("item_id")
            if not item_id and src_line.get("sku"):
                item_doc = await db.items.find_one({"sku": src_line["sku"]})
                if item_doc:
                    item_id = str(item_doc["_id"])
            if not item_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Line {m['line_index']+1} ({src_line.get('name')}) has no matching item — add it to the item master first",
                )
            po_items.append(
                {
                    "item_id": item_id,
                    "name": src_line["name"],
                    "qty": float(src_line["qty"]),
                    "unit": src_line.get("unit") or "",
                    "price": float(m["price"]),
                    "received_qty": 0,
                }
            )
        total = sum(l["qty"] * l["price"] for l in po_items)
        po_doc = {
            "po_number": await next_po_number(),
            "supplier": supplier,
            "outlet_code": pr.get("department") or "main_wh",
            "items": po_items,
            "total": total,
            "status": "waiting_approval",
            "notes": f"Generated from {pr['pr_number']}",
            "payment_terms": "",
            "created_by": user["username"],
            "created_at": iso(now_utc()),
            "approved_by": None,
            "approved_at": None,
            "from_pr_id": str(pr["_id"]),
            "from_pr_number": pr["pr_number"],
        }
        r = await db.purchase_orders.insert_one(po_doc)
        po_doc["_id"] = r.inserted_id
        created_pos.append(serialize_doc(po_doc))
    await db.purchase_requests.update_one(
        {"_id": pr["_id"]},
        {
            "$set": {
                "status": PR_STATUS_CONVERTED,
                "converted_po_ids": [p["id"] for p in created_pos],
                "converted_by": user["username"],
                "converted_at": iso(now_utc()),
                "updated_at": iso(now_utc()),
            }
        },
    )
    return {"pos": created_pos, "count": len(created_pos)}



# ==============================================================================
# Receiving (GRN) — updates stock + weighted-average COGS
# ==============================================================================
async def next_grn_number() -> str:
    count = await db.receivings.count_documents({})
    return f"GRN-{count + 1:04d}"


async def apply_weighted_average(item_id: str, qty: float, price: float):
    """Update item stock and weighted-average cost after receiving."""
    item = await db.items.find_one({"_id": to_oid(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail=f"Item {item_id} not found")
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
    # Receiving MUST be linked to an approved Purchase Order
    if not payload.po_id:
        raise HTTPException(
            status_code=400,
            detail="Receiving must reference a Purchase Order. Create & approve a PO first.",
        )
    po = await db.purchase_orders.find_one({"_id": to_oid(payload.po_id)})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase Order not found")
    # Support partial receive: allow status "approved" and "partial"
    if po["status"] not in ("approved", "partial"):
        raise HTTPException(
            status_code=400,
            detail=f"PO {po['po_number']} cannot be received (status: {po['status']})",
        )
    # Build a map of PO lines by item_id
    po_lines_by_item = {str(it["item_id"]): it for it in po["items"]}
    # Validate every incoming line + qty ≤ remaining
    for line in payload.items:
        po_line = po_lines_by_item.get(line.item_id)
        if not po_line:
            raise HTTPException(
                status_code=400,
                detail=f"Item {line.name} is not on PO {po['po_number']}",
            )
        remaining = float(po_line["qty"]) - float(po_line.get("received_qty", 0))
        if line.qty <= 0:
            raise HTTPException(status_code=400, detail=f"Qty of {line.name} must be > 0")
        if line.qty > remaining + 1e-9:
            raise HTTPException(
                status_code=400,
                detail=f"Qty of {line.name} exceeds PO remainder ({remaining} {po_line.get('unit','')} available)",
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
        "received_by": user["username"],
        "received_at": iso(now_utc()),
    }
    res = await db.receivings.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize_doc(doc)


# ==============================================================================
# Issue (Item Logout) — deducts stock, records cost at time of issue
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
            raise HTTPException(status_code=404, detail=f"Item {line.name} not found")
        if float(item.get("stock", 0)) < line.qty:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock for {line.name} (available {item.get('stock', 0)})",
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
        "issued_by": user["username"],
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
            raise HTTPException(status_code=404, detail=f"Item {line.name} not found")
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
        "counted_by": user["username"],
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
        raise HTTPException(status_code=404, detail="Stock take not found")
    if op["status"] == "approved":
        raise HTTPException(status_code=400, detail="Stock take already approved")
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
                "approved_by": user["username"],
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
                "created_by": user["username"],
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
                "label": f"Receiving {r['grn_number']} selesai",
                "detail": f"{r['supplier']} · {sum(l['qty'] for l in r['items'])} item",
                "at": r["received_at"],
            }
        )
    for r in recent_issues:
        activities.append(
            {
                "type": "issue",
                "label": f"Stock out ke {r['to_outlet']}",
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
# COGS — recipes / cost per menu
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
        "created_by": user["username"],
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
        raise HTTPException(status_code=400, detail="CSV is empty or format not recognized")
    created, updated, errors = 0, 0, []
    for i, r in enumerate(rows, start=2):
        try:
            name = r.get("name", "").strip()
            if not name:
                errors.append(f"Line {i}: item name is empty")
                continue
            sku = r.get("sku", "").strip()
            if not sku:
                errors.append(f"Line {i}: sku column is required")
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
            errors.append(f"Line {i}: {str(e)}")
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
        raise HTTPException(status_code=400, detail="CSV is empty or format not recognized")
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
                errors.append(f"Group {ref}: supplier is empty")
                continue
            items_out = []
            for row in group:
                sku = row.get("item_sku", "").strip()
                item = await db.items.find_one({"sku": sku})
                if not item:
                    errors.append(f"Line {row['row']}: SKU '{sku}' not found")
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
                "created_by": user["username"],
                "created_at": iso(now_utc()),
                "approved_by": None,
                "approved_at": None,
            }
            await db.purchase_orders.insert_one(doc)
            created += 1
        except Exception as e:
            errors.append(f"Group {ref}: {str(e)}")
    return {"created": created, "errors": errors, "total_rows": len(rows)}


@api.post("/receivings/bulk-upload")
async def receivings_bulk_upload(
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("warehouse", "admin")),
):
    """CSV header: po_number,item_sku,qty,price[,notes]
    Rows grouped by po_number → one GRN per approved PO. Applies weighted-average COGS."""
    content = await file.read()
    rows = _parse_csv(content)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV is empty or format not recognized")
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
                errors.append(f"PO {po_number}: not found")
                continue
            if po["status"] not in ("approved", "partial"):
                errors.append(f"PO {po_number}: cannot receive (status {po['status']})")
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
                        f"Line {row['row']}: SKU '{sku}' not on PO {po_number}"
                    )
                    continue
                item_id = po_skus[sku]
                item = await db.items.find_one({"_id": to_oid(item_id)})
                qty = _num(row.get("qty"))
                price = _num(row.get("price"), default=float(item.get("cost", 0)))
                po_line = po_lines_by_id.get(item_id)
                remaining = float(po_line["qty"]) - float(po_line.get("received_qty", 0))
                if qty <= 0:
                    errors.append(f"Line {row['row']}: qty must be > 0")
                    continue
                if qty > remaining + 1e-9:
                    errors.append(
                        f"Line {row['row']}: qty {qty} exceeds PO {po_number} remainder ({remaining} left)"
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
                "received_by": user["username"],
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
        raise HTTPException(status_code=400, detail="CSV is empty or format not recognized")
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
                errors.append(f"Group {ref}: to_outlet is empty")
                continue
            lines, total_cost = [], 0.0
            for row in group:
                sku = row.get("item_sku", "").strip()
                item = await db.items.find_one({"sku": sku})
                if not item:
                    errors.append(f"Line {row['row']}: SKU '{sku}' not found")
                    continue
                qty = _num(row.get("qty"))
                if float(item.get("stock", 0)) < qty:
                    errors.append(
                        f"Line {row['row']}: insufficient stock for {item['name']} ({item.get('stock', 0)} < {qty})"
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
                "issued_by": user["username"],
                "issued_at": iso(now_utc()),
                "issue_date": now_utc().strftime("%Y-%m-%d"),
            }
            await db.issues.insert_one(doc)
            created += 1
        except Exception as e:
            errors.append(f"Group {ref}: {str(e)}")
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
# Reports
# ==============================================================================
def _in_window(iso_str: Optional[str], start: Optional[str], end: Optional[str]) -> bool:
    """Check if ISO date string falls between start/end (YYYY-MM-DD inclusive)."""
    if not iso_str:
        return False
    d = iso_str[:10]
    if start and d < start:
        return False
    if end and d > end:
        return False
    return True


@api.get("/reports/po-by-supplier")
async def report_po_by_supplier(
    start: Optional[str] = None,
    end: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Overview Purchase Order per supplier: jumlah PO, nilai total, distribusi status."""
    query: Dict[str, Any] = {}
    if start:
        query.setdefault("created_at", {})["$gte"] = start
    if end:
        query.setdefault("created_at", {})["$lte"] = end + "T23:59:59"
    orders = await db.purchase_orders.find(query).to_list(2000)
    by_sup: Dict[str, Dict[str, Any]] = {}
    for o in orders:
        key = o.get("supplier", "-")
        b = by_sup.setdefault(
            key,
            {
                "supplier": key,
                "po_count": 0,
                "po_total": 0,
                "received_total": 0,
                "waiting": 0,
                "approved": 0,
                "partial": 0,
                "received": 0,
                "cancelled": 0,
                "outstanding_value": 0,
            },
        )
        b["po_count"] += 1
        b["po_total"] += float(o.get("total", 0))
        b[o.get("status", "waiting_approval").replace("waiting_approval", "waiting")] = (
            b.get(o.get("status", "waiting_approval").replace("waiting_approval", "waiting"), 0) + 1
        )
        for line in o.get("items", []):
            qty = float(line.get("qty", 0))
            recv = float(line.get("received_qty", 0))
            price = float(line.get("price", 0))
            b["received_total"] += recv * price
            if o.get("status") in ("approved", "partial"):
                b["outstanding_value"] += (qty - recv) * price
    rows = sorted(by_sup.values(), key=lambda r: r["po_total"], reverse=True)
    return {
        "period": {"start": start, "end": end},
        "rows": rows,
        "totals": {
            "supplier_count": len(rows),
            "po_count": sum(r["po_count"] for r in rows),
            "po_total": sum(r["po_total"] for r in rows),
            "outstanding_value": sum(r["outstanding_value"] for r in rows),
        },
    }


@api.get("/reports/po-outstanding")
async def report_po_outstanding(user: dict = Depends(get_current_user)):
    """PO yang belum tuntas — status approved/partial dengan sisa qty & nilai."""
    orders = (
        await db.purchase_orders.find({"status": {"$in": ["approved", "partial"]}})
        .sort("created_at", 1)
        .to_list(1000)
    )
    rows = []
    total_outstanding = 0.0
    for o in orders:
        lines = []
        po_outstanding = 0.0
        for line in o.get("items", []):
            qty = float(line.get("qty", 0))
            recv = float(line.get("received_qty", 0))
            remaining = max(qty - recv, 0)
            price = float(line.get("price", 0))
            value = remaining * price
            po_outstanding += value
            if remaining > 0:
                lines.append(
                    {
                        "name": line.get("name"),
                        "unit": line.get("unit", ""),
                        "qty_ordered": qty,
                        "qty_received": recv,
                        "qty_remaining": remaining,
                        "price": price,
                        "value_remaining": value,
                    }
                )
        if not lines:
            continue
        # Days elapsed since created
        try:
            days = max(0, (now_utc() - datetime.fromisoformat(o["created_at"].replace("Z", "+00:00"))).days)
        except Exception:
            days = None
        total_outstanding += po_outstanding
        rows.append(
            {
                "id": str(o["_id"]),
                "po_number": o.get("po_number"),
                "supplier": o.get("supplier"),
                "outlet_code": o.get("outlet_code"),
                "status": o.get("status"),
                "created_at": o.get("created_at"),
                "days_open": days,
                "outstanding_value": po_outstanding,
                "lines": lines,
            }
        )
    return {"rows": rows, "totals": {"po_count": len(rows), "outstanding_value": total_outstanding}}


@api.get("/reports/stock-balance")
async def report_stock_balance(
    outlet: Optional[str] = None,
    category: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Saldo stok saat ini per item, dengan valuasi (stock * COGS)."""
    query: Dict[str, Any] = {}
    if outlet and outlet != "all":
        query["outlet_code"] = outlet
    if category:
        query["category"] = category
    items = await db.items.find(query).sort("name", 1).to_list(2000)
    rows = []
    total_value = 0.0
    for i in items:
        stock = float(i.get("stock", 0))
        cost = float(i.get("cost", 0))
        value = stock * cost
        total_value += value
        rows.append(
            {
                "sku": i.get("sku"),
                "name": i.get("name"),
                "category": i.get("category"),
                "outlet_code": i.get("outlet_code"),
                "unit": i.get("unit"),
                "stock": stock,
                "min_stock": float(i.get("min_stock", 0)),
                "cost": cost,
                "value": value,
                "low": stock <= float(i.get("min_stock", 0)),
            }
        )
    return {
        "rows": rows,
        "totals": {
            "item_count": len(rows),
            "total_value": total_value,
            "low_stock_count": sum(1 for r in rows if r["low"]),
        },
    }


@api.get("/reports/stock-movement")
async def report_stock_movement(
    start: Optional[str] = None,
    end: Optional[str] = None,
    item_sku: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Kartu stok: gerakan masuk (GRN) & keluar (issue) & adjustment (opname)."""
    # Fetch relevant docs — filter by date/sku
    grns = await db.receivings.find({}).sort("received_at", 1).to_list(5000)
    issues = await db.issues.find({}).sort("issued_at", 1).to_list(5000)
    opnames = await db.opnames.find({"status": "approved"}).to_list(5000)

    movements = []
    for g in grns:
        if not _in_window(g.get("received_at"), start, end):
            continue
        for line in g.get("items", []):
            if item_sku:
                # Need to resolve item sku
                item = await db.items.find_one({"_id": to_oid(line["item_id"])})
                if not item or item.get("sku") != item_sku:
                    continue
            movements.append(
                {
                    "date": g.get("received_at"),
                    "ref": g.get("grn_number"),
                    "type": "IN (GRN)",
                    "item_id": line["item_id"],
                    "name": line["name"],
                    "unit": line.get("unit"),
                    "qty_in": float(line.get("qty", 0)),
                    "qty_out": 0,
                    "value": float(line.get("qty", 0)) * float(line.get("price", 0)),
                    "supplier": g.get("supplier"),
                }
            )
    for iss in issues:
        if not _in_window(iss.get("issued_at"), start, end):
            continue
        for line in iss.get("items", []):
            if item_sku:
                item = await db.items.find_one({"_id": to_oid(line["item_id"])})
                if not item or item.get("sku") != item_sku:
                    continue
            movements.append(
                {
                    "date": iss.get("issued_at"),
                    "ref": iss.get("issue_number"),
                    "type": "OUT (Issue)",
                    "item_id": line["item_id"],
                    "name": line["name"],
                    "unit": line.get("unit"),
                    "qty_in": 0,
                    "qty_out": float(line.get("qty", 0)),
                    "value": float(line.get("line_total", 0)),
                    "to_outlet": iss.get("to_outlet"),
                }
            )
    for op in opnames:
        if not _in_window(op.get("created_at"), start, end):
            continue
        for line in op.get("items", []):
            variance = float(line.get("variance", 0))
            if variance == 0:
                continue
            if item_sku:
                item = await db.items.find_one({"_id": to_oid(line["item_id"])})
                if not item or item.get("sku") != item_sku:
                    continue
            movements.append(
                {
                    "date": op.get("created_at"),
                    "ref": op.get("opname_number"),
                    "type": "ADJ (Opname)",
                    "item_id": line["item_id"],
                    "name": line["name"],
                    "unit": line.get("unit"),
                    "qty_in": variance if variance > 0 else 0,
                    "qty_out": -variance if variance < 0 else 0,
                    "value": float(line.get("variance_value", 0)),
                }
            )
    movements.sort(key=lambda m: m["date"] or "")
    total_in = sum(m["qty_in"] for m in movements)
    total_out = sum(m["qty_out"] for m in movements)
    total_value_in = sum(m["value"] for m in movements if m["qty_in"] > 0)
    total_value_out = sum(m["value"] for m in movements if m["qty_out"] > 0)
    return {
        "period": {"start": start, "end": end},
        "rows": movements,
        "totals": {
            "count": len(movements),
            "total_qty_in": total_in,
            "total_qty_out": total_out,
            "total_value_in": total_value_in,
            "total_value_out": total_value_out,
        },
    }


@api.get("/reports/financial/flash-cost")
async def report_flash_cost_financial(
    start: Optional[str] = None,
    end: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Financial flash-cost per outlet & agregat harian dalam rentang tanggal."""
    today_dt = now_utc().date()
    start_d = start or (today_dt - timedelta(days=6)).isoformat()
    end_d = end or today_dt.isoformat()
    # Generate day list
    sd = datetime.fromisoformat(start_d).date()
    ed = datetime.fromisoformat(end_d).date()
    days = []
    while sd <= ed:
        days.append(sd.isoformat())
        sd += timedelta(days=1)

    outlets = await db.outlets.find({}).to_list(50)
    outlet_map = {o["code"]: o["name"] for o in outlets}

    # Aggregate issues by (outlet, date)
    issue_agg = await db.issues.aggregate(
        [
            {"$match": {"issue_date": {"$gte": start_d, "$lte": end_d}}},
            {
                "$group": {
                    "_id": {"outlet": "$to_outlet", "date": "$issue_date"},
                    "cost": {"$sum": "$total_cost"},
                }
            },
        ]
    ).to_list(2000)
    cost_map = {(r["_id"]["outlet"], r["_id"]["date"]): r["cost"] for r in issue_agg}

    rev_agg = await db.revenues.aggregate(
        [
            {"$match": {"date": {"$gte": start_d, "$lte": end_d}}},
            {
                "$group": {
                    "_id": {"outlet": "$outlet_code", "date": "$date"},
                    "amount": {"$sum": "$amount"},
                }
            },
        ]
    ).to_list(2000)
    rev_map = {(r["_id"]["outlet"], r["_id"]["date"]): r["amount"] for r in rev_agg}

    outlet_summary: Dict[str, Dict[str, Any]] = {}
    daily_totals = []
    for d in days:
        day_cost = 0
        day_rev = 0
        for o in outlets:
            code = o["code"]
            c = float(cost_map.get((code, d), 0))
            r = float(rev_map.get((code, d), 0))
            day_cost += c
            day_rev += r
            os = outlet_summary.setdefault(
                code,
                {"outlet_code": code, "outlet_name": o["name"], "cost": 0, "revenue": 0},
            )
            os["cost"] += c
            os["revenue"] += r
        daily_totals.append(
            {
                "date": d,
                "cost": day_cost,
                "revenue": day_rev,
                "percentage": round((day_cost / day_rev * 100), 2) if day_rev > 0 else 0,
            }
        )
    outlet_rows = []
    for code, data in outlet_summary.items():
        pct = round((data["cost"] / data["revenue"] * 100), 2) if data["revenue"] > 0 else 0
        outlet_rows.append({**data, "percentage": pct})
    outlet_rows.sort(key=lambda r: r["cost"], reverse=True)

    total_cost = sum(r["cost"] for r in outlet_rows)
    total_rev = sum(r["revenue"] for r in outlet_rows)
    return {
        "period": {"start": start_d, "end": end_d},
        "daily": daily_totals,
        "by_outlet": outlet_rows,
        "totals": {
            "total_cost": total_cost,
            "total_revenue": total_rev,
            "percentage": round((total_cost / total_rev * 100), 2) if total_rev > 0 else 0,
        },
    }


@api.get("/reports/low-stock")
async def report_low_stock(user: dict = Depends(get_current_user)):
    """Item dengan stok di atau di bawah min stock."""
    items = await db.items.find({}).to_list(2000)
    rows = []
    for i in items:
        stock = float(i.get("stock", 0))
        mn = float(i.get("min_stock", 0))
        if stock <= mn:
            need = max(mn - stock, 0)
            rows.append(
                {
                    "sku": i.get("sku"),
                    "name": i.get("name"),
                    "category": i.get("category"),
                    "outlet_code": i.get("outlet_code"),
                    "unit": i.get("unit"),
                    "stock": stock,
                    "min_stock": mn,
                    "need_to_order": need,
                    "cost": float(i.get("cost", 0)),
                    "supplier": i.get("supplier"),
                }
            )
    rows.sort(key=lambda r: r["stock"] - r["min_stock"])
    return {"rows": rows, "totals": {"count": len(rows)}}


@api.get("/reports/top-consumed")
async def report_top_consumed(
    days: int = 30, limit: int = 20, user: dict = Depends(get_current_user)
):
    """Item dengan konsumsi tertinggi (issue) selama N hari terakhir."""
    days = max(1, min(days, 365))
    since = (now_utc() - timedelta(days=days)).strftime("%Y-%m-%d")
    pipeline = [
        {"$match": {"issue_date": {"$gte": since}}},
        {"$unwind": "$items"},
        {
            "$group": {
                "_id": {"item_id": "$items.item_id", "name": "$items.name", "unit": "$items.unit"},
                "qty": {"$sum": "$items.qty"},
                "value": {"$sum": "$items.line_total"},
                "transactions": {"$sum": 1},
            }
        },
        {"$sort": {"value": -1}},
        {"$limit": limit},
    ]
    docs = await db.issues.aggregate(pipeline).to_list(limit)
    rows = [
        {
            "item_id": r["_id"]["item_id"],
            "name": r["_id"]["name"],
            "unit": r["_id"].get("unit", ""),
            "qty": r["qty"],
            "value": r["value"],
            "transactions": r["transactions"],
        }
        for r in docs
    ]
    return {
        "period": {"days": days, "since": since},
        "rows": rows,
        "totals": {"item_count": len(rows), "total_value": sum(r["value"] for r in rows)},
    }


# ==============================================================================
# Seeding
# ==============================================================================
async def migrate_users_to_username():
    """One-time migration: derive `username` for any user that still has `email`.
    Runs BEFORE the unique index on `username` is created."""
    # Best-effort drop of legacy email index so we can remove the field
    try:
        existing_idx = await db.users.index_information()
        for idx_name in list(existing_idx.keys()):
            keys = existing_idx[idx_name].get("key", [])
            if any(k[0] == "email" for k in keys):
                await db.users.drop_index(idx_name)
                logger.info("Dropped legacy user index: %s", idx_name)
    except Exception as e:
        logger.warning("Could not inspect/drop legacy user indexes: %s", e)

    async for u in db.users.find({"username": {"$exists": False}}):
        legacy_email = (u.get("email") or "").lower().strip()
        candidate = legacy_email.split("@", 1)[0] if legacy_email else f"user{str(u['_id'])[:6]}"
        candidate = re.sub(r"[^a-zA-Z0-9._]", "", candidate) or f"user{str(u['_id'])[:6]}"
        base = candidate[:30]
        final = base
        n = 1
        while await db.users.find_one({"username": final, "_id": {"$ne": u["_id"]}}):
            n += 1
            final = f"{base[:27]}{n:02d}"
        await db.users.update_one(
            {"_id": u["_id"]},
            {"$set": {"username": final}, "$unset": {"email": ""}},
        )
        logger.info("Migrated legacy user %s -> username=%s", legacy_email or u["_id"], final)
    # Sweep: strip any remaining email field on already-migrated docs
    await db.users.update_many({"email": {"$exists": True}}, {"$unset": {"email": ""}})


async def seed_data():    # Users
    admin_username = normalize_username(
        os.environ.get("ADMIN_USERNAME", "admin")
    )
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    demo_users = [
        {"username": admin_username, "password": admin_password, "name": "Admin Lago Bali", "role": "admin"},
        {"username": "purchasing", "password": "demo123", "name": "Rina (Purchasing)", "role": "purchasing"},
        {"username": "warehouse", "password": "demo123", "name": "Budi (Warehouse)", "role": "warehouse"},
        {"username": "finance", "password": "demo123", "name": "Sari (Finance)", "role": "finance"},
    ]
    for u in demo_users:
        existing = await db.users.find_one({"username": u["username"]})
        if existing is None:
            await db.users.insert_one(
                {
                    "username": u["username"],
                    "password_hash": hash_password(u["password"]),
                    "name": u["name"],
                    "role": u["role"],
                    "created_at": iso(now_utc()),
                }
            )
        elif not verify_password(u["password"], existing["password_hash"]):
            await db.users.update_one(
                {"username": u["username"]},
                {"$set": {"password_hash": hash_password(u["password"])}},
            )

    # Outlets
    outlets = [
        {"name": "Main Warehouse", "code": "main_wh", "type": "warehouse"},
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
    await db.users.create_index("username", unique=True)
    await db.outlets.create_index("code", unique=True)
    await db.suppliers.create_index("code", unique=True)
    await db.items.create_index("sku", unique=True)
    await db.purchase_orders.create_index("po_number", unique=True)
    await db.purchase_requests.create_index("pr_number", unique=True)
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
    await migrate_users_to_username()
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
