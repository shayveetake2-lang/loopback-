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

## Cloudflare deployment

The static dashboard is Pages-ready:

```bash
npx wrangler pages deploy frontend --project-name loopback
```

For production, deploy the FastAPI service to a Python-capable host and set `window.LOOPBACK_API_URL` before `app.js` loads, or proxy `/api/*` from the Pages project to that service. Cloudflare Pages serves the frontend; FastAPI remains the JSON-backed API service.