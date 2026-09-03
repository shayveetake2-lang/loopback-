# LoopBack.ai

Local-first relationship tracking with weighted orbit tiers and context-aware icebreakers.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Open `frontend/index.html` while the API is running at `http://127.0.0.1:8000`.

The JSON data store lives at `data/contacts.json`. API routes include `GET /api/contacts/drift` and `POST /api/icebreaker/generate`.