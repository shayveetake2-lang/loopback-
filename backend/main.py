from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "contacts.json"
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
    relationship_tier: TierName
    custom_cadence_days: int = Field(gt=0)
    role: str = ""
    company: str = ""
    location: str = ""
    interactions: list[Interaction] = []
    deals: list[str] = []


class IcebreakerRequest(BaseModel):
    contact_id: str


app = FastAPI(title="LoopBack API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])


def load_contacts() -> list[Contact]:
    return [Contact.model_validate(item) for item in json.loads(DATA_FILE.read_text())]


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


@app.get("/api/contacts")
def contacts() -> list[Contact]:
    return load_contacts()


@app.get("/api/contacts/drift")
def drift_contacts() -> list[dict]:
    return sorted((drift_for(contact) for contact in load_contacts()), key=lambda item: item["drift_score"], reverse=True)


@app.post("/api/icebreaker/generate")
def generate_icebreaker(payload: IcebreakerRequest) -> dict[str, str]:
    contact = find_contact(payload.contact_id)
    latest = contact.interactions[0] if contact.interactions else None
    if latest:
        draft = f"Hey {contact.name.split()[0]} — I was just thinking about our conversation: {latest.note} How has that been unfolding?"
    else:
        draft = f"Hey {contact.name.split()[0]} — it has been a while. What has been energizing you lately?"
    return {"contact_id": contact.id, "draft": draft}
