# Promptsmith Backend Handoff (Track A)

## Startup
- Create venv + install deps: `pnpm backend:setup`
- Start API: `pnpm dev:backend`
- Health check: `curl http://localhost:8000/health`

## Required pnpm scripts
- `pnpm dev:backend`
- `pnpm backend:setup`
- `pnpm backend:seed`
- `pnpm backend:openapi`
- `pnpm lint:backend`

## OpenAPI
- Export schema: `pnpm backend:openapi`
- Output file: `backend/openapi.json`

## Seed Data
- Generate deterministic demo assets and JSON data: `pnpm backend:seed`
- Seed project: `default`
- Seed commits: `c0001`, `c0002`, `c0003`
- Seed reports: `r0001`, `r0002`

## Example curl calls

### POST /generate
```bash
curl -X POST http://localhost:8000/generate \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "default",
    "prompt": "cinematic portrait of hero character",
    "model": "gpt-image-1",
    "seed": "1234"
  }'
```

### POST /baseline
```bash
curl -X POST http://localhost:8000/baseline \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "default",
    "commit_id": "c0001"
  }'
```

### GET /history
```bash
curl "http://localhost:8000/history?project_id=default&limit=20"
```

### POST /compare
```bash
curl -X POST http://localhost:8000/compare \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "default",
    "candidate_commit_id": "c0003"
  }'
```

## Error code catalog
- `INVALID_REQUEST`: payload/query validation failed.
- `PROJECT_NOT_FOUND`: `project_id` does not exist.
- `COMMIT_NOT_FOUND`: commit missing, belongs to another project, or has no usable artifact.
- `BASELINE_NOT_SET`: compare called before baseline selection.
- `OPENAI_TIMEOUT`: upstream OpenAI call timed out.
- `OPENAI_UPSTREAM_ERROR`: upstream OpenAI returned an error or invalid output.
- `STORAGE_WRITE_FAILED`: atomic persistence operation failed.
- `COMPARE_PIPELINE_FAILED`: compare pipeline failure (e.g. pixel analysis or missing artifacts).
