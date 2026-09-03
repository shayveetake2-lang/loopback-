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

The included Pages Function at `functions/api/[[path]].js` proxies `/api/*` to the FastAPI service. Deploy the API to a Python-capable host, then configure its public URL once:

The repository includes a `Dockerfile` and `render.yaml` for a straightforward Render deployment. In Render, choose **New > Blueprint**, select this GitHub repository, and deploy the `loopback-api` service. Copy its generated `https://...onrender.com` URL as the API origin.

```bash
npx wrangler pages secret put API_ORIGIN --project-name loopback
```

Paste the API origin when Wrangler prompts. Then redeploy Pages. Cloudflare Pages serves the frontend and proxy; FastAPI remains the JSON-backed API service.