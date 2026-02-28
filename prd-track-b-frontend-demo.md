# Promptsmith PRD - Track B (Frontend + Demo Experience)

Document status: Split PRD v2 (execution-ready)
Last updated: 2026-02-28
Owner: Engineer B
Timebox: 10 hours

## 0. One-Page Summary
Engineer B owns all user-facing implementation for Promptsmith MVP.
Deliver a clear, fast, reliable UI that consumes Track A APIs without requiring backend contract changes.
Track B focuses on workflow clarity: generate -> set baseline -> compare -> explain results.

## 1. Development Standard (pnpm)
All project commands are run through `pnpm` from repo root.

### Required scripts (must exist)
- `pnpm install`
- `pnpm dev:frontend` - start Vite UI
- `pnpm dev` - optional full-stack run when backend is running
- `pnpm build` - production build check for demo readiness
- `pnpm lint:frontend` - lint/type checks

### Runtime assumptions
- Frontend only calls backend APIs.
- Frontend never calls OpenAI directly.
- Frontend never stores server secrets.

### Script command mapping
- `pnpm dev:frontend` -> starts Vite dev server.
- `pnpm dev` -> optional combined dev flow if workspace provides both frontend and backend tasks.
- `pnpm build` -> produces production bundle for final demo validation.
- `pnpm lint:frontend` -> runs lint and type checks.

### Required environment variables
- `VITE_API_BASE_URL` (required, e.g. `http://localhost:8000`)
- `VITE_APP_NAME` (default `Promptsmith`)

## 2. Ownership Boundary (No Overlap)

### Engineer B owns
- React app structure and component architecture.
- API client integration and typed response mapping.
- UI state machine for idle/loading/success/error.
- Compare dashboard and visualization logic.
- Demo flow optimization and runbook.

### Engineer B must not do
- Backend endpoint implementation.
- Backend scoring formula changes.
- JSON persistence schema changes.
- API contract edits after freeze.

## 3. Inputs, Outputs, And Handoff Contract

### Inputs from Track A
- Stable backend URL.
- Frozen OpenAPI schema.
- Seed data with predictable commit/report IDs.
- Error code list.

### Outputs to Track A
- Integration bug list with exact payloads.
- UI feedback on missing fields or schema mismatches.
- Final demo execution checklist.

### API freeze rule
- Track B assumes API freeze by end of Hour 8 of Track A.
- Post-freeze backend changes must remain backward-compatible.

## 4. Required Services, Access, And Tooling

### Required services/access
- Access to Track A backend (`http://localhost:8000` or deployed URL).
- Git repository write access.

### Required local tooling
- Node.js 20+
- `pnpm` 9+
- Modern browser (Chrome/Edge/Safari)

### Optional free services
- Vercel Hobby for static hosting.
- Cloudflare Pages Free for static hosting.

## 5. Repository Structure And File Ownership
Track B must create and maintain these frontend files and only these areas are owned by B.

```text
frontend/
  src/
    app/
      App.tsx
      routes.tsx
    api/
      client.ts
      types.ts
      mappers.ts
    features/
      prompt-workbench/
      history-panel/
      compare-dashboard/
      notifications/
    components/
      Button.tsx
      Badge.tsx
      LoadingState.tsx
      ErrorState.tsx
    state/
      store.ts
      selectors.ts
    styles/
      tokens.css
      layout.css
```

Track B must not edit backend service modules.

## 6. Functional Deliverables

### D1. Prompt Workbench
- Prompt input text area.
- Generate button with pending/loading behavior.
- Success and failure notifications.

### D2. Commit History Panel
- Show commit ID, timestamp, status.
- Highlight active baseline with clear badge.
- Provide `Set Baseline` action on commits.
- Provide `Compare` action on eligible commits.

### D3. Compare Dashboard
- Show baseline image and candidate image side-by-side.
- Show `drift_score`, `threshold`, and verdict badge.
- Show factor scores.
- Show explanation JSON fields in readable layout.
- Show diff artifact image and overlay toggle behavior.

### D4. Robust UI states
- No baseline state.
- Loading state.
- Error state with retry action.
- Inconclusive state with warning badge and explanation.

## 7. Locked API Contract Consumption
Track B must consume endpoints exactly as delivered by Track A.

### Endpoints to integrate
- `POST /generate`
- `POST /baseline`
- `POST /compare`
- `GET /history`

### Response fields that must be rendered
- `commit_id`, `status`, `created_at`
- `scores.pixel_diff_score`
- `scores.semantic_similarity`
- `scores.vision_structural_score`
- `scores.drift_score`
- `scores.threshold`
- `verdict`
- `degraded`
- `explanation.*`
- `artifacts.diff_heatmap`
- `artifacts.overlay`

### Error envelope handling
Any non-2xx response must render:
- `error.code`
- `error.message`
- Retry action where operation is retryable

## 8. UX And Interaction Specification

### Global behavior rules
- Disable action buttons while related request is in-flight.
- Preserve latest successful compare result until replaced.
- Keep selected commit and baseline visible after history refresh.

### Screen behaviors

#### Prompt Workbench
- Submit disabled when prompt is empty.
- On success, history refreshes and new commit is selected.
- On error, show toast with `error.message`.

#### History Panel
- Sorted newest-first.
- Baseline row visually pinned with badge.
- Compare button disabled for baseline commit itself.

#### Compare Dashboard
- If no baseline, render clear instruction state.
- On compare success, render scores and explanation immediately.
- On `degraded=true`, show warning banner.
- On `verdict=inconclusive`, show amber badge and guidance text.

## 9. Error And Edge-Case Matrix

1. API unavailable
- Show full-width error state with retry button.

2. `BASELINE_NOT_SET`
- Show inline guidance: set a baseline from history.

3. Missing artifact image
- Keep score/explanation visible.
- Show placeholder card where image should appear.

4. Slow compare response
- Show spinner and “Analyzing drift…” message.
- Keep previous result visible until new one returns.

5. Empty history
- Show onboarding empty state with first-step instruction.

## 10. Visual And Responsive Requirements
- Desktop layout: 3 columns (workbench, history, compare).
- Mobile layout: stacked sections in order workbench -> history -> compare.
- Verdict badge colors:
- `pass` green
- `fail` red
- `inconclusive` amber
- Ensure contrast and readable typography across breakpoints.

## 11. Detailed 10-Hour Execution Plan

### Hour 1
- Create app shell and route/layout structure.
- Configure API base URL via env.

### Hour 2
- Build typed API client and shared request helpers.
- Add unified error parser for envelope.

### Hour 3
- Implement Prompt Workbench UI and generate action.
- Add loading and toast states.

### Hour 4
- Implement History Panel and history fetch rendering.
- Implement baseline selection action.

### Hour 5
- Implement compare action wiring from history item.
- Add compare request lifecycle state.

### Hour 6
- Implement Compare Dashboard score/verdict panel.
- Render explanation and factor scores.

### Hour 7
- Implement diff/overlay image viewer.
- Add missing-image fallback behavior.

### Hour 8
- Implement no-baseline, API-error, and inconclusive states.
- Tighten disable/enable button rules.

### Hour 9
- Responsive polish and mobile flow fixes.
- Remove UX friction and confusing labels.

### Hour 10
- Full demo rehearsal and timing optimization.
- Prepare final integration issue list (if any).

## 12. Integration Checkpoints With Track A
- End of Hour 2: API client ready and validated against OpenAPI.
- End of Hour 4: history + baseline actions integrated.
- End of Hour 7: compare dashboard integrated with provisional backend output.
- End of Hour 9: all error/inconclusive states validated with real backend errors.

## 13. Manual Smoke Checklist (Must Pass)
- Generate new commit from prompt.
- Set active baseline from history.
- Compare candidate commit and display verdict.
- Render explanation and score breakdown.
- Render diff artifact or fallback placeholder.
- Correct handling of no baseline and API errors.

## 14. Required UI Copy For Critical States
- No baseline: "Set a baseline commit to run regression checks."
- Compare loading: "Analyzing drift across pixel, semantic, and structure signals..."
- Inconclusive: "Result is inconclusive due to partial signal failure. Retry compare."
- API unavailable: "Cannot reach backend. Verify server is running and retry."

## 15. Handoff Package To Track A (Required)
Engineer B must provide:
- Final list of any API contract mismatches with exact payloads.
- UI issue list grouped by severity (blocking, non-blocking).
- Final demo run order with expected screen transitions.

## 16. Definition Of Done (Track B)
Track B is done only when all are true:
- Full flow works: generate -> baseline -> compare.
- All required response fields are rendered in UI.
- Error states are readable and actionable.
- UI remains functional on desktop and mobile layouts.
- No backend contract change is required for final demo.
