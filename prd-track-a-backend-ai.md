# Promptsmith PRD - Track A (Backend + AI Engine)

Document status: Split PRD v2 (execution-ready)
Last updated: 2026-02-28
Owner: Engineer A
Timebox: 10 hours

## 0. One-Page Summary
Engineer A owns all backend and AI pipeline work required for Promptsmith MVP.
Deliver a stable API that supports generation, baseline management, history retrieval, and regression comparison with explainable scoring.
Track A must be independently executable and consumable by Track B without schema changes.

## 1. Development Standard (pnpm)
All project commands are run through `pnpm` from repo root.

### Required scripts (must exist)
- `pnpm install`
- `pnpm dev:backend` - start FastAPI server on `http://localhost:8000`
- `pnpm backend:seed` - seed demo data and example artifacts
- `pnpm backend:openapi` - export OpenAPI JSON used by Track B
- `pnpm lint:backend` - backend lint/type checks

### Runtime assumptions
- Backend code can remain Python/FastAPI.
- `pnpm` is the orchestration layer for local workflow and handoff consistency.

### Script command mapping
- `pnpm dev:backend` -> starts backend server with hot reload on port `8000`.
- `pnpm backend:seed` -> runs seed script to create demo project, 3 commits, and 2 comparison reports.
- `pnpm backend:openapi` -> writes OpenAPI schema to `backend/openapi.json`.
- `pnpm lint:backend` -> runs backend lint and static checks.

### Required environment variables
- `OPENAI_API_KEY` (required)
- `OPENAI_IMAGE_MODEL` (default `gpt-image-1`)
- `OPENAI_VISION_MODEL` (vision-capable model id)
- `APP_DATA_DIR` (default `./data`)
- `APP_IMAGE_DIR` (default `./images`)
- `APP_ARTIFACT_DIR` (default `./artifacts`)
- `APP_COMPARE_THRESHOLD` (default `0.30`)

## 2. Ownership Boundary (No Overlap)

### Engineer A owns
- Backend folder structure and Python services.
- OpenAI API integration and all AI calls.
- Data persistence format and migration handling for MVP.
- Endpoint request/response validation.
- Drift computation and verdict logic.
- Logging, backend error model, and degraded behavior.

### Engineer A must not do
- React component implementation.
- Frontend layout/styling changes.
- Frontend state management choices.
- Demo slide design and presentation visuals.

## 3. Inputs, Outputs, And Handoff Contract

### Inputs from Track B
- UI integration feedback only (bug reports and payload mismatches).

### Outputs to Track B (required)
- Running API at `http://localhost:8000`.
- Frozen OpenAPI file (`openapi.json`).
- Seed dataset with predictable IDs and assets.
- Error code catalog.

### API freeze rule
- Freeze API schema no later than end of Hour 8.
- After freeze, only backward-compatible additions are allowed.

## 4. Required Services, Access, And Tooling

### Required services/accounts
- OpenAI API with active billing and accessible image + vision models.
- Git repository write access for branch and PR workflow.

### Required local tooling
- Node.js 20+
- `pnpm` 9+
- Python 3.11+
- `uv` or `pip` for Python dependency install
- Writable local filesystem for `data/`, `images/`, `artifacts/`

### Optional free services
- Render Free backend deployment (backup only; cold starts expected)

## 5. Repository Structure And File Ownership
Track A must create and maintain these backend files and only these areas are owned by A.

```text
backend/
  app/
    main.py
    api/
      routes_generate.py
      routes_baseline.py
      routes_compare.py
      routes_history.py
    core/
      config.py
      logging.py
      errors.py
    services/
      generation_service.py
      compare_orchestrator.py
      pixel_metrics.py
      semantic_metrics.py
      vision_evaluator.py
      scoring.py
    storage/
      repository.py
      file_store.py
      id_factory.py
      schemas.py
  tests/ (optional if time remains)
```

Track A must not modify frontend code except for API URL config placeholders if explicitly requested by Track B.

## 6. Functional Deliverables

### D1. Generation and commit creation
- Endpoint: `POST /generate`
- Generate one image per call for MVP speed and deterministic UI behavior.
- Persist commit metadata and image file path.

### D2. Baseline management
- Endpoint: `POST /baseline`
- Maintain one active baseline per project.

### D3. History retrieval
- Endpoint: `GET /history`
- Return newest-first commits with cursor pagination.

### D4. Compare and scoring
- Endpoint: `POST /compare`
- Run three signals in parallel:
- pixel difference
- semantic similarity
- vision structural drift
- Return weighted drift score, verdict, explanation, and artifact links.

### D5. Error model and degraded mode
- Standard error envelope for all failures.
- `degraded=true` when one or more sub-signals fail.
- `inconclusive` verdict when required semantic/vision signals are unavailable and pixel evidence is not extreme.

## 7. Locked API Contract

### 7.1 `POST /generate`
Request:
```json
{
  "project_id": "default",
  "prompt": "cinematic portrait of hero character",
  "model": "gpt-image-1",
  "seed": "1234"
}
```
Validation rules:
- `project_id`: required, non-empty string.
- `prompt`: required, min length 5.
- `model`: required string.
- `seed`: optional string.

Success response (`200`):
```json
{
  "commit_id": "c0007",
  "status": "success",
  "image_paths": ["images/c0007/img_01.png"],
  "created_at": "2026-02-28T18:10:12Z"
}
```

### 7.2 `POST /baseline`
Request:
```json
{
  "project_id": "default",
  "commit_id": "c0003"
}
```
Success response (`200`):
```json
{
  "project_id": "default",
  "active_baseline_commit_id": "c0003",
  "updated_at": "2026-02-28T18:11:00Z"
}
```

### 7.3 `POST /compare`
Request:
```json
{
  "project_id": "default",
  "candidate_commit_id": "c0007"
}
```
Success response (`200`):
```json
{
  "report_id": "r0012",
  "baseline_commit_id": "c0003",
  "candidate_commit_id": "c0007",
  "scores": {
    "pixel_diff_score": 0.22,
    "semantic_similarity": 0.86,
    "vision_structural_score": 0.31,
    "drift_score": 0.27,
    "threshold": 0.30
  },
  "verdict": "pass",
  "degraded": false,
  "explanation": {
    "facial_structure_changed": false,
    "lighting_shift": "moderate",
    "style_drift": "low",
    "notes": "Lighting changed but identity remained stable"
  },
  "artifacts": {
    "diff_heatmap": "artifacts/r0012/diff_heatmap.png",
    "overlay": "artifacts/r0012/overlay.png"
  }
}
```

### 7.4 `GET /history`
Query:
- `project_id` required
- `limit` optional default `20` max `50`
- `cursor` optional

Success response (`200`):
```json
{
  "items": [
    {
      "commit_id": "c0007",
      "prompt": "...",
      "status": "success",
      "created_at": "2026-02-28T18:10:12Z"
    }
  ],
  "next_cursor": "c0006"
}
```

### 7.5 Error envelope (all non-2xx)
```json
{
  "error": {
    "code": "BASELINE_NOT_SET",
    "message": "Set a baseline before comparing commits.",
    "request_id": "req_abc123"
  }
}
```

### 7.6 Required error codes
- `INVALID_REQUEST`
- `PROJECT_NOT_FOUND`
- `COMMIT_NOT_FOUND`
- `BASELINE_NOT_SET`
- `OPENAI_TIMEOUT`
- `OPENAI_UPSTREAM_ERROR`
- `STORAGE_WRITE_FAILED`
- `COMPARE_PIPELINE_FAILED`

## 8. Data Model And Storage Rules

### 8.1 Entities
1. `Project`
- `project_id`, `name`, `active_baseline_commit_id`, `created_at`, `updated_at`

2. `Commit`
- `commit_id`, `project_id`, `prompt`, `model`, `seed`, `image_paths`, `status`, `error`, `created_at`

3. `ComparisonReport`
- `report_id`, `project_id`, `baseline_commit_id`, `candidate_commit_id`
- `pixel_diff_score`, `semantic_similarity`, `vision_structural_score`
- `drift_score`, `threshold`, `verdict`, `degraded`, `explanation`, `artifacts`, `created_at`

4. `Config`
- `weights`, `threshold`, `image_size`, `max_daily_compares`

### 8.2 ID generation
- Commit IDs: `c0001`, `c0002`, sequential.
- Report IDs: `r0001`, `r0002`, sequential.
- Never reuse IDs even after failures.

### 8.3 Storage layout
```text
project-root/
  data/
    projects.json
    commits.json
    comparisons.json
    config.json
  images/
    c0001/
      img_01.png
  artifacts/
    r0001/
      diff_heatmap.png
      overlay.png
```

### 8.4 Atomic write policy
- Write to temp file in same directory.
- `fsync` temp file.
- Rename temp file to target file.
- On error, preserve previous file and return `STORAGE_WRITE_FAILED`.

## 9. Compare Pipeline Specification

### 9.1 Pixel signal (`pixel_diff_score`)
- Resize baseline and candidate to same dimensions.
- Compute SSIM difference map.
- Compute histogram distance.
- Blend to normalized score in `[0,1]`.
- Emit heatmap artifact.

### 9.2 Semantic signal (`semantic_similarity`)
- Use OpenAI vision-capable model to rate semantic identity similarity.
- Prompt model for strict JSON response with float `0..1`.
- Retry once on invalid JSON.

### 9.3 Vision structural signal (`vision_structural_score`)
- Ask model for structural drift fields and normalized drift score.
- Parse strict JSON fields:
- `facial_structure_changed` boolean
- `lighting_shift` enum
- `style_drift` enum
- `vision_structural_score` float `0..1`

### 9.4 Weighted final score
`drift_score = 0.40*(1-semantic_similarity) + 0.30*pixel_diff_score + 0.30*vision_structural_score`

Verdict rules:
- `pass` if `drift_score <= threshold`
- `fail` if `drift_score > threshold`
- `threshold` default `0.30`

Degraded rules:
- If any sub-signal fails, set `degraded=true`.
- If semantic or vision missing and pixel score `<= 0.70`, set `verdict=inconclusive`.
- If semantic or vision missing and pixel score `> 0.70`, set `verdict=fail`.

## 10. Non-Functional Requirements
- p95 `POST /compare` <= 20s.
- p95 `GET /history` <= 400ms for 1,000 commits.
- No API key leakage to clients.
- Structured logs for every request with `request_id`.
- Deterministic error envelope shape.

## 11. Detailed 10-Hour Execution Plan

### Hour 1
- Scaffold FastAPI app and route files.
- Add config loader and environment variable handling.
- Add `pnpm dev:backend` script.

### Hour 2
- Implement `POST /generate` route and generation service.
- Save generated image to `images/{commit_id}/img_01.png`.
- Save commit metadata in `commits.json`.

### Hour 3
- Implement `POST /baseline` and baseline persistence in `projects.json`.
- Implement `GET /history` with cursor + limit.

### Hour 4
- Implement pixel metrics service and diff heatmap artifact output.
- Validate score normalization bounds.

### Hour 5
- Add semantic metrics service with structured JSON parsing.
- Add invalid JSON retry logic.

### Hour 6
- Add vision evaluator service with structured explanation fields.
- Normalize `vision_structural_score`.

### Hour 7
- Implement compare orchestrator with async parallel fan-out/fan-in.
- Build scoring module and verdict logic.

### Hour 8
- Implement `POST /compare` endpoint end-to-end.
- Freeze API schema and export OpenAPI (`pnpm backend:openapi`).

### Hour 9
- Add required error codes and robust failure mapping.
- Add degraded/inconclusive logic and edge-case handling.

### Hour 10
- Run manual smoke script and produce seed data (`pnpm backend:seed`).
- Prepare handoff notes and sample payload set.

## 12. Integration Checkpoints With Track B
- End of Hour 3: provide working `POST /generate`, `POST /baseline`, `GET /history`.
- End of Hour 6: provide provisional `POST /compare` with placeholder values allowed.
- End of Hour 8: freeze schema and publish `backend/openapi.json`.
- End of Hour 10: provide final seed dataset and curl examples.

## 13. Manual Smoke Checklist (Must Pass)
- `POST /generate` returns commit with image path.
- `POST /baseline` updates active baseline.
- `GET /history` returns newest-first list.
- `POST /compare` returns scores + verdict + explanation + artifacts.
- Compare without baseline returns `BASELINE_NOT_SET`.
- Upstream timeout returns standard error envelope.

## 14. Handoff Package To Track B (Required)
Engineer A must provide all items below before final merge:
- Backend URL and startup command.
- `openapi.json`.
- `data/` seed files with at least 3 commits and 2 reports.
- Sample curl commands for each endpoint.
- Error code catalog and meanings.

## 15. Definition Of Done (Track A)
Track A is done only when all are true:
- All four endpoints function with locked schema.
- Compare pipeline produces all expected fields and artifacts.
- Error responses always follow standard envelope.
- OpenAPI and seed dataset are delivered to Track B.
- No frontend code changes are required to consume API.
