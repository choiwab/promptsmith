# Promptsmith PRD - Hackathon Image Eval Pipeline (10-Hour Build)

Document status: Hackathon build spec v2  
Last updated: 2026-02-28  
Owner: Promptsmith Product + Engineering  
Delivery target: Demo-ready prototype in one 10-hour sprint

## 0. Executive Summary

Build a working end-to-end image prompt evaluation loop in 10 hours:
1. User enters one base prompt and objective.
2. System generates `N` prompt variants and images.
3. System auto-scores each image with a vision rubric.
4. UI returns ranked results and concrete next-prompt suggestions.

This is a hackathon build: high quality in product clarity and UX, intentionally limited in platform depth.

## 1. Hackathon Constraints

Hard constraints:
- Total implementation time: 10 hours.
- Single environment: local/demo environment only.
- Single-user or small internal demo usage.

Explicitly out for this PRD:
- QA/testing plans.
- Rollout plans.
- Production hardening (SLO enforcement, on-call, enterprise IAM, full security review).

Quality bar for this hackathon:
- Deterministic API response shapes.
- Clear error/degraded states instead of silent failures.
- Useful and specific prompt suggestions (not generic filler).
- Smooth controls and fast interaction loops in UI.

## 2. Problem and Demo Outcome

Current pain:
- Prompt iteration is manual and slow.
- Users lack structured, repeatable feedback on image quality.
- Next-step prompt edits are guesswork.

Demo outcome:
- One run produces a ranked visual leaderboard and next prompt options in under 2 minutes.
- User can pick a winner and immediately launch a follow-up run with one click.

## 3. Goals and Non-Goals

### 3.1 Goals (Must ship in 10 hours)

- Create an eval run from `base_prompt`, objective, model, and `N` variants.
- Generate `N` variants and `N` images (default `N=6`, max `N=8`).
- Score all images with a structured rubric.
- Return leaderboard with top-3 callouts and short rationales.
- Generate 3 prompt suggestions: `conservative`, `balanced`, `aggressive`.
- Show all of this in one seamless frontend flow with minimal clicks.

### 3.2 Nice-to-have (Only if ahead of schedule)

- Human winner override.
- One-click "Run next round from selected suggestion".
- Per-run cost estimate shown before launch.

### 3.3 Non-Goals (Cut to keep within 10 hours)

- Daily budget policy engine and enforcement.
- Batch/offline backfill processing.
- Multi-project tenancy and role management.
- Full audit/event framework.
- QA automation and rollout orchestration.

## 4. End-to-End User Flow (Hackathon)

1. User opens eval panel.
2. User enters base prompt and picks objective preset.
3. User optionally edits advanced controls.
4. User clicks `Run Eval`.
5. UI shows progress stages: `Planning -> Generating -> Evaluating -> Ranking -> Suggestions`.
6. UI renders ranked cards with scores and rationale.
7. User picks a top variant or suggestion and starts next round.

Target interaction: <= 3 required clicks from prompt entry to results.

## 5. Seamless Controls and UX Strategy

### 5.1 Control model (fast by default)

- Keep only 4 primary controls always visible:
- `Base prompt` (textarea)
- `Objective preset` (segmented control: `Adherence`, `Aesthetic`, `Product`)
- `Variant count` (`4`, `6`, `8`)
- `Run Eval` button

- Place advanced controls in a collapsible "Fine-tune" drawer:
- model selector
- quality selector
- must-include/must-avoid tags
- random seed lock

### 5.2 Smooth interaction details

- Smart defaults prefilled on load (objective `Adherence`, `N=6`, medium quality).
- Inline examples under the prompt box to reduce blank-page friction.
- Disable impossible states (`Run Eval` disabled only when prompt is too short or request in-flight).
- Keep advanced drawer state sticky per session.
- Keyboard-first flow:
- `Cmd/Ctrl + Enter` to run
- arrow keys to move across ranked cards
- `1/2/3` to apply top suggestion

### 5.3 Result UX that feels fast

- Show staged progress with estimated time remaining per stage.
- Render skeleton cards immediately so layout does not jump.
- Stream results in batches when possible (images first, scores next, suggestions last).
- Pin top-3 cards with visual badges and score deltas.
- Add one sticky action bar at bottom:
- `Use winner as next prompt`
- `Try balanced suggestion`
- `Re-run with same settings`

### 5.4 Friction-reduction ideas for hackathon polish

- Auto-scroll to first completed result when generation ends.
- Persist last prompt and controls locally so refresh does not lose context.
- Offer "Quick rerun" chip that bumps only seed while keeping everything else fixed.
- Show concise reason chips on each card (`good composition`, `style drift`, `artifact risk`) instead of long paragraphs.

## 6. Functional Requirements (Hackathon v1)

### FR-1: Eval Run Creation

Input fields:
- `project_id` (default `default`)
- `base_prompt`
- `objective_preset`
- `image_model` (default `gpt-image-1-mini`)
- `n_variants` (4/6/8)
- `quality` (`low|medium|high`)
- optional `must_include[]`, `must_avoid[]`

### FR-2: Variant Planning

- Generate `N` variants with explicit mutation tags.
- Ensure variants are meaningfully different.
- Return compact JSON for deterministic downstream execution.

### FR-3: Image Generation

- Generate one image per variant with capped concurrency (`max 4`).
- Retry transient failures once.
- Store image URL/path, latency, and model metadata.

### FR-4: Vision Evaluation

Rubric per image:
- `prompt_adherence`
- `subject_fidelity`
- `composition_quality`
- `style_coherence`
- `technical_artifact_penalty`
- `confidence`
- `strength_tags[]`
- `failure_tags[]`
- `rationale`

### FR-5: Ranking

Composite score:
- `0.35*prompt_adherence + 0.20*subject_fidelity + 0.20*composition_quality + 0.15*style_coherence - 0.10*technical_artifact_penalty`

Tie-breakers:
1. Higher `confidence`
2. Lower `technical_artifact_penalty`
3. Fewer hard-rule violations

### FR-6: Prompt Suggestions

Return:
- `conservative`
- `balanced`
- `aggressive`

Each suggestion must cite at least one failure/strength tag from results.

### FR-7: Graceful Degraded Mode

- If one variant fails generation/eval, complete run with remaining variants.
- Surface partial-failure note in response and UI.

## 7. Technical Approach (OpenAI-First, Hackathon-Sized)

### 7.1 Reuse-first implementation

- Backend: existing FastAPI service in this repo.
- Frontend: existing React/Zustand app in this repo.
- Persistence: existing repository path (JSON or Supabase mirror, whichever current setup already uses).

### 7.2 Model calls

- Variant planner: `POST /v1/responses` (low-cost text model).
- Image generation: OpenAI image API (`gpt-image-1-mini` default).
- Vision judge: `POST /v1/responses` with image input + JSON schema output.
- Refiner: `POST /v1/responses` from run summary.

### 7.3 New backend surface

- `POST /eval-runs` starts orchestration and returns full run payload.
- `GET /eval-runs/{run_id}` fetches run status/results.
- Optional: `POST /eval-runs/{run_id}/select` stores human winner.

## 8. API Contract (Hackathon)

### 8.1 `POST /eval-runs`

Request:
```json
{
  "project_id": "default",
  "base_prompt": "cinematic portrait of an astronaut chef in a neon diner",
  "objective_preset": "adherence",
  "image_model": "gpt-image-1-mini",
  "n_variants": 6,
  "quality": "medium",
  "constraints": {
    "must_include": ["astronaut suit details", "food prep action"],
    "must_avoid": ["text watermark", "extra limbs"]
  }
}
```

Response (shape):
```json
{
  "run_id": "eval_20260228_001",
  "status": "completed",
  "leaderboard": [],
  "top_k": [],
  "suggestions": {
    "conservative": "",
    "balanced": "",
    "aggressive": ""
  },
  "degraded": false
}
```

### 8.2 `GET /eval-runs/{run_id}`

- Returns run status and final artifacts.

## 9. Minimal Data Model

### `eval_runs`

- `run_id`
- `project_id`
- `base_prompt`
- `objective_preset`
- `image_model`
- `n_variants`
- `quality`
- `status`
- `created_at`
- `completed_at`
- `degraded`

### `eval_variants`

- `variant_id`
- `run_id`
- `variant_prompt`
- `mutation_tags`
- `image_url`
- rubric fields
- `composite_score`
- `rank`

### `eval_suggestions`

- `run_id`
- `type` (`conservative|balanced|aggressive`)
- `prompt_text`
- `rationale`

## 10. 10-Hour Implementation Plan

1. Hour 0.0-0.5: finalize rubric schema, response contracts, and prompt templates.
2. Hour 0.5-2.0: add backend `eval-runs` route + run state model.
3. Hour 2.0-4.0: implement variant planning + image fan-out with concurrency cap.
4. Hour 4.0-5.5: implement vision scoring + ranking logic + tie-breakers.
5. Hour 5.5-6.5: implement suggestion generation (`conservative|balanced|aggressive`).
6. Hour 6.5-8.5: implement frontend controls, progress stages, leaderboard cards, sticky actions.
7. Hour 8.5-9.5: polish UX details (keyboard shortcuts, state persistence, reduced-click flows).
8. Hour 9.5-10.0: demo prep, sample prompts, and fallback handling sweep.

## 11. De-Scoping Triggers (If Time Slips)

1. Drop human winner persistence endpoint.
2. Reduce variants from 8 max to 6 max.
3. Skip per-run cost estimate UI.
4. Remove advanced controls drawer and keep only primary controls.

Core loop must still remain intact: `prompt -> variants/images -> scoring -> ranking -> suggestions`.

## 12. Hackathon Success Criteria

- End-to-end run completes and renders leaderboard plus 3 suggestions.
- UI flow is smooth enough that a user can run round 2 from round 1 result in one click.
- Top result explanation is specific and tied to rubric tags.
- No blocking errors during a live demo run with default settings.

## 13. Post-Hackathon Backlog (Deferred Intentionally)

- QA automation and regression suites.
- Production rollout and observability expansion.
- Budget policy engine and daily spend controls.
- Multi-tenant auth and permissioning.
- Batch evaluation and larger-scale offline jobs.
