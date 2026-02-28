import { useEffect } from "react";
import { ErrorState } from "../components/ErrorState";
import { CompareDashboard } from "../features/compare-dashboard/CompareDashboard";
import { HistoryPanel } from "../features/history-panel/HistoryPanel";
import { ToastHost } from "../features/notifications/ToastHost";
import { PromptWorkbench } from "../features/prompt-workbench/PromptWorkbench";
import { useHistory, useLastError, useRequestStates } from "../state/selectors";
import { useAppStore } from "../state/store";

const appName = import.meta.env.VITE_APP_NAME || "Promptsmith";

export const App = () => {
  const fetchHistory = useAppStore((state) => state.fetchHistory);
  const retryLastOperation = useAppStore((state) => state.retryLastOperation);
  const history = useHistory();
  const requestStates = useRequestStates();
  const lastError = useLastError();

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const showBlockingError =
    requestStates.history === "error" &&
    history.length === 0 &&
    (lastError?.code === "API_UNAVAILABLE" || lastError?.code === "REQUEST_TIMEOUT");
  const showInlineError = Boolean(lastError) && !showBlockingError && lastError?.operation !== "compare";

  return (
    <>
      <header className="app-header">
        <div>
          <h1>{appName}</h1>
          <p>CI-style regression checks for character prompt iterations.</p>
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
