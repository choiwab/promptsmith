# Promptsmith Image Eval Pipeline: Implementation Guide

This document explains how the image eval pipeline works in the current codebase, from UI action to backend completion.

Scope:
- Frontend modal flow and state handling
- Eval API contract
- Backend async pipeline stages
- Scoring, ranking, and suggestion generation
- Lineage behavior and persistence model
- Failure/degraded behavior and operational limits

Current behavior in this repository (as implemented now):
- `n_variants` is restricted to `2` or `3` (default `3`).
- Eval runs are held in backend memory (not persisted to Supabase).
- Generated commits/images are persisted to Supabase.

## 1. High-Level Architecture

Core components:
- Frontend eval UI: `frontend/src/features/eval-workbench/EvalWorkbench.tsx`
- Frontend state/polling: `frontend/src/state/store.ts` (`runEvalPipeline`)
- API client: `frontend/src/api/client.ts`
- Eval HTTP routes: `backend/app/api/routes_eval_runs.py`
- Eval orchestration service: `backend/app/services/eval_pipeline_service.py`
- Commit/project persistence: `backend/app/storage/repository.py` and `backend/app/storage/supabase_mirror.py`

The pipeline is asynchronous:
1. Frontend sends `POST /eval-runs`.
2. Backend creates a run object immediately and returns it in `queued` state.
3. Backend starts background task to execute stages.
4. Frontend polls `GET /eval-runs/{run_id}` until terminal state.

## 2. End-to-End Runtime Flow

### 2.1 User Entry Points

A user can open Eval Workbench from:
- Commit Info modal (`Run Eval` action)
- Lineage graph node action

The selected commit can become an anchor/parent for eval lineage.

### 2.2 Frontend Control Inputs

Eval Workbench captures:
- `base_prompt` (min length 5)
- `objective_preset`: `adherence | aesthetic | product`
- `variantCount`: `2 | 3`

Fixed defaults in UI:
- `image_model = "gpt-image-1-mini"`
- `quality = "medium"`
- `constraints.must_include = []`
- `constraints.must_avoid = []`

### 2.3 Request Submit

Frontend builds payload and calls `runEvalPipeline(payload)`:

```json
{
  "project_id": "my-project",
  "base_prompt": "cinematic portrait of an astronaut chef in a neon diner",
  "objective_preset": "adherence",
  "image_model": "gpt-image-1-mini",
  "n_variants": 3,
  "quality": "medium",
  "parent_commit_id": "c123...", 
  "constraints": {
    "must_include": [],
    "must_avoid": []
  }
}
```

`parent_commit_id` is chosen from UI context:
- First run from anchored modal: anchor commit
- Suggestion reruns and re-run actions: prefer top variant commit, then run anchor, then modal anchor

### 2.4 Backend Stage Execution

Backend stages:
1. `planning`
2. `generating`
3. `evaluating`
4. `refining`
5. terminal: `completed` or `completed_degraded` or `failed`

Each stage updates `run.stage` and `run.status`.

### 2.5 Frontend Polling

Frontend polling behavior:
- Interval: `1200ms`
- Max attempts: `90` (about 108 seconds)
- Terminal statuses: `completed`, `completed_degraded`, `failed`

If still non-terminal after max attempts:
- UI marks request success
- Toast indicates run still in background
- User can re-open and poll again later

## 3. API Contract

### 3.1 Create Eval Run

Endpoint:
- `POST /eval-runs`

Validation:
- `project_id`: non-empty
- `base_prompt`: min length 5
- `objective_preset`: `adherence | aesthetic | product`
- `image_model`: non-empty, default `gpt-image-1-mini`
- `n_variants`: `2..3`, default `3`
- `quality`: `low | medium | high`, default `medium`

### 3.2 Get Eval Run

Endpoint:
- `GET /eval-runs/{run_id}`

Returns full run state including:
- progress counters
- per-variant records
- ranked leaderboard
- top_k IDs
- suggestions
- timestamps and terminal error (if any)

### 3.3 Run Response Shape (Important Fields)

Top-level:
- `run_id`, `project_id`
- `base_prompt`, `objective_preset`, `image_model`, `n_variants`, `quality`
- `parent_commit_id`, `anchor_commit_id`
- `status`, `stage`, `degraded`, `error`
- `progress`: `total_variants`, `generated_variants`, `evaluated_variants`, `failed_variants`
- `variants[]`
- `leaderboard[]`
- `top_k[]`
- `suggestions`: `conservative`, `balanced`, `aggressive`
- `created_at`, `updated_at`, `completed_at`

Variant fields include:
- identity and prompt (`variant_id`, `variant_prompt`, `mutation_tags`)
- lineage (`parent_commit_id`, `commit_id`, `image_url`)
- timing (`generation_latency_ms`, `judge_latency_ms`)
- rubric metrics and score
- tags (`strength_tags`, `failure_tags`)
- state (`status`, `rank`, `error`)

## 4. Backend Pipeline Internals

### 4.1 Run Creation and In-Memory Storage

When `create_run(...)` is called:
- Ensures project exists (`repository.ensure_project`)
- Validates provided parent commit (must be `success` and contain image artifacts)
- Creates run object in `self._runs` (in-memory dict)
- Schedules background task with `asyncio.create_task(self._execute_run(run_id))`

Concurrency safety:
- A `threading.Lock` guards in-memory run mutations.

Persistence note:
- Eval run objects are not persisted to Supabase.
- A backend restart loses active and historical eval run state.

### 4.2 Stage: Planning Variants

Primary strategy:
- Calls OpenAI Responses API (text model) with strict JSON contract:
  - expected: `{"variants":[{"variant_prompt":"...","mutation_tags":["..."]}]}`

Fallback strategy:
- Deterministic template mutations (`composition`, `lighting`, `lens`, etc.)
- Includes `must_include` and `must_avoid` text in prompt if provided

Output:
- Initializes `v01`, `v02`, `v03` style variant records (depending on count)
- Initial variant status is `planned`

### 4.3 Stage: Generating Images

Anchor resolution:
- If `parent_commit_id` exists:
  - fetch commit image and use it as edit base
  - `anchor_commit_id = parent_commit_id`
- If no parent:
  - generate a new anchor image from `base_prompt`
  - persist anchor as new root commit
  - set `anchor_commit_id` to that commit

Per-variant image generation:
- Uses semaphore concurrency cap `4`
- In the eval pipeline path, variants are generated as edits of the resolved anchor image (`/v1/images/edits`)
- Persists each successful variant as a commit with:
  - `parent_commit_id = anchor_commit_id`
  - uploaded image URL

Generation failure handling:
- Variant status -> `generation_failed`
- Failure commit persisted with `status=failed` and no images
- Run marked `degraded=true`
- Progress increments still move forward

### 4.4 Stage: Evaluating Images

For each variant with image bytes:
- Uses OpenAI Responses API vision model
- Sends prompt context + image (as data URL)
- Expects JSON rubric:
  - `prompt_adherence`
  - `subject_fidelity`
  - `composition_quality`
  - `style_coherence`
  - `technical_artifact_penalty`
  - `confidence`
  - `failure_tags`
  - `strength_tags`
  - `rationale`

Semaphore concurrency cap:
- `4` evaluations in parallel

Evaluation outcomes:
- Success:
  - variant status -> `evaluated`
  - compute `composite_score`
- Exception:
  - run marked degraded
  - neutral fallback rubric applied
  - variant status -> `evaluated_degraded`
  - score still computed so ranking can continue

If variant image was missing:
- variant status -> `evaluation_skipped`

### 4.5 Composite Score Formula

```text
score =
  0.35 * prompt_adherence
  + 0.20 * subject_fidelity
  + 0.20 * composition_quality
  + 0.15 * style_coherence
  - 0.10 * technical_artifact_penalty
```

Score is rounded to 4 decimals.

### 4.6 Ranking Logic

Only variants with status in `{evaluated, evaluated_degraded}` are ranked.

Sort key (descending):
1. `composite_score`
2. `confidence`
3. lower artifact penalty favored (`-technical_artifact_penalty` in key)
4. fewer hard-rule violations favored

Hard-rule violation counter increments when a failure tag contains:
- `artifact`
- `watermark`
- `limb`

Post-sort:
- assign `rank` 1..N
- set `top_k` to first up to 3 `variant_id`s

With `n_variants=2`, `top_k` can have 2 entries.

### 4.7 Stage: Refining Suggestions

Primary strategy:
- Uses text model with JSON contract for three suggestions:
  - `conservative`
  - `balanced`
  - `aggressive`

Input summary includes:
- top variants (up to 3)
- bottom variants (last 2 when available)

Fallback suggestions:
- conservative: reuse top prompt
- balanced: keep top prompt + targeted clarity/fidelity fix
- aggressive: high-variance rewrite keeping core subject

### 4.8 Terminalization

Run end behavior:
- if `degraded=false` -> `completed`
- if `degraded=true` -> `completed_degraded`
- on unhandled pipeline errors -> `failed` with error message

## 5. Frontend Behavior in Detail

### 5.1 Progress and Stage Messaging

Displayed stage messages:
- `queued`: queued text
- `planning`: planning variants
- `generating`: generating images
- `evaluating`: scoring images
- `refining`: drafting suggestions
- terminal messages for completion/failure

Progress bar is synthetic and stage-aware:
- planning: fixed 10%
- generating: 15% + generated/total * 35%
- evaluating: 50% + evaluated/total * 35%
- refining: 92%
- terminal: 100%

### 5.2 Keyboard Shortcuts

Supported keys:
- `Cmd/Ctrl + Enter`: run eval
- `1`, `2`, `3`: apply conservative/balanced/aggressive suggestion text to prompt field
- `ArrowLeft`, `ArrowRight`: move focused leaderboard card

Typing safety:
- Shortcut handler ignores key shortcuts when focus is in inputs/textareas/contenteditable (except submit combo).

### 5.3 Suggestion Actions

For each suggestion card:
- `Use as Prompt`: copies suggestion prompt into base prompt field
- `Run Now`: immediately runs eval with that prompt and lineage parent branching

Sticky actions:
- Use winner as next prompt
- Try balanced suggestion
- Re-run same settings with branch parent preference

## 6. Lineage and Persistence Model

Persisted entities:
- Projects (`promptsmith_projects`)
- Commits (`promptsmith_commits`)
- Comparisons (`promptsmith_comparisons`)
- Images in Supabase Storage bucket (default `promptsmith-images`)

Not persisted:
- Eval run objects (`_runs` map in service memory)

Lineage behavior for eval:
- Anchor commit is either existing parent commit or newly generated anchor
- Each successful variant is stored as a child commit of anchor
- This creates a branch-like structure in history/lineage graph

## 7. Degraded Mode Semantics

Run is marked `degraded=true` when any non-fatal stage-level fallback happens, including:
- one or more generation failures
- one or more evaluation failures using fallback rubric

Degraded runs still complete with useful outputs if enough data exists.

Terminal degraded status:
- `completed_degraded`

UI treatment:
- status chip shows `degraded`
- toast is informational instead of full success

## 8. Error Handling and Timeouts

Backend:
- Known operational errors use structured `ApiError` with `ErrorCode`
- Validation errors return `INVALID_REQUEST` (422)
- OpenAI timeouts map to `OPENAI_TIMEOUT`
- Storage failures map to `STORAGE_WRITE_FAILED`

Frontend:
- API layer throws `ApiClientError` with retryability
- `AbortError` becomes `REQUEST_TIMEOUT` (retryable)
- fetch/connect failures become `API_UNAVAILABLE` (retryable)

Polling timeout:
- Frontend stops polling after ~108s and reports run still active in background.

## 9. Concurrency, Throughput, and Cost-Related Behaviors

Concurrency caps:
- Generation: 4 parallel workers
- Evaluation: 4 parallel workers

Per eval run cost drivers:
- 1 anchor generation when no parent commit is supplied
- `n_variants` image edits/generations
- `n_variants` vision evaluations
- 1 text call for variant planning
- 1 text call for suggestion generation

With current `n_variants` max 3:
- worst-case per run is bounded and lower than previous larger variant counts.

## 10. Operational Caveats

1. Eval run state is volatile.
- Restarting backend loses `run_id` state and polling result continuity.

2. No explicit cancel endpoint.
- Once scheduled, run executes until terminal state or process interruption.

3. No hard global queue control.
- Multiple users/runs can schedule concurrently; each run has internal stage semaphores.

4. Global exception handler code is compare-oriented.
- Unexpected exceptions map to `COMPARE_PIPELINE_FAILED` message in global handler.

## 11. Minimal Manual Verification Checklist

1. Open Eval Workbench from a selected commit.
2. Run eval with `n_variants=2`.
3. Confirm stage transitions: `queued -> planning -> generating -> evaluating -> refining -> completed*`.
4. Verify `leaderboard` and `top_k` populate.
5. Verify 3 suggestions are returned and usable.
6. Trigger `Run Now` from a suggestion and confirm branch lineage uses prior winner/anchor.
7. Confirm new variant commits appear in history graph as children of anchor commit.
8. Validate degraded behavior by simulating upstream failure and ensuring `completed_degraded` still returns.

## 12. Relevant Source Files

Frontend:
- `frontend/src/features/eval-workbench/EvalWorkbench.tsx`
- `frontend/src/state/store.ts`
- `frontend/src/api/client.ts`
- `frontend/src/api/mappers.ts`
- `frontend/src/api/types.ts`
- `frontend/src/app/App.tsx`

Backend:
- `backend/app/api/routes_eval_runs.py`
- `backend/app/services/eval_pipeline_service.py`
- `backend/app/main.py`
- `backend/app/core/config.py`
- `backend/app/core/errors.py`
- `backend/app/storage/repository.py`
- `backend/app/storage/supabase_mirror.py`
- `backend/supabase/schema.sql`
