# Promptsmith Frontend Demo

Track B frontend implementation for Promptsmith.

## Run With Docker (One Command)
1. Copy Docker env template:
```bash
cp .env.docker.example .env
```
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` (required).
3. (Optional) Set `OPENAI_API_KEY` in `.env` if you want `/generate` to call OpenAI.
4. Start everything:
```bash
docker compose up --build
```
If port `8000` is already in use:
```bash
BACKEND_PORT=8001 docker compose up --build
```

App URLs:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:${BACKEND_PORT:-8000}`

## Requirements
- Node.js 20+
- pnpm 9+

## Setup
```bash
pnpm install
```

## Environment
Copy `frontend/.env.example` to `frontend/.env.local` and set values:

```bash
VITE_API_BASE_URL=http://localhost:8000
VITE_APP_NAME=Promptsmith
```

Backend persistence is Supabase-only (projects, commits, comparisons, image storage).
Set these values in `.env` / Docker env:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_STORAGE_BUCKET=promptsmith-images
SUPABASE_TABLE_PREFIX=promptsmith_
SUPABASE_SCHEMA=public
```

Run `backend/supabase/schema.sql` in Supabase SQL Editor before starting the backend.

## Public Access
- No login is required in this app.
- Backend APIs are open, and the Supabase schema in `backend/supabase/schema.sql` is configured for anonymous full read/write/delete access.
- Anyone with the project URL can view and modify repository data.

## Projects API
Create a project if missing (or load existing):

```bash
curl -X POST http://localhost:8000/projects \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "my-new-project",
    "name": "My New Project"
  }'
```

List projects:

```bash
curl http://localhost:8000/projects
```

## Scripts
- `pnpm dev:frontend` - Run Vite frontend dev server
- `pnpm dev` - Alias for `pnpm dev:frontend`
- `pnpm build` - Type-check and build frontend
- `pnpm lint:frontend` - Run lint checks
- `pnpm test:frontend` - Run Vitest suite
