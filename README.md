# Promptsmith Frontend Demo

Track B frontend implementation for Promptsmith.

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
