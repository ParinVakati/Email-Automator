# RecruiterReach

RecruiterReach is a private, approval-first recruiter outreach workspace with a Next.js frontend and FastAPI API. Google sign-in is provided through Supabase Auth; Supabase access tokens are validated by the API, and campaign, profile, and activity records are scoped to the signed-in Supabase account.

## Current functionality

- Google sign-in through Supabase OAuth.
- Private account-scoped campaigns, candidate profile, analytics, and activity history.
- Public HTTPS job analysis with robots.txt checks, redirect validation, size limits, deterministic JSON-LD extraction, and local caching.
- Optional Brave Search and Hunter contact discovery and verification.
- Recruiter suppression, editable template-based drafts, recipient caps, and explicit approval.
- SQLite for local development; configure `DATABASE_URL` to use a persistent PostgreSQL service in deployment.

Gmail OAuth, Gmail sending, reply synchronization, a durable Redis/Celery worker, AI-provider adapters, and production database migrations remain unimplemented. Launching an approved campaign explicitly returns `503` without sending any email. The API will fail closed if Supabase authentication is not configured.

## Configure Google sign-in

1. Create a Supabase project.
2. In **Authentication → Providers**, enable **Google** and configure the OAuth client ID and secret from Google Cloud Console.
3. In **Authentication → URL Configuration**, set the site URL and add these redirect URLs:
   - Local: `http://localhost:3000/auth/callback`
   - Production: `https://YOUR-VERCEL-DOMAIN/auth/callback`
4. Configure the OAuth consent screen and authorized redirect URI in Google Cloud as instructed by Supabase. Google should redirect to the Supabase Auth callback URL shown in the provider setup, not directly to this app.
5. Copy the Supabase project URL and **publishable/anon key**. The publishable key is expected in the browser; **never use or expose the Supabase service-role key**.

## Local development

Requirements: Python 3.11+ and Node.js 20+.

1. Configure the backend:

   ```powershell
   cd backend
   Copy-Item .env.example .env
   ```

   Set `SUPABASE_URL` to your project URL. Set `BRAVE_SEARCH_API_KEY` and `HUNTER_API_KEY` only if you want to enable recruiter discovery. Keep `.env` private.

2. Configure the frontend:

   ```powershell
   cd frontend
   Copy-Item .env.example .env.local
   ```

   Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to your Supabase project URL and publishable/anon key. `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000`.

3. Run the API in one terminal:

   ```powershell
   cd backend
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```

4. Run the frontend in another terminal:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

5. Open <http://localhost:3000> and choose **Continue with Google**. The API docs are at <http://localhost:8000/docs>.

The local database defaults to `backend/recruiterreach.db`. You can override it with `DATABASE_URL`. `MAX_CAMPAIGN_RECIPIENTS` defaults to 10. Existing local campaigns from before account authentication have no owner and are intentionally not visible to signed-in accounts.

## Deploy

### Backend

Deploy `backend` as a Python web service (for example, on Render):

- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Environment: `SUPABASE_URL`, `FRONTEND_ORIGIN`, and a persistent PostgreSQL `DATABASE_URL`.
- Optional discovery keys: `BRAVE_SEARCH_API_KEY`, `HUNTER_API_KEY`.

The default SQLite file is not appropriate for ephemeral hosting; supply a persistent PostgreSQL `DATABASE_URL`. Database schema upgrades are currently limited to the small account-ownership migration on startup; add a full migration framework before evolving production schemas.

### Frontend

Import the repository into Vercel:

- Root directory: `frontend`
- Framework: Next.js
- Environment variables:
  - `NEXT_PUBLIC_API_URL`: deployed backend URL.
  - `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase publishable/anon key.

After deployment, set `FRONTEND_ORIGIN` on the backend to the exact Vercel origin and add the production `/auth/callback` URL to Supabase's allowed redirect URLs.

## Docker Compose

Create `backend/.env` from `backend/.env.example`, set `SUPABASE_URL`, and add provider keys if needed. In PowerShell, set the frontend's public Supabase configuration before building:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = "https://YOUR-PROJECT.supabase.co"
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "YOUR-PUBLISHABLE-KEY"
docker compose up --build
```

The local site is available at <http://localhost:3000>, and the API at <http://localhost:8000>. Docker Compose uses a named volume for its local SQLite database. Use a managed PostgreSQL URL for a persistent hosted deployment.

## API outline

All private `/api/*` endpoints require `Authorization: Bearer <Supabase access token>`.

- `POST /api/jobs/analyze`
- `POST /api/recruiters/discover?job_id=<id>`
- `POST /api/recruiters/verify`
- `POST /api/campaigns`
- `POST /api/campaigns/{id}/recruiters`
- `POST /api/campaigns/{id}/generate`
- `POST /api/campaigns/{id}/drafts`
- `POST /api/campaigns/{id}/approve`
- `POST /api/campaigns/{id}/launch` (intentionally unavailable until Gmail and a durable worker exist)
- `GET /api/campaigns`
- `GET /api/campaigns/{id}`
- `GET /api/analytics`
- `GET` / `PUT /api/profile`
- `GET /api/activity`

## Tests and checks

```powershell
cd backend
pip install -r requirements.txt
pytest
```

```powershell
cd frontend
npm install
npm run lint
npm run build
```

## Security notes

The API validates Supabase JWT signatures against the project's Auth JWKS endpoint, and rejects unauthenticated requests. Frontend Supabase keys use the public publishable/anon key only. Keep database and provider credentials server-side. Account ownership is checked for campaigns and campaign activity; public job posting cache and the global opt-out list are shared server records. Review Supabase and database policies, deployment secrets, data retention, provider terms, and applicable outreach/privacy rules before using real contact data.
