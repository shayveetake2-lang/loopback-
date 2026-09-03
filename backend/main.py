from __future__ import annotations

import json
import hashlib
import secrets
import sqlite3
import time
from datetime import date
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "contacts.json"
USERS_FILE = DATA_DIR / "users.json"
DB_PATH = DATA_DIR / "loopback.db"
TIER_DEFAULTS = {"Inner Loop": {"cadence_days": 14, "weight": 1.5}, "Mid Loop": {"cadence_days": 60, "weight": 1.0}, "Outer Loop": {"cadence_days": 120, "weight": 0.5}}
TierName = Literal["Inner Loop", "Mid Loop", "Outer Loop"]


class Interaction(BaseModel):
    date: str
    type: str
    note: str


class Contact(BaseModel):
    id: str
    name: str
    avatar_url: str
    last_interaction_date: str
    last_topic: str = ""
    relationship_tier: TierName
    custom_cadence_days: int = Field(gt=0)
    role: str = ""
    company: str = ""
    location: str = ""
    interactions: list[Interaction] = []
    deals: list[str] = []


class IcebreakerRequest(BaseModel):
    contact_id: str


class AccountCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str
    password: str


class RoleUpdate(BaseModel):
    role: Literal["admin", "member"]


app = FastAPI(title="LoopBack API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
security = HTTPBearer(auto_error=False)
sessions: dict[str, dict[str, object]] = {}


@app.on_event("startup")
def startup_event() -> None:
    init_db()


def get_db_connection() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_db_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            created_at TEXT NOT NULL DEFAULT CURRENT_DATE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            avatar_url TEXT,
            last_interaction_date TEXT,
            last_topic TEXT DEFAULT '',
            relationship_tier TEXT NOT NULL,
            custom_cadence_days INTEGER NOT NULL,
            role TEXT DEFAULT '',
            company TEXT DEFAULT '',
            location TEXT DEFAULT '',
            interactions TEXT DEFAULT '[]',
            deals TEXT DEFAULT '[]'
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            expires_at REAL NOT NULL
        )
        """
    )
    conn.commit()

    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0 and USERS_FILE.exists():
        users = json.loads(USERS_FILE.read_text())
        if users:
            conn.executemany(
                """
                INSERT INTO users (id, name, email, password_hash, role, created_at)
                VALUES (:id, :name, :email, :password_hash, :role, :created_at)
                """,
                users,
            )

    if conn.execute("SELECT COUNT(*) FROM contacts").fetchone()[0] == 0 and DATA_FILE.exists():
        contacts = json.loads(DATA_FILE.read_text())
        if contacts:
            conn.executemany(
                """
                INSERT INTO contacts (
                    id, name, avatar_url, last_interaction_date, last_topic,
                    relationship_tier, custom_cadence_days, role, company, location,
                    interactions, deals
                ) VALUES (
                    :id, :name, :avatar_url, :last_interaction_date, :last_topic,
                    :relationship_tier, :custom_cadence_days, :role, :company, :location,
                    :interactions, :deals
                )
                """,
                [
                    {
                        **item,
                        "interactions": json.dumps(item.get("interactions", [])),
                        "deals": json.dumps(item.get("deals", [])),
                    }
                    for item in contacts
                ],
            )

    conn.commit()
    conn.close()


def load_contacts() -> list[Contact]:
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM contacts ORDER BY name").fetchall()
    conn.close()
    return [
        Contact.model_validate(
            {
                **dict(row),
                "interactions": json.loads(row["interactions"] or "[]"),
                "deals": json.loads(row["deals"] or "[]"),
            }
        )
        for row in rows
    ]


def load_users() -> list[dict[str, object]]:
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM users ORDER BY created_at, email").fetchall()
    conn.close()
    return [dict(row) for row in rows]


def save_users(users: list[dict[str, object]]) -> None:
    conn = get_db_connection()
    conn.execute("DELETE FROM users")
    conn.executemany(
        """
        INSERT INTO users (id, name, email, password_hash, role, created_at)
        VALUES (:id, :name, :email, :password_hash, :role, :created_at)
        """,
        users,
    )
    conn.commit()
    conn.close()


def password_hash(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"pbkdf2_sha256${salt}${digest}"


def password_matches(password: str, stored: str) -> bool:
    try:
        _, salt, expected = stored.split("$", 2)
    except ValueError:
        return False
    actual = password_hash(password, salt).split("$", 2)[2]
    return secrets.compare_digest(actual, expected)


def public_user(user: dict[str, object]) -> dict[str, object]:
    return {key: user[key] for key in ("id", "name", "email", "role", "created_at")}


def current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict[str, object]:
    if not credentials or credentials.credentials not in sessions:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    session = sessions[credentials.credentials]
    if float(session["expires_at"]) < time.time():
        del sessions[credentials.credentials]
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    user = next((item for item in load_users() if item["id"] == session["user_id"]), None)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account no longer exists")
    return user


def admin_user(user: dict[str, object] = Depends(current_user)) -> dict[str, object]:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def find_contact(contact_id: str) -> Contact:
    contact = next((item for item in load_contacts() if item.id == contact_id), None)
    if contact is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


def drift_for(contact: Contact) -> dict:
    elapsed = max((date.today() - date.fromisoformat(contact.last_interaction_date)).days, 0)
    tier = TIER_DEFAULTS[contact.relationship_tier]
    cadence = contact.custom_cadence_days or tier["cadence_days"]
    score = round(min((elapsed / cadence) * 100 * tier["weight"], 100), 1)
    return {**contact.model_dump(), "days_since_contact": elapsed, "cadence_days": cadence, "priority_weight": tier["weight"], "drift_score": score, "is_overdue": elapsed >= cadence}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/register")
def register(payload: AccountCreate) -> dict[str, object]:
    users = load_users()
    email = payload.email.strip().lower()
    if any(user["email"] == email for user in users):
        raise HTTPException(status_code=409, detail="An account with that email already exists")
    user = {"id": secrets.token_hex(8), "name": payload.name.strip(), "email": email, "role": "admin" if not users else "member", "password_hash": password_hash(payload.password), "created_at": date.today().isoformat()}
    users.append(user)
    save_users(users)
    return create_session(user)


def create_session(user: dict[str, object]) -> dict[str, object]:
    token = secrets.token_urlsafe(32)
    sessions[token] = {"user_id": user["id"], "expires_at": time.time() + 60 * 60 * 24}
    return {"token": token, "user": public_user(user)}


@app.post("/api/auth/login")
def login(payload: LoginRequest) -> dict[str, object]:
    user = next((item for item in load_users() if item["email"] == payload.email.strip().lower()), None)
    if user is None or not password_matches(payload.password, str(user["password_hash"])):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return create_session(user)


@app.get("/api/auth/me")
def me(user: dict[str, object] = Depends(current_user)) -> dict[str, object]:
    return public_user(user)


@app.post("/api/auth/logout")
def logout(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict[str, str]:
    if credentials:
        sessions.pop(credentials.credentials, None)
    return {"status": "ok"}


@app.get("/api/admin/users")
def admin_users(_: dict[str, object] = Depends(admin_user)) -> list[dict[str, object]]:
    return [public_user(user) for user in load_users()]


@app.patch("/api/admin/users/{user_id}")
def update_role(user_id: str, payload: RoleUpdate, _: dict[str, object] = Depends(admin_user)) -> dict[str, object]:
    users = load_users()
    target = next((user for user in users if user["id"] == user_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Account not found")
    target["role"] = payload.role
    save_users(users)
    return public_user(target)


@app.get("/api/contacts")
def contacts(_: dict[str, object] = Depends(current_user)) -> list[Contact]:
    return load_contacts()


@app.get("/api/contacts/drift")
def drift_contacts(_: dict[str, object] = Depends(current_user)) -> list[dict]:
    return sorted((drift_for(contact) for contact in load_contacts()), key=lambda item: item["drift_score"], reverse=True)


@app.post("/api/icebreaker/generate")
def generate_icebreaker(payload: IcebreakerRequest, _: dict[str, object] = Depends(current_user)) -> dict[str, object]:
    contact = find_contact(payload.contact_id)
    system_prompt = f"""You are LoopBack's thoughtful relationship assistant. Write two short, warm, non-robotic message options for this contact.
Contact name: {contact.name}
Relationship tier: {contact.relationship_tier}
Last topic: {contact.last_topic}
Rules: reference the last topic naturally, avoid generic networking language, ask one easy-to-answer question, and never mention that you are an AI. Use Casual/Warm for Inner Loop; use Professional/Direct for Mid Loop and Outer Loop.
Return only the two message options labeled Casual/Warm and Professional/Direct."""
    first_name = contact.name.split()[0]
    casual = f"Hey {first_name} — I was thinking about our conversation: {contact.last_topic}. How has that been unfolding?"
    professional = f"Hi {first_name}, I enjoyed our conversation around {contact.last_topic}. How is that progressing on your end?"
    return {"contact_id": contact.id, "prompt": system_prompt, "options": {"casual_warm": casual, "professional_direct": professional}, "draft": casual if contact.relationship_tier == "Inner Loop" else professional}
