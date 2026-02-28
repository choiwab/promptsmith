# Promptsmith PRD - Automated Image Prompt Eval Pipeline

Document status: Draft v1 (execution-ready)  
Last updated: 2026-02-28  
Owner: Promptsmith Product + Engineering  
Target release: MVP by 2026-04-15, GA by 2026-06-30

## 0. Executive Summary

Promptsmith needs an end-to-end eval loop for image prompting:
1. Take a user prompt for an image model.
2. Generate `N` image variations.
3. Automatically evaluate all outputs with a vision-language model.
4. Suggest concrete prompt improvements for the next iteration.

This PRD defines an OpenAI-first architecture (generation, judging, and rewriting all powered by OpenAI APIs) with low-cost infrastructure defaults (Supabase free tier + Vercel Hobby + optional low-cost backend hosting).

The MVP target is a reliable, explainable ranking pipeline with human-overridable suggestions and strong cost controls.

## 1. Problem Statement

Users currently iterate prompts manually, which is slow and noisy:
- They do not get consistent, structured feedback for why one image is better.
- They cannot quickly compare many prompt variants in one run.
- They lack automated suggestions grounded in actual image outcomes.

Outcome needed:
- Faster time-to-good-prompt.
- More reproducible prompt quality across teams and projects.
- Lower experimentation spend via systematic evaluation.

## 2. Goals and Non-Goals

### 2.1 Goals (MVP)

- Accept a base prompt and run configuration (`N`, model, quality, style objective).
- Generate `N` variant prompts and `N` images.
- Score each image against objective criteria using a VLM rubric.
- Rank results and return top-K with explanations.
- Generate revised prompt suggestions (`conservative`, `balanced`, `aggressive`).
- Persist run history with complete lineage and cost/latency telemetry.
- Provide budget guardrails (hard spend cap per run, per day, per project).

### 2.2 Non-Goals (MVP)

- Training or fine-tuning custom image models.
- Fully autonomous production publishing without human review.
- Real-time streaming ranking updates below 1 second latency.
- Multi-tenant enterprise IAM (SSO/SCIM) in MVP.

## 3. Users and Jobs-To-Be-Done

### Primary users

- Prompt Engineer: optimizes prompts for quality and consistency.
- Creative Director: wants best candidate plus rationale quickly.
- Product Engineer: needs deterministic API and logs for integration.

### Core jobs

- "Given a concept prompt, show me the best-performing variants fast."
- "Tell me exactly what changed and what to adjust in the next prompt."
- "Keep experimentation costs predictable."

## 4. Product Scope

### In scope (MVP)

- Eval run creation, execution, and retrieval APIs.
- Variant generation strategy using LLM prompt mutation templates.
- Image generation and storage.
- Automated VLM grading and weighted scoring.
- Prompt rewrite suggestions.
- Basic web UI hooks for leaderboard + recommendations.

### Out of scope (MVP)

- Video generation evals.
- Audio-conditioned image generation.
- Marketplace/community sharing.

## 5. Functional Requirements

### FR-1: Eval Run Creation

System must create an eval run from:
- `project_id`
- `base_prompt`
- `image_model`
- `N` (default 8, max 24 in MVP)
- `quality` (`low|medium|high`)
- optional constraints (`must_include`, `must_avoid`, style goals)

### FR-2: Prompt Variant Planning

System must generate `N` prompt variants from the base prompt:
- Each variant must include mutation tags (composition, lighting, lens/camera, style detail, negative prompt changes).
- Variants must avoid duplicating each other semantically.
- Planner must return compact JSON for deterministic downstream execution.

### FR-3: Image Generation

System must generate one image per variant:
- Parallel execution with concurrency limits.
- Retry policy: max 1 retry for transient failures.
- Persist generation metadata: model, quality, latency, token usage, cost estimate.

### FR-4: Vision-Language Evaluation

System must evaluate each generated image using a structured rubric:
- Prompt adherence
- Subject fidelity
- Composition quality
- Lighting/style coherence
- Technical artifacts penalty

Each variant gets:
- Scalar scores (`0.0-1.0`)
- Failure/strength tags
- Short rationale
- Confidence score

### FR-5: Ranking and Selection

System must compute composite score and rank all variants:
- Return full leaderboard.
- Mark top-K (default K=3).
- Include tie-breakers (judge confidence, rule violations, consistency).

### FR-6: Prompt Improvement Suggestions

System must produce actionable next prompts:
- `best_next_prompt`
- `conservative`, `balanced`, `aggressive` alternatives
- edit rationale tied to observed failures in top/bottom outputs

### FR-7: Run History and Reproducibility

System must persist full run lineage:
- base prompt, variant prompts, seeds, outputs, scores, suggestions, model versions.
- Re-run with same config must be supported for comparison.

### FR-8: Human Override

User must be able to:
- Select any variant as "human winner" even if not top-ranked.
- Accept or edit suggested prompt before next run.

### FR-9: Budget Guardrails

System must enforce:
- max images per run
- max estimated spend per run
- project daily spend cap
- fail-fast if estimated cost exceeds budget policy

## 6. Non-Functional Requirements

### NFR-1 Reliability

- Run success rate >= 98% (excluding upstream provider outages).
- Partial failures return degraded but usable output.

### NFR-2 Performance

- P50 run completion <= 25s for `N=8`, quality `medium`.
- P95 run completion <= 75s.

### NFR-3 Cost Predictability

- Pre-run cost estimate must be computed and logged.
- Post-run variance between estimated and actual <= 20% for 90% of runs.

### NFR-4 Explainability

- Every ranked item includes machine-readable rubric plus short natural-language rationale.

### NFR-5 Security

- API keys server-side only.
- Signed URLs for private assets.
- Audit trail for run creation and prompt outputs.

## 7. OpenAI-First Technical Approach

### 7.1 Model and API Strategy

Use OpenAI APIs for all AI-heavy steps:

- Variant planner: `POST /v1/responses` with low-cost reasoning model (default `gpt-5-mini`).
- Image generation: OpenAI Image Generation API (`gpt-image-1-mini` for draft, optional `gpt-image-1`/`gpt-image-1.5` for higher fidelity).
- Vision judging: `POST /v1/responses` with image inputs and structured JSON rubric output.
- Prompt refiner: `POST /v1/responses`, consuming run summary + top/bottom exemplars.
- Safety gate: OpenAI Moderations API for user-entered prompt and generated suggestion text.

Use Batch API for non-urgent backfills and large offline evals:
- `POST /v1/batches` over `/v1/responses` to reduce async eval cost by 50%.

Optional quality management:
- OpenAI Evals API to benchmark grader drift and prompt-rewriter quality over time.

### 7.2 Why this is OpenAI-maximized

- One vendor for generation + judging + rewriting reduces integration complexity.
- Shared prompt semantics across planner, judge, refiner improves loop consistency.
- Batch API + cached input tokens provide concrete cost levers.

## 8. System Architecture

### 8.1 Components

- `Eval Orchestrator` (backend service): owns run lifecycle/state machine.
- `Variant Planner Agent` (LLM call): produces `N` variant prompts.
- `Image Generator Agent` (OpenAI image API): creates variant outputs.
- `Vision Judge Agent` (LLM vision call): scores each image.
- `Prompt Refiner Agent` (LLM call): suggests improved prompts.
- `Repository` (Supabase Postgres): run metadata, scores, lineage.
- `Object Storage` (Supabase Storage default): images and artifacts.

### 8.2 State Machine

Run states:
- `queued`
- `planning`
- `generating`
- `evaluating`
- `refining`
- `completed`
- `failed`
- `completed_degraded`

### 8.3 Core Execution Flow

1. User submits run config.
2. Orchestrator estimates cost and validates budget caps.
3. Planner generates `N` prompt variants.
4. Generator creates `N` images in parallel.
5. Judge scores all images (single pass or dual-pass consensus mode).
6. Ranker computes leaderboard.
7. Refiner proposes next prompt set.
8. Persist all artifacts and return response.

## 9. Scoring Framework

### 9.1 Rubric fields per variant

- `prompt_adherence` (0-1)
- `subject_fidelity` (0-1)
- `composition_quality` (0-1)
- `style_coherence` (0-1)
- `technical_artifact_penalty` (0-1, higher is worse)
- `confidence` (0-1)
- `failure_tags[]`
- `strength_tags[]`
- `rationale`

### 9.2 Composite score

Default formula:

`score = 0.35*prompt_adherence + 0.20*subject_fidelity + 0.20*composition_quality + 0.15*style_coherence - 0.10*technical_artifact_penalty`

Tie-breakers:
1. Higher `confidence`
2. Lower `technical_artifact_penalty`
3. Fewer hard-rule violations

### 9.3 Calibration mode

- Support project-level weight overrides.
- Log score contribution per component for transparency.

## 10. API Contract (Proposed)

### 10.1 `POST /eval-runs`

Creates and starts a run.

Request:
```json
{
  "project_id": "default",
  "base_prompt": "cinematic portrait of an astronaut chef in a neon diner",
  "image_model": "gpt-image-1-mini",
  "n_variants": 8,
  "quality": "medium",
  "constraints": {
    "must_include": ["astronaut suit details", "food prep action"],
    "must_avoid": ["text watermark", "extra limbs"]
  },
  "budget_policy": {
    "max_run_usd": 1.50
  }
}
```

### 10.2 `GET /eval-runs/{run_id}`

Returns run status, leaderboard, suggestions, and artifacts.

### 10.3 `POST /eval-runs/{run_id}/next-round`

Starts next run from selected suggestion:
- `selected_suggestion_id` or custom prompt override.

### 10.4 `POST /eval-runs/{run_id}/human-selection`

Stores user-chosen winner and optional feedback tags.

## 11. Data Model (Proposed)

### `eval_runs`

- `run_id` (pk)
- `project_id`
- `base_prompt`
- `image_model`
- `n_variants`
- `quality`
- `status`
- `estimated_cost_usd`
- `actual_cost_usd`
- `created_at`
- `completed_at`

### `eval_variants`

- `variant_id` (pk)
- `run_id` (fk)
- `variant_prompt`
- `mutation_tags` (jsonb)
- `seed`
- `image_url`
- `generation_latency_ms`
- `generation_cost_usd`

### `eval_scores`

- `score_id` (pk)
- `variant_id` (fk)
- rubric fields
- `composite_score`
- `judge_model`
- `judge_latency_ms`
- `judge_cost_usd`

### `eval_suggestions`

- `suggestion_id` (pk)
- `run_id` (fk)
- `type` (`best_next_prompt|conservative|balanced|aggressive`)
- `prompt_text`
- `rationale`

### `eval_events`

- `event_id` (pk)
- `run_id` (fk)
- `event_type`
- `payload` (jsonb)
- `created_at`

## 12. Affordable Infrastructure Plan

### 12.1 Default stack for MVP (lowest operational cost)

- Database + auth + storage: Supabase Free first, then Pro only when limits hit.
- Frontend hosting: Vercel Hobby for internal/demo usage.
- Backend API worker:
  - Local/dev: Docker Compose (existing Promptsmith workflow).
  - Cloud option: Railway Hobby (low entry price) for simple deploy and predictable minimum spend.
  - Alternative: low-cost VM self-hosting when always-on background workers are required.

### 12.2 Storage strategy

- Start with Supabase Storage for simplicity.
- If image volume grows and egress becomes dominant, optionally move generated assets to Cloudflare R2 and keep metadata in Supabase.

### 12.3 Why this is affordable

- Supabase Free includes meaningful quotas for MVP traffic.
- Vercel Hobby is free for low-scale projects.
- Railway Hobby offers a low-cost path for always-on backend progression.
- OpenAI Batch API can cut async scoring/refinement cost in half.

### 12.4 Free/entry-tier snapshot (for planning)

As of 2026-02-28 (verify before production launch):

| Service | Planning baseline |
| --- | --- |
| Supabase Free | Up to 2 active projects, 500 MB database, 1 GB file storage, 5 GB egress, 50k monthly active users, 500k Edge Function invocations/month. |
| Cloudflare R2 Free allowance | 10 GB-month storage, 1M Class A operations/month, 10M Class B operations/month, egress to internet free. |
| Vercel Hobby | $0 entry tier for low-scale/internal usage. |
| Railway Hobby | Usage-based with low entry cost (starts with monthly credit). |

## 13. Cost Model and Budget Guardrails

All numbers below are planning estimates. Actual bill depends on prompt length, image quality, and token usage. Pricing references are from official pages as of 2026-02-28.

### 13.1 Image cost anchors (OpenAI)

For square images, OpenAI indicates approximate output cost:
- low: ~$0.01/image
- medium: ~$0.04/image
- high: ~$0.17/image

### 13.2 Example run estimates

Assume:
- `N=8`
- image quality `medium`
- judge + refiner combined text cost roughly `$0.01-$0.03/run` using low-cost model tier

Then:
- image generation: `8 * $0.04 = $0.32`
- eval + suggestions: `~$0.02`
- total per run: `~$0.34`

Monthly examples:
- 200 runs/month: `~$68`
- 500 runs/month: `~$170`

### 13.3 Guardrail policy defaults

- `max_run_usd`: `1.50`
- `max_daily_project_usd`: `25`
- abort if `estimated_cost_usd > max_run_usd`
- downgrade quality to `low` automatically if policy allows

### 13.4 Cost optimization levers

- Use `gpt-image-1-mini` during exploration rounds.
- Use `medium` quality by default, `high` only for finalist generation.
- Enable prompt caching where supported.
- Use Batch API for overnight bulk evaluations.
- Early-stop run when top score exceeds threshold and margin is high.

## 14. Observability and QA

### 14.1 Metrics

- Run completion rate
- P50/P95 run latency
- Cost per run and per accepted prompt
- Suggestion acceptance rate
- Human-overridden winner rate
- Judge confidence distribution

### 14.2 Logging

- Structured logs by `run_id` and `variant_id`.
- API usage metadata and token usage per model call.
- Error taxonomy: planning/generation/evaluation/refinement/storage.

### 14.3 QA plan

- Golden prompt set with expected ranking bands.
- Regression tests against fixed seeds where possible.
- Periodic grader drift checks via OpenAI eval workflows.

## 15. Security, Privacy, and Compliance

- Keep OpenAI and service credentials in server-side secrets only.
- No raw secret exposure to frontend.
- Signed URL access for private image artifacts.
- Configurable retention policy for prompts and generated assets.
- Add user warning for sensitive prompt content and content policy violations.

## 16. Rollout Plan

### Phase 0 - Foundation (2026-03-04 to 2026-03-11)

- Data schema, run state machine, cost estimator, API skeleton.

### Phase 1 - MVP Loop (2026-03-12 to 2026-03-26)

- Planner + generator + judge + ranker + refiner end-to-end.
- Basic leaderboard and suggestion payload.

### Phase 2 - Reliability and Cost Controls (2026-03-27 to 2026-04-10)

- Budget guardrails, retries, degraded-mode handling, telemetry dashboards.

### Phase 3 - Beta and Feedback (2026-04-11 to 2026-04-30)

- Human winner override, next-round flow, rubric tuning.

## 17. Success Metrics

### Product metrics

- >= 30% reduction in median iterations to reach an accepted prompt.
- >= 40% of runs reuse at least one suggested prompt in next round.
- >= 70% user-rated usefulness for suggestions.

### Engineering metrics

- >= 98% successful completed or completed_degraded runs.
- <= 5% runs exceed configured budget cap.
- <= 2% malformed JSON outputs from judge/refiner after retry logic.

## 18. Risks and Mitigations

- Risk: VLM judge inconsistency.
  - Mitigation: dual-pass consensus mode + confidence threshold fallback.
- Risk: cost spikes from high image quality defaults.
  - Mitigation: enforce budget policy and model/quality downgrade ladder.
- Risk: prompt suggestions become generic.
  - Mitigation: require suggestions to cite concrete failure tags from bottom variants.
- Risk: free-tier limits reached unexpectedly.
  - Mitigation: daily quota alerts and auto-switch to archival storage strategy.

## 19. Acceptance Criteria (MVP Exit)

- User can run an eval from one API call and receive:
  - `N` generated images
  - ranked leaderboard with per-variant rubric
  - at least 3 prompt improvement suggestions
- All run artifacts are queryable by `run_id`.
- Budget caps are enforced with explicit error responses.
- Degraded outcomes still return partial useful results instead of hard-fail where possible.

## 20. Open Questions

- Should first release include user-defined custom scoring weights in UI, or backend config only?
- Should prompt rewriter optimize for one objective score or multi-objective Pareto front?
- Do we need per-team isolated model allowlists in MVP?

## 21. Source Links (Pricing/Docs Baseline)

Verified on 2026-02-28 unless noted otherwise:

- OpenAI API pricing: https://openai.com/api/pricing/
- OpenAI Image generation guide: https://platform.openai.com/docs/guides/images/image-generation
- OpenAI image generation tool (Responses): https://platform.openai.com/docs/guides/tools-image-generation/
- OpenAI Batch API guide: https://platform.openai.com/docs/guides/batch/
- OpenAI Evals guide: https://platform.openai.com/docs/guides/evals
- Supabase billing and free quotas: https://supabase.com/docs/guides/platform/billing-on-supabase
- Supabase storage pricing: https://supabase.com/docs/guides/storage/pricing
- Vercel Hobby plan: https://vercel.com/docs/plans/hobby
- Vercel pricing overview: https://vercel.com/pricing
- Railway pricing: https://railway.com/pricing
- Railway pricing docs: https://docs.railway.com/pricing
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
