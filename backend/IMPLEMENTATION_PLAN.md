# Track A Implementation Plan

## Scope lock
- Build backend-only MVP contract from `prd-track-a-backend-ai.md`.
- Keep API schema stable for Track B consumption.

## Execution phases
1. Foundation
- FastAPI app scaffolding, request ID middleware, structured logs.
- Standardized error envelope + required error codes.

2. Persistence
- JSON storage for `projects`, `commits`, `comparisons`, `config`.
- Atomic write strategy: temp file + `fsync` + `rename`.
- Sequential ID reservation for commits/reports.

3. Endpoint implementation
- `POST /generate` (single image generation + commit persistence)
- `POST /baseline` (single active baseline per project)
- `GET /history` (newest-first cursor pagination)
- `POST /compare` (fan-out signal execution + scoring)

4. Compare engine
- Pixel signal: SSIM-inspired diff + histogram distance + heatmap/overlay artifacts.
- Semantic signal: OpenAI vision JSON scoring with retry.
- Vision structural signal: OpenAI vision JSON scoring with retry.
- Weighted drift + verdict + degraded/inconclusive logic.

5. Delivery and handoff
- `pnpm` orchestration scripts.
- OpenAPI exporter (`backend/openapi.json`).
- Deterministic seed generator (3 commits, 2 reports).
- Handoff doc with curl examples and error catalog.

## Risk controls
- If semantic or vision signal fails, `degraded=true` with deterministic fallback behavior.
- If pixel signal fails, compare returns `COMPARE_PIPELINE_FAILED`.
- If `OPENAI_API_KEY` is absent, generate fails with envelope; compare can still return degraded when pixel is available.
