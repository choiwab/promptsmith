import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { useEvalRun, useLastError, useProjectId, useRequestStates } from "../../state/selectors";
import { useAppStore } from "../../state/store";
import type { CreateEvalRunRequest, EvalVariant, ObjectivePreset } from "../../api/types";

interface EvalControlState {
  basePrompt: string;
  objectivePreset: ObjectivePreset;
  variantCount: 2 | 3;
  followWinnerBranch: boolean;
}

const STORAGE_KEY = "promptsmith.eval.controls.v1";
const DEFAULT_IMAGE_MODEL = "gpt-image-1-mini";
const DEFAULT_QUALITY = "medium" as const;

const defaultControls: EvalControlState = {
  basePrompt: "",
  objectivePreset: "adherence",
  variantCount: 3,
  followWinnerBranch: true
};

const stageMessages: Record<string, string> = {
  queued: "Queued for execution...",
  planning: "Planning variants...",
  generating: "Generating images...",
  evaluating: "Scoring generated images...",
  refining: "Finalizing eval outputs...",
  completed: "Eval completed.",
  completed_degraded: "Eval completed in degraded mode.",
  failed: "Eval failed."
};

const pipelineSteps = ["planning", "generating", "evaluating", "refining"] as const;
type PipelineStep = (typeof pipelineSteps)[number];

const pipelineStepLabel: Record<PipelineStep, string> = {
  planning: "Plan variants",
  generating: "Generate images",
  evaluating: "Score and judge",
  refining: "Draft next prompts"
};

const pipelineStepOrder: Record<PipelineStep, number> = {
  planning: 0,
  generating: 1,
  evaluating: 2,
  refining: 3
};

const WINNER_MIN_CONFIDENCE = 0.62;
const WINNER_MIN_SCORE_MARGIN = 0.035;

const humanizeStatus = (status: string): string =>
  status
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");

interface BranchDecision {
  parentCommitId?: string;
  reason: string;
  mode: "winner" | "anchor" | "new_anchor";
  scoreMargin?: number;
}

const resolveWinnerBranchDecision = (
  leaderboard: EvalVariant[],
  anchorParentCommitId?: string
): BranchDecision => {
  const top = leaderboard[0];
  const runnerUp = leaderboard[1];
  if (!top) {
    if (anchorParentCommitId) {
      return {
        parentCommitId: anchorParentCommitId,
        mode: "anchor",
        reason: "No winner yet. Staying on anchor for the next run."
      };
    }
    return {
      parentCommitId: undefined,
      mode: "new_anchor",
      reason: "No prior anchor available. The next run will create a fresh anchor."
    };
  }

  if (!top.commit_id) {
    if (anchorParentCommitId) {
      return {
        parentCommitId: anchorParentCommitId,
        mode: "anchor",
        reason: `${top.variant_id} has no persisted commit. Staying on anchor.`
      };
    }
    return {
      parentCommitId: undefined,
      mode: "new_anchor",
      reason: `${top.variant_id} has no persisted commit. A fresh anchor will be created.`
    };
  }

  const scoreMargin = runnerUp ? top.composite_score - runnerUp.composite_score : top.composite_score;
  if (top.confidence < WINNER_MIN_CONFIDENCE) {
    return {
      parentCommitId: anchorParentCommitId,
      mode: anchorParentCommitId ? "anchor" : "new_anchor",
      scoreMargin,
      reason: `Winner confidence ${top.confidence.toFixed(2)} is below ${WINNER_MIN_CONFIDENCE.toFixed(2)}. Keeping anchor for stability.`
    };
  }

  if (runnerUp && scoreMargin < WINNER_MIN_SCORE_MARGIN) {
    return {
      parentCommitId: anchorParentCommitId,
      mode: anchorParentCommitId ? "anchor" : "new_anchor",
      scoreMargin,
      reason: `Top score gap ${scoreMargin.toFixed(3)} is below ${WINNER_MIN_SCORE_MARGIN.toFixed(3)}. Keeping anchor for stability.`
    };
  }

  return {
    parentCommitId: top.commit_id,
    mode: "winner",
    scoreMargin,
    reason: `Winner ${top.variant_id} is stable (confidence ${top.confidence.toFixed(2)}, margin ${scoreMargin.toFixed(3)}).`
  };
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
      followWinnerBranch: typeof parsed.followWinnerBranch === "boolean" ? parsed.followWinnerBranch : true,
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
  const [expandedCardText, setExpandedCardText] = useState<Record<string, boolean>>({});

  const canRun = useMemo(() => {
    return controls.basePrompt.trim().length >= 5 && requestStates.eval !== "loading";
  }, [controls.basePrompt, requestStates.eval]);

  const leaderboard = evalRun?.leaderboard ?? [];
  const topVariant = leaderboard[0];
  const anchorParentCommitId = anchorCommitId || evalRun?.anchor_commit_id;
  const variants = useMemo(() => {
    const items = [...(evalRun?.variants ?? [])];
    items.sort((left, right) => left.variant_id.localeCompare(right.variant_id));
    return items;
  }, [evalRun?.variants]);

  const winnerBranchDecision = useMemo(
    () => resolveWinnerBranchDecision(leaderboard, anchorParentCommitId || undefined),
    [anchorParentCommitId, leaderboard]
  );

  const branchTargetCommitId = controls.followWinnerBranch
    ? winnerBranchDecision.parentCommitId
    : anchorParentCommitId;

  const processNotes = useMemo(() => {
    const notes: string[] = [];
    if (!evalRun) {
      notes.push(`Ready to run ${controls.variantCount} variants.`);
      notes.push(
        controls.followWinnerBranch
          ? "Branch strategy is set to follow the winner only when it passes stability checks."
          : "Branch strategy is set to stay pinned to the selected anchor."
      );
      return notes;
    }

    notes.push(
      `Progress: generated ${evalRun.progress.generated_variants}/${evalRun.progress.total_variants}, evaluated ${evalRun.progress.evaluated_variants}/${evalRun.progress.total_variants}.`
    );
    if (evalRun.variants.length > 0) {
      notes.push(`Planner produced ${evalRun.variants.length} variants for objective ${evalRun.objective_preset}.`);
    }
    if (topVariant) {
      notes.push(`Current leader is ${topVariant.variant_id} at score ${topVariant.composite_score.toFixed(3)}.`);
    }
    if (controls.followWinnerBranch) {
      notes.push(`Branch gate: ${winnerBranchDecision.reason}`);
    }
    if (evalRun.degraded) {
      notes.push("Fallback mode is active because at least one upstream generation or evaluation step failed.");
    }
    if (evalRun.stage === "refining") {
      notes.push("Agent is finishing the final refinement step.");
    }
    if (evalRun.stage === "completed" || evalRun.stage === "completed_degraded") {
      notes.push("Run finalized. You can branch from the winner and run again.");
    }
    return notes;
  }, [controls.followWinnerBranch, controls.variantCount, evalRun, topVariant, winnerBranchDecision.reason]);

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

  const stepStateById = useMemo(() => {
    const stepState: Record<PipelineStep, "pending" | "active" | "done"> = {
      planning: "pending",
      generating: "pending",
      evaluating: "pending",
      refining: "pending"
    };

    if (!evalRun) {
      return stepState;
    }

    const stage = evalRun.stage;
    if (stage === "completed" || stage === "completed_degraded") {
      for (const step of pipelineSteps) {
        stepState[step] = "done";
      }
      return stepState;
    }

    if (stage === "failed") {
      if (evalRun.variants.length > 0) {
        stepState.planning = "done";
      } else {
        stepState.planning = "active";
        return stepState;
      }

      if (evalRun.progress.generated_variants > 0) {
        stepState.generating = "done";
      } else {
        stepState.generating = "active";
        return stepState;
      }

      if (evalRun.progress.evaluated_variants > 0) {
        stepState.evaluating = "done";
      } else {
        stepState.evaluating = "active";
        return stepState;
      }

      stepState.refining = "active";
      return stepState;
    }

    if (stage === "queued") {
      stepState.planning = "active";
      return stepState;
    }

    const activeOrder = pipelineStepOrder[stage as PipelineStep];
    if (activeOrder === undefined) {
      return stepState;
    }

    for (const step of pipelineSteps) {
      const order = pipelineStepOrder[step];
      if (order < activeOrder) {
        stepState[step] = "done";
      } else if (order === activeOrder) {
        stepState[step] = "active";
      }
    }
    return stepState;
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

    const useBranchParent = options?.useBranchParent ?? controls.followWinnerBranch;
    const lineageParentCommitId =
      useBranchParent
        ? winnerBranchDecision.parentCommitId || undefined
        : anchorParentCommitId || undefined;

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
          void runEval();
        }
        return;
      }

      if (isTypingTarget) {
        return;
      }

      if (event.key === "ArrowRight" && leaderboard.length > 0) {
        event.preventDefault();
        setFocusedCard((prev) => Math.min(prev + 1, leaderboard.length - 1));
      } else if (event.key === "ArrowLeft" && leaderboard.length > 0) {
        event.preventDefault();
        setFocusedCard((prev) => Math.max(prev - 1, 0));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canRun, leaderboard.length]);

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
      <p className="field-hint">Pro tip: press Cmd/Ctrl + Enter to run.</p>

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

        <div className="eval-segment">
          <span className="eval-segment__label">Branching</span>
          <div className="eval-segment__actions">
            <button
              type="button"
              className={`eval-chip-btn${!controls.followWinnerBranch ? " eval-chip-btn--active" : ""}`}
              onClick={() => setControls((prev) => ({ ...prev, followWinnerBranch: false }))}
              aria-pressed={!controls.followWinnerBranch}
            >
              Stay on anchor
            </button>
            <button
              type="button"
              className={`eval-chip-btn${controls.followWinnerBranch ? " eval-chip-btn--active" : ""}`}
              onClick={() => setControls((prev) => ({ ...prev, followWinnerBranch: true }))}
              aria-pressed={controls.followWinnerBranch}
            >
              Follow stable winner
            </button>
          </div>
          <p className="field-hint">
            Parent target: <strong>{branchTargetCommitId ?? "new anchor will be created"}</strong>
          </p>
          {controls.followWinnerBranch ? <p className="field-hint">Decision: {winnerBranchDecision.reason}</p> : null}
        </div>
      </div>

      <div className="panel__actions">
        <Button
          variant="primary"
          loading={requestStates.eval === "loading"}
          disabled={!canRun}
          onClick={() => void runEval()}
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

      <section className="eval-process" aria-live="polite">
        <header className="eval-process__header">
          <h3>Agent Process</h3>
          <p>Live pipeline states and decisions derived from run telemetry.</p>
        </header>

        <ol className="eval-timeline">
          {pipelineSteps.map((step) => (
            <li key={step} className={`eval-timeline__step eval-timeline__step--${stepStateById[step]}`}>
              <span className="eval-timeline__dot" />
              <div>
                <strong>{pipelineStepLabel[step]}</strong>
                <p>{stepStateById[step] === "active" ? "In progress" : stepStateById[step] === "done" ? "Completed" : "Pending"}</p>
              </div>
            </li>
          ))}
        </ol>

        <ul className="eval-trace">
          {processNotes.map((note, index) => (
            <li key={`${index}-${note}`}>{note}</li>
          ))}
        </ul>

        {variants.length > 0 ? (
          <div className="eval-variant-trace">
            {variants.map((variant) => (
              <article key={`trace-${variant.variant_id}`} className="eval-variant-trace__item">
                <div className="eval-variant-trace__meta">
                  <strong>{variant.variant_id}</strong>
                  <span
                    className={`eval-trace-pill eval-trace-pill--${
                      variant.status.includes("failed") || variant.status.includes("degraded") || variant.status.includes("skipped")
                        ? "warn"
                        : "neutral"
                    }`}
                  >
                    {humanizeStatus(variant.status)}
                  </span>
                  {variant.rank ? <span className="eval-trace-pill eval-trace-pill--good">rank #{variant.rank}</span> : null}
                </div>
                <p className="eval-variant-trace__line">
                  {variant.mutation_tags.length > 0 ? variant.mutation_tags.slice(0, 3).join(" • ") : "Mutation tags pending"}
                </p>
                <p className="eval-variant-trace__line">
                  gen {variant.generation_latency_ms ?? "--"}ms | judge {variant.judge_latency_ms ?? "--"}ms | score{" "}
                  {variant.composite_score.toFixed(3)}
                </p>
                {variant.error ? <p className="eval-variant-trace__error">{variant.error}</p> : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {leaderboard.length > 0 ? (
        <section className="eval-leaderboard">
          {leaderboard.map((variant, index) => {
            const imageUrl = resolveAssetUrl(variant.image_url || undefined);
            const chips = [...variant.strength_tags.slice(0, 2), ...variant.failure_tags.slice(0, 2)];
            const isExpanded = Boolean(expandedCardText[variant.variant_id]);
            const canExpand = variant.variant_prompt.length + variant.rationale.length > 360;
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

                <div className="eval-card__body">
                  <div className="eval-card__media">
                    {imageUrl ? (
                      <img className="eval-card__image" src={imageUrl} alt={`Variant ${variant.variant_id}`} loading="lazy" />
                    ) : (
                      <div className="eval-card__placeholder">Image unavailable</div>
                    )}
                  </div>

                  <div className="eval-card__content">
                    <div
                      className={`eval-card__text-wrap${
                        canExpand ? " eval-card__text-wrap--clamped" : ""
                      }${isExpanded ? " eval-card__text-wrap--expanded" : ""}`}
                    >
                      <p className="eval-card__prompt">{variant.variant_prompt}</p>
                      <p className="eval-card__rationale">{variant.rationale}</p>
                    </div>

                    {canExpand ? (
                      <button
                        type="button"
                        className="eval-card__toggle"
                        onClick={() =>
                          setExpandedCardText((prev) => ({ ...prev, [variant.variant_id]: !Boolean(prev[variant.variant_id]) }))
                        }
                      >
                        {isExpanded ? "Show less" : "Show more"}
                      </button>
                    ) : null}

                    <div className="eval-card__chips">
                      {chips.length > 0
                        ? chips.map((chip) => (
                            <span key={`${variant.variant_id}-${chip}`} className="eval-chip">
                              {chip}
                            </span>
                          ))
                        : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {topVariant ? (
        <div className="eval-sticky-actions">
          <Button variant="secondary" onClick={() => applyPrompt(topVariant.variant_prompt)}>
            Use Winner as Next Prompt
          </Button>
          <Button variant="primary" disabled={!canRun} onClick={() => void runEval({ useBranchParent: true })}>
            Re-run Same Settings
          </Button>
        </div>
      ) : null}
    </section>
  );
};
