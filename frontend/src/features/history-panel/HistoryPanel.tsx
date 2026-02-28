import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { useBaselineCommitId, useHistory, useSelectedCommitId } from "../../state/selectors";
import { useAppStore } from "../../state/store";

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

export const HistoryPanel = () => {
  const history = useHistory();
  const baselineId = useBaselineCommitId();
  const selectedCommitId = useSelectedCommitId();
  const setSelectedCommit = useAppStore((state) => state.setSelectedCommit);
  const openPromptModal = useAppStore((state) => state.openPromptModal);
  const resolveAssetUrl = useAppStore((state) => state.resolveAssetUrl);

  return (
    <section className="panel panel--history">
      <header className="panel__header">
        <h2>Commit History</h2>
        <p>Newest commits first. Select one to inspect lineage details.</p>
      </header>

      {history.length === 0 ? (
        <div className="state">
          <p>No commits yet. Generate your first commit.</p>
          <div className="panel__actions">
            <Button variant="primary" onClick={() => openPromptModal()}>
              Add First Commit
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="history-list" aria-label="Commit history">
        {history.map((item) => {
          const isBaseline = baselineId === item.commit_id;
          const isSelected = selectedCommitId === item.commit_id;
          const previewUrl = resolveAssetUrl(item.image_paths?.[0]);

          return (
            <li
              key={item.commit_id}
              className={`history-item${isBaseline ? " history-item--baseline" : ""}${isSelected ? " history-item--selected" : ""}`}
            >
              <button className="history-item__select" type="button" onClick={() => setSelectedCommit(item.commit_id)}>
                <span className="history-item__title">{item.commit_id}</span>
                <span className="history-item__timestamp">{formatDate(item.created_at)}</span>
              </button>

              <div className="history-item__meta">
                <Badge variant="status">{item.status}</Badge>
                {isBaseline ? <Badge variant="baseline">Baseline</Badge> : null}
              </div>

              <p className="history-item__prompt">{item.prompt || "Prompt unavailable."}</p>

              {previewUrl ? (
                <img className="history-item__thumb" src={previewUrl} alt={`${item.commit_id} preview`} loading="lazy" />
              ) : (
                <div className="history-item__thumb history-item__thumb--placeholder">No image preview</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
