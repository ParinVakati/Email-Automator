# RecruiterReach

RecruiterReach is an approval-first, single-user recruiter outreach workspace. This repository contains a Next.js frontend and a FastAPI backend. **This is an initial working foundation, not the complete production system described in the original specification.** In particular, the app does not send email or connect to Gmail; the launch endpoint intentionally returns `503` rather than pretending to send anything.

## What works

- Private API access using a backend bearer token.
- Public HTTPS job-page fetching with redirect checks, size/time limits, and deterministic JSON-LD extraction.
- Local job analysis caching and a campaign recipient cap.
- Optional Brave Search and Hunter domain-search contact discovery; results are not fabricated.
- Recipient deduplication, verification gating, and opt-out suppression.
- Deterministic, editable email drafts and an explicit campaign approval step.
- SQLite persistence for local development and containerized startup.
- Tests for job extraction, URL checks, authentication, and campaign limits.

## Not implemented yet

Gmail OAuth, Gmail sending, delivery/reply synchronization, a durable Redis/Celery worker, Supabase authentication/database, encrypted provider credentials, AI-provider adapters, recruiter verification requests, migrations, analytics beyond persisted workflow counts, and the remaining dashboard pages are not implemented. Do not deploy this as a production outreach service or enter production credentials until these controls are added and reviewed. API credentials are currently configured in the backend environment, never in the browser.

## Local development

Requirements: Python 3.11+ and Node.js 20+.

1. Configure the API:

   ```powershell
   cd backend
   Copy-Item .env.example .env
   ```

   Replace `APP_ACCESS_TOKEN` with a long random secret. Set `BRAVE_SEARCH_API_KEY` and `HUNTER_API_KEY` to enable recruiter discovery. Never commit `.env`.

2. Start the API in one terminal:

   ```powershell
   cd backend
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```

3. Start the web app in another terminal:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

4. Open <http://localhost:3000>. Paste the same `APP_ACCESS_TOKEN` in the private API access token field. The API docs are available at <http://localhost:8000/docs>.

The local database defaults to `backend/recruiterreach.db`. You can override it with `DATABASE_URL`. `MAX_CAMPAIGN_RECIPIENTS` defaults to 10.

## Docker Compose

Create `backend/.env` from `backend/.env.example`, set a unique `APP_ACCESS_TOKEN`, and run:

```powershell
docker compose up --build
```

The app is available at <http://localhost:3000> and the API at <http://localhost:8000>. The SQLite database is stored in the Compose-managed `recruiterreach-data` volume.

## API outline

All `/api/*` endpoints require `Authorization: Bearer <APP_ACCESS_TOKEN>`.

- `POST /api/jobs/analyze`
- `POST /api/recruiters/discover?job_id=<id>`
- `POST /api/recruiters/verify`
- `POST /api/campaigns`
- `POST /api/campaigns/{id}/recruiters`
- `POST /api/campaigns/{id}/generate`
- `POST /api/campaigns/{id}/approve`
- `POST /api/campaigns/{id}/launch` (intentionally unavailable until Gmail and a durable worker exist)
- `GET /api/campaigns`
- `GET /api/campaigns/{id}`
- `GET /api/analytics`

## Tests and build

```powershell
cd backend
pip install -r requirements.txt
pytest
```

```powershell
cd frontend
npm install
npm run build
```

## Deployment/security notes

The bearer-token setup is suitable only as a local-development gate, not a substitute for secure user authentication, CSRF/session management, credential encryption, operational monitoring, or deployment hardening. The job-page fetcher rejects non-HTTPS URLs, non-public DNS answers, invalid redirects, and oversized pages; review the SSRF protections before exposing this service to untrusted users. Respect provider terms and applicable outreach/privacy laws, verify contact eligibility, and honor opt-outs.
