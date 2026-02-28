import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { ErrorState } from "../components/ErrorState";
import { CompareDashboard } from "../features/compare-dashboard/CompareDashboard";
import { HistoryPanel } from "../features/history-panel/HistoryPanel";
import { ToastHost } from "../features/notifications/ToastHost";
import { PromptWorkbench } from "../features/prompt-workbench/PromptWorkbench";
import { useHistory, useLastError, useProjectId, useRequestStates } from "../state/selectors";
import { useAppStore } from "../state/store";

const appName = import.meta.env.VITE_APP_NAME || "Promptsmith";

export const App = () => {
  const fetchHistory = useAppStore((state) => state.fetchHistory);
  const setProject = useAppStore((state) => state.setProject);
  const retryLastOperation = useAppStore((state) => state.retryLastOperation);
  const history = useHistory();
  const projectId = useProjectId();
  const requestStates = useRequestStates();
  const lastError = useLastError();
  const [projectInput, setProjectInput] = useState(projectId);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    setProjectInput(projectId);
  }, [projectId]);

  const showBlockingError =
    requestStates.history === "error" &&
    history.length === 0 &&
    (lastError?.code === "API_UNAVAILABLE" || lastError?.code === "REQUEST_TIMEOUT");
  const showInlineError = Boolean(lastError) && !showBlockingError && lastError?.operation !== "compare";

  return (
    <>
      <header className="app-header">
        <div className="app-header__identity">
          <span className="app-header__repo">repo</span>
          <div>
            <h1>{appName}</h1>
            <p>Prompt history, lineage, and CI-style visual regression checks.</p>
          </div>
        </div>
        <div className="app-header__controls">
          <form
            className="app-header__project-form"
            onSubmit={(event) => {
              event.preventDefault();
              void setProject(projectInput);
            }}
          >
            <label htmlFor="project-id-input" className="app-header__project-label">
              Project ID
            </label>
            <div className="app-header__project-row">
              <input
                id="project-id-input"
                className="field app-header__project-input"
                value={projectInput}
                onChange={(event) => setProjectInput(event.target.value)}
                placeholder="default"
              />
              <Button
                variant="secondary"
                loading={requestStates.project === "loading"}
                disabled={projectInput.trim().length === 0}
                type="submit"
              >
                Load or Create
              </Button>
            </div>
          </form>
          <span className="app-header__chip">Project: {projectId}</span>
          <span className="app-header__chip">Lineage-aware generations</span>
          <span className="app-header__chip">Compare pipeline</span>
        </div>
      </header>

      {showBlockingError ? (
        <ErrorState
          title="Backend unavailable"
          code={lastError?.code}
          message={lastError?.message || "Cannot reach backend. Verify server is running and retry."}
          onRetry={retryLastOperation}
        />
      ) : null}

      {showInlineError ? (
        <section className="inline-error">
          <ErrorState
            title="Request failed"
            code={lastError?.code}
            message={lastError?.message || "An unexpected error occurred."}
            onRetry={lastError?.retryable ? retryLastOperation : undefined}
          />
        </section>
      ) : null}

      <main className="app-layout" aria-label="Promptsmith workspace">
        <PromptWorkbench />
        <HistoryPanel />
        <CompareDashboard />
      </main>

      <ToastHost />
    </>
  );
};

export default App;
