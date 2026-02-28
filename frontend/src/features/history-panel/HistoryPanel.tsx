import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { useBaselineCommitId, useHistory, useRequestStates, useSelectedCommitId } from "../../state/selectors";
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
  const requestStates = useRequestStates();
  const setBaseline = useAppStore((state) => state.setBaseline);
  const compareCommit = useAppStore((state) => state.compareCommit);
  const setSelectedCommit = useAppStore((state) => state.setSelectedCommit);

  return (
    <section className="panel panel--history">
      <header className="panel__header">
        <h2>Commit History</h2>
        <p>Newest commits first. Set one active baseline.</p>
      </header>

      {history.length === 0 ? <div className="state">No commits yet. Generate your first commit.</div> : null}

      <ul className="history-list" aria-label="Commit history">
        {history.map((item) => {
          const isBaseline = baselineId === item.commit_id;
          const isSelected = selectedCommitId === item.commit_id;

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

              <div className="history-item__actions">
                <Button
                  variant="secondary"
                  loading={requestStates.baseline === "loading" && !isBaseline}
                  disabled={requestStates.baseline === "loading" || isBaseline}
                  onClick={() => setBaseline(item.commit_id)}
                >
                  Set Baseline
                </Button>
                <Button
                  variant="ghost"
                  loading={requestStates.compare === "loading" && selectedCommitId === item.commit_id}
                  disabled={!baselineId || isBaseline || requestStates.compare === "loading"}
                  onClick={() => compareCommit(item.commit_id)}
                >
                  Compare
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
