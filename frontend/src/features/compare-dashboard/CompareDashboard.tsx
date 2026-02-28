import { useState } from "react";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { ErrorState } from "../../components/ErrorState";
import { LoadingState } from "../../components/LoadingState";
import { formatExplanationValue } from "../../api/mappers";
import { useCompareResult, useHistory, useLastError, useRequestStates, useSelectedCommitId } from "../../state/selectors";
import { useAppStore } from "../../state/store";

const ScoreRow = ({ label, value }: { label: string; value: number }) => {
  return (
    <div className="score-row">
      <span>{label}</span>
      <strong>{value.toFixed(3)}</strong>
    </div>
  );
};

const PreviewCard = ({ title, prompt, imageUrl }: { title: string; prompt?: string; imageUrl?: string }) => {
  return (
    <article className="preview-card">
      <h4>{title}</h4>
      {prompt ? <p className="preview-card__prompt">{prompt}</p> : null}
      {imageUrl ? (
        <img src={imageUrl} alt={`${title} preview`} />
      ) : (
        <div className="preview-placeholder">Image unavailable for this commit.</div>
      )}
    </article>
  );
};

export const CompareDashboard = () => {
  const [showOverlay, setShowOverlay] = useState(false);
  const history = useHistory();
  const selectedCommitId = useSelectedCommitId();
  const compareResult = useCompareResult();
  const requestStates = useRequestStates();
  const lastError = useLastError();
  const retryLastOperation = useAppStore((state) => state.retryLastOperation);
  const resolveAssetUrl = useAppStore((state) => state.resolveAssetUrl);

  const baselineCommit = history.find((item) => item.commit_id === compareResult?.baseline_commit_id);
  const candidateCommitId = compareResult?.candidate_commit_id ?? selectedCommitId;
  const candidateCommit = history.find((item) => item.commit_id === candidateCommitId);

  const baselinePreview = resolveAssetUrl(baselineCommit?.image_paths?.[0]);
  const candidatePreview = resolveAssetUrl(candidateCommit?.image_paths?.[0]);
  const artifactTitle = showOverlay ? "Overlay" : "Diff Heatmap";
  const artifactUrl = showOverlay
    ? resolveAssetUrl(compareResult?.artifacts.overlay)
    : resolveAssetUrl(compareResult?.artifacts.diff_heatmap);
  const showWarning = compareResult?.degraded || compareResult?.verdict === "inconclusive";

  return (
    <section className="panel panel--compare">
      <header className="panel__header">
        <h2>Compare Dashboard</h2>
        <p>Analyze drift across pixel, semantic, and structure signals for a selected pair.</p>
      </header>

      {requestStates.compare === "loading" ? (
        <LoadingState message="Analyzing drift across pixel, semantic, and structure signals..." />
      ) : null}

      {lastError && lastError.operation === "compare" && requestStates.compare === "error" ? (
        <ErrorState
          title="Compare request failed"
          code={lastError.code}
          message={lastError.message}
          onRetry={lastError.retryable ? retryLastOperation : undefined}
        />
      ) : null}

      {compareResult ? (
        <>
          <div className="compare-summary">
            <h3>Report {compareResult.report_id}</h3>
            <Badge variant={compareResult.verdict}>{compareResult.verdict.toUpperCase()}</Badge>
          </div>

          {showWarning ? (
            <div className="banner banner--warning" role="status">
              Result is inconclusive due to partial signal failure. Retry compare.
            </div>
          ) : null}

          <div className="score-grid">
            <ScoreRow label="Pixel Diff" value={compareResult.scores.pixel_diff_score} />
            <ScoreRow label="Semantic Similarity" value={compareResult.scores.semantic_similarity} />
            <ScoreRow label="Structural Drift" value={compareResult.scores.vision_structural_score} />
            <ScoreRow label="Drift Score" value={compareResult.scores.drift_score} />
            <ScoreRow label="Threshold" value={compareResult.scores.threshold} />
          </div>

          <div className="preview-grid">
            <PreviewCard
              title={`Baseline (${compareResult.baseline_commit_id})`}
              prompt={baselineCommit?.prompt}
              imageUrl={baselinePreview}
            />
            <PreviewCard
              title={`Candidate (${compareResult.candidate_commit_id})`}
              prompt={candidateCommit?.prompt}
              imageUrl={candidatePreview}
            />
          </div>

          <section className="artifact-viewer">
            <div className="artifact-viewer__controls">
              <Button
                variant={showOverlay ? "ghost" : "secondary"}
                onClick={() => setShowOverlay(false)}
                aria-pressed={!showOverlay}
              >
                Diff Heatmap
              </Button>
              <Button
                variant={showOverlay ? "secondary" : "ghost"}
                onClick={() => setShowOverlay(true)}
                aria-pressed={showOverlay}
              >
                Overlay
              </Button>
            </div>
            <PreviewCard title={artifactTitle} imageUrl={artifactUrl} />
          </section>

          <section className="explanation">
            <h3>Explanation</h3>
            <dl>
              {Object.entries(compareResult.explanation).map(([key, value]) => (
                <div key={key} className="explanation-row">
                  <dt>{key}</dt>
                  <dd>{formatExplanationValue(value)}</dd>
                </div>
              ))}
              {Object.keys(compareResult.explanation).length === 0 ? (
                <div className="explanation-row">
                  <dt>details</dt>
                  <dd>No explanation fields returned.</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </>
      ) : (
        <div className="state">Use Compare mode in the lineage graph, then select A and B nodes.</div>
      )}
    </section>
  );
};
