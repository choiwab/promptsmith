import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { useEvalRun, useLastError, useProjectId, useRequestStates } from "../../state/selectors";
import { useAppStore } from "../../state/store";
import type { CreateEvalRunRequest, ObjectivePreset } from "../../api/types";

interface EvalControlState {
  basePrompt: string;
  objectivePreset: ObjectivePreset;
  variantCount: 2 | 3;
}

const STORAGE_KEY = "promptsmith.eval.controls.v1";
const DEFAULT_IMAGE_MODEL = "gpt-image-1-mini";
const DEFAULT_QUALITY = "medium" as const;

const defaultControls: EvalControlState = {
  basePrompt: "",
  objectivePreset: "adherence",
  variantCount: 3
};

const stageMessages: Record<string, string> = {
  queued: "Queued for execution...",
  planning: "Planning variants...",
  generating: "Generating images...",
  evaluating: "Scoring generated images...",
  refining: "Drafting prompt suggestions...",
  completed: "Eval completed.",
  completed_degraded: "Eval completed in degraded mode.",
  failed: "Eval failed."
};

const readControls = (): EvalControlState => {
  if (typeof window === "undefined") {
    return defaultControls;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultControls;
    }
    const parsed = JSON.parse(raw) as Partial<EvalControlState>;
    return {
      ...defaultControls,
      ...parsed,
      variantCount: parsed.variantCount === 2 || parsed.variantCount === 3 ? parsed.variantCount : 3,
      objectivePreset: parsed.objectivePreset === "aesthetic" || parsed.objectivePreset === "product" ? parsed.objectivePreset : "adherence"
    };
  } catch {
    return defaultControls;
  }
};

const toPercent = (value: number): string => `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;

interface EvalWorkbenchProps {
  anchorCommitId?: string;
}

export const EvalWorkbench = ({ anchorCommitId }: EvalWorkbenchProps) => {
  const projectId = useProjectId();
  const requestStates = useRequestStates();
  const evalRun = useEvalRun();
  const lastError = useLastError();
  const runEvalPipeline = useAppStore((state) => state.runEvalPipeline);
  const resolveAssetUrl = useAppStore((state) => state.resolveAssetUrl);

  const [controls, setControls] = useState<EvalControlState>(() => readControls());
  const [focusedCard, setFocusedCard] = useState(0);

  const canRun = useMemo(() => {
    return controls.basePrompt.trim().length >= 5 && requestStates.eval !== "loading";
  }, [controls.basePrompt, requestStates.eval]);

  const suggestions = evalRun?.suggestions;
  const leaderboard = evalRun?.leaderboard ?? [];
  const topVariant = leaderboard[0];

  const progressPercent = useMemo(() => {
    if (!evalRun) {
      return 0;
    }

    const total = Math.max(1, evalRun.progress.total_variants);
    if (evalRun.stage === "planning") {
      return 10;
    }
    if (evalRun.stage === "generating") {
      return 15 + (evalRun.progress.generated_variants / total) * 35;
    }
    if (evalRun.stage === "evaluating") {
      return 50 + (evalRun.progress.evaluated_variants / total) * 35;
    }
    if (evalRun.stage === "refining") {
      return 92;
    }
    if (evalRun.stage === "completed" || evalRun.stage === "completed_degraded" || evalRun.stage === "failed") {
      return 100;
    }
    return 3;
  }, [evalRun]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(controls));
  }, [controls]);

  const applyPrompt = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }
    setControls((prev) => ({ ...prev, basePrompt: trimmed }));
  };

  const runEval = async (options?: { promptOverride?: string; useBranchParent?: boolean }) => {
    const prompt = (options?.promptOverride ?? controls.basePrompt).trim();
    if (prompt.length < 5) {
      return;
    }

    const lineageParentCommitId =
      options?.useBranchParent
        ? topVariant?.commit_id || evalRun?.anchor_commit_id || anchorCommitId || undefined
        : anchorCommitId || undefined;

    const payload: CreateEvalRunRequest = {
      project_id: projectId,
      base_prompt: prompt,
      objective_preset: controls.objectivePreset,
      image_model: DEFAULT_IMAGE_MODEL,
      n_variants: controls.variantCount,
      quality: DEFAULT_QUALITY,
      parent_commit_id: lineageParentCommitId,
      constraints: {
        must_include: [],
        must_avoid: []
      }
    };
    await runEvalPipeline(payload);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        if (canRun) {
          event.preventDefault();
          void runEval({ useBranchParent: false });
        }
        return;
      }

      if (isTypingTarget) {
        return;
      }

      if (event.key === "1" && suggestions?.conservative?.prompt_text) {
        event.preventDefault();
        applyPrompt(suggestions.conservative.prompt_text);
      } else if (event.key === "2" && suggestions?.balanced?.prompt_text) {
        event.preventDefault();
        applyPrompt(suggestions.balanced.prompt_text);
      } else if (event.key === "3" && suggestions?.aggressive?.prompt_text) {
        event.preventDefault();
        applyPrompt(suggestions.aggressive.prompt_text);
      } else if (event.key === "ArrowRight" && leaderboard.length > 0) {
        event.preventDefault();
        setFocusedCard((prev) => Math.min(prev + 1, leaderboard.length - 1));
      } else if (event.key === "ArrowLeft" && leaderboard.length > 0) {
        event.preventDefault();
        setFocusedCard((prev) => Math.max(prev - 1, 0));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canRun, leaderboard.length, suggestions]);

  return (
    <section className="panel panel--eval">
      <header className="panel__header">
        <h2>Eval Workbench</h2>
        <p>Run one-click prompt eval loops with ranked images and guided next prompts.</p>
      </header>

      <label className="field-label" htmlFor="eval-base-prompt">
        Base prompt
      </label>
      <textarea
        id="eval-base-prompt"
        className="field eval-input--prompt"
        rows={6}
        value={controls.basePrompt}
        onChange={(event) => setControls((prev) => ({ ...prev, basePrompt: event.target.value }))}
        placeholder="cinematic portrait of an astronaut chef in a neon diner"
      />
      <p className="field-hint">Pro tip: press Cmd/Ctrl + Enter to run. Keys 1/2/3 apply suggestions.</p>

      <div className="eval-controls">
        <div className="eval-segment">
          <span className="eval-segment__label">Objective</span>
          <div className="eval-segment__actions">
            {(["adherence", "aesthetic", "product"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`eval-chip-btn${controls.objectivePreset === value ? " eval-chip-btn--active" : ""}`}
                onClick={() => setControls((prev) => ({ ...prev, objectivePreset: value }))}
                aria-pressed={controls.objectivePreset === value}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="eval-segment">
          <span className="eval-segment__label">Variants</span>
          <div className="eval-segment__actions">
            {[2, 3].map((value) => (
              <button
                key={value}
                type="button"
                className={`eval-chip-btn${controls.variantCount === value ? " eval-chip-btn--active" : ""}`}
                onClick={() => setControls((prev) => ({ ...prev, variantCount: value as 2 | 3 }))}
                aria-pressed={controls.variantCount === value}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel__actions">
        <Button
          variant="primary"
          loading={requestStates.eval === "loading"}
          disabled={!canRun}
          onClick={() => void runEval({ useBranchParent: false })}
        >
          Run Eval
        </Button>
      </div>

      {requestStates.eval === "loading" ? (
        <LoadingState message={stageMessages[evalRun?.stage ?? "queued"] ?? "Running eval..."} />
      ) : null}

      {lastError && lastError.operation === "eval" && requestStates.eval === "error" ? (
        <ErrorState title="Eval run failed" code={lastError.code} message={lastError.message} />
      ) : null}

      {evalRun ? (
        <section className="eval-status" aria-live="polite">
          <div className="eval-status__meta">
            <strong>{evalRun.run_id}</strong>
            <span>{evalRun.status}</span>
            {evalRun.degraded ? <span className="eval-status__chip">degraded</span> : null}
          </div>
          <div className="eval-progress">
            <div className="eval-progress__bar" style={{ width: toPercent(progressPercent) }} />
          </div>
          <p className="field-hint">
            Stage: {evalRun.stage} | Generated {evalRun.progress.generated_variants}/{evalRun.progress.total_variants} | Evaluated{" "}
            {evalRun.progress.evaluated_variants}/{evalRun.progress.total_variants}
          </p>
          {evalRun.anchor_commit_id ? (
            <p className="field-hint">
              Branch anchor: <strong>{evalRun.anchor_commit_id}</strong>
            </p>
          ) : null}
          {!evalRun.anchor_commit_id && anchorCommitId ? (
            <p className="field-hint">
              Branch anchor: <strong>{anchorCommitId}</strong>
            </p>
          ) : null}
        </section>
      ) : null}

      {leaderboard.length > 0 ? (
        <section className="eval-leaderboard">
          {leaderboard.map((variant, index) => {
            const imageUrl = resolveAssetUrl(variant.image_url || undefined);
            const chips = [...variant.strength_tags.slice(0, 2), ...variant.failure_tags.slice(0, 2)];
            return (
              <article
                key={variant.variant_id}
                className={`eval-card${variant.rank && variant.rank <= 3 ? " eval-card--top" : ""}${focusedCard === index ? " eval-card--focused" : ""}`}
                tabIndex={0}
                onFocus={() => setFocusedCard(index)}
              >
                <header className="eval-card__header">
                  <div>
                    <h4>
                      #{variant.rank ?? "-"} {variant.variant_id}
                    </h4>
                    <p>Score: {variant.composite_score.toFixed(3)}</p>
                  </div>
                  <span className="eval-card__confidence">confidence {variant.confidence.toFixed(2)}</span>
                </header>

                {imageUrl ? (
                  <img className="eval-card__image" src={imageUrl} alt={`Variant ${variant.variant_id}`} loading="lazy" />
                ) : (
                  <div className="eval-card__placeholder">Image unavailable</div>
                )}

                <p className="eval-card__prompt">{variant.variant_prompt}</p>
                <p className="eval-card__rationale">{variant.rationale}</p>

                <div className="eval-card__chips">
                  {chips.length > 0
                    ? chips.map((chip) => (
                        <span key={`${variant.variant_id}-${chip}`} className="eval-chip">
                          {chip}
                        </span>
                      ))
                    : null}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {suggestions ? (
        <section className="eval-suggestions">
          {(["conservative", "balanced", "aggressive"] as const).map((kind) => (
            <article key={kind} className="eval-suggestion">
              <header>
                <h4>{kind}</h4>
              </header>
              <p>{suggestions[kind].prompt_text}</p>
              <p className="field-hint">{suggestions[kind].rationale}</p>
              <div className="eval-suggestion__actions">
                <Button variant="ghost" onClick={() => applyPrompt(suggestions[kind].prompt_text)}>
                  Use as Prompt
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void runEval({
                      promptOverride: suggestions[kind].prompt_text,
                      useBranchParent: true
                    })
                  }
                >
                  Run Now
                </Button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {topVariant ? (
        <div className="eval-sticky-actions">
          <Button variant="secondary" onClick={() => applyPrompt(topVariant.variant_prompt)}>
            Use Winner as Next Prompt
          </Button>
          <Button
            variant="secondary"
            disabled={!suggestions?.balanced?.prompt_text}
            onClick={() => applyPrompt(suggestions?.balanced?.prompt_text ?? "")}
          >
            Try Balanced Suggestion
          </Button>
          <Button variant="primary" disabled={!canRun} onClick={() => void runEval({ useBranchParent: true })}>
            Re-run Same Settings
          </Button>
        </div>
      ) : null}
    </section>
  );
};
