# Promptsmith Frontend Demo

Track B frontend implementation for Promptsmith.

## Run With Docker (One Command)
1. Copy Docker env template:
```bash
cp .env.docker.example .env
```
2. (Optional) Set `OPENAI_API_KEY` in `.env` if you want `/generate` to call OpenAI.
3. Start everything:
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

## Scripts
- `pnpm dev:frontend` - Run Vite frontend dev server
- `pnpm dev` - Alias for `pnpm dev:frontend`
- `pnpm build` - Type-check and build frontend
- `pnpm lint:frontend` - Run lint checks
- `pnpm test:frontend` - Run Vitest suite
