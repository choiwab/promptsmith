import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";
import { ErrorState } from "../components/ErrorState";
import { Modal } from "../components/Modal";
import { CompareDashboard } from "../features/compare-dashboard/CompareDashboard";
import { EvalWorkbench } from "../features/eval-workbench/EvalWorkbench";
import { HistoryPanel } from "../features/history-panel/HistoryPanel";
import { LineageWorkspace } from "../features/history-panel/LineageWorkspace";
import { ToastHost } from "../features/notifications/ToastHost";
import { ProjectSidebar } from "../features/project-sidebar/ProjectSidebar";
import { PromptWorkbench } from "../features/prompt-workbench/PromptWorkbench";
import {
  useCommitInfoCommitId,
  useCompareModalOpen,
  useDeleteTargetCommitId,
  useEvalModalAnchorCommitId,
  useEvalModalOpen,
  useGraphFullscreenOpen,
  useHistory,
  useLastError,
  useProjectId,
  usePromptModalAnchorCommitId,
  usePromptModalOpen,
  usePromptModalRootMode,
  useRequestStates
} from "../state/selectors";
import { useAppStore } from "../state/store";

const appName = import.meta.env.VITE_APP_NAME || "Promptsmith";

const countDescendants = (historyCommitIds: { commit_id: string; parent_commit_id?: string }[], commitId: string): number => {
  const childrenByParent = new Map<string, string[]>();
  for (const item of historyCommitIds) {
    if (!item.parent_commit_id) {
      continue;
    }
    const existing = childrenByParent.get(item.parent_commit_id) ?? [];
    existing.push(item.commit_id);
    childrenByParent.set(item.parent_commit_id, existing);
  }

  const visited = new Set<string>();
  const queue = [commitId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    queue.push(...(childrenByParent.get(current) ?? []));
  }

  return visited.size;
};

export const App = () => {
  const fetchHistory = useAppStore((state) => state.fetchHistory);
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const retryLastOperation = useAppStore((state) => state.retryLastOperation);
  const closePromptModal = useAppStore((state) => state.closePromptModal);
  const openPromptModal = useAppStore((state) => state.openPromptModal);
  const closeEvalModal = useAppStore((state) => state.closeEvalModal);
  const openEvalModal = useAppStore((state) => state.openEvalModal);
  const closeCompareModal = useAppStore((state) => state.closeCompareModal);
  const closeCommitInfoModal = useAppStore((state) => state.closeCommitInfoModal);
  const requestDeleteCommit = useAppStore((state) => state.requestDeleteCommit);
  const clearDeleteCommitRequest = useAppStore((state) => state.clearDeleteCommitRequest);
  const deleteCommitSubtree = useAppStore((state) => state.deleteCommitSubtree);
  const setGraphFullscreenOpen = useAppStore((state) => state.setGraphFullscreenOpen);
  const resolveAssetUrl = useAppStore((state) => state.resolveAssetUrl);

  const history = useHistory();
  const projectId = useProjectId();
  const requestStates = useRequestStates();
  const lastError = useLastError();
  const promptModalAnchorCommitId = usePromptModalAnchorCommitId();
  const promptModalOpen = usePromptModalOpen();
  const promptModalRootMode = usePromptModalRootMode();
  const evalModalAnchorCommitId = useEvalModalAnchorCommitId();
  const evalModalOpen = useEvalModalOpen();
  const compareModalOpen = useCompareModalOpen();
  const commitInfoCommitId = useCommitInfoCommitId();
  const graphFullscreenOpen = useGraphFullscreenOpen();
  const deleteTargetCommitId = useDeleteTargetCommitId();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      await fetchHistory();
      await refreshProjects();
    })();
  }, [fetchHistory, refreshProjects]);

  const showBlockingError =
    requestStates.history === "error" &&
    history.length === 0 &&
    (lastError?.code === "API_UNAVAILABLE" || lastError?.code === "REQUEST_TIMEOUT");
  const showInlineError =
    Boolean(lastError) &&
    !showBlockingError &&
    lastError?.operation !== "compare" &&
    lastError?.operation !== "eval" &&
    lastError?.operation !== "delete";
  const isSafetyRejection = lastError?.code === "OPENAI_SAFETY_REJECTION" && lastError?.operation === "generate";

  const commitInfo = history.find((item) => item.commit_id === commitInfoCommitId);
  const commitInfoImage = resolveAssetUrl(commitInfo?.image_paths?.[0]);
  const deleteTarget = history.find((item) => item.commit_id === deleteTargetCommitId);
  const deleteSize = useMemo(() => {
    if (!deleteTargetCommitId) {
      return 0;
    }
    return countDescendants(history, deleteTargetCommitId);
  }, [deleteTargetCommitId, history]);

  return (
    <div className="app-shell">
      <ProjectSidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />
      <div className="app-content">
        <header className="app-header">
          <div className="app-header__identity">
            <button className="app-header__menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open project sidebar">
              &#9776;
            </button>
            <span className="app-header__repo">repo</span>
            <div>
              <h1>{appName}</h1>
              <p>Prompt history and lineage-driven generation workflows.</p>
            </div>
          </div>
          <div className="app-header__controls">
            <span className="app-header__chip">Project: {projectId}</span>
            <span className="app-header__chip">Interactive lineage</span>
            <span className="app-header__chip">Modal compare + eval</span>
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
              title={isSafetyRejection ? "Generation blocked by safety policy" : "Request failed"}
              code={lastError?.code}
              message={lastError?.message || "An unexpected error occurred."}
              onRetry={lastError?.retryable ? retryLastOperation : undefined}
            >
              {isSafetyRejection ? (
                <div className="error-guidance">
                  <p>Try revising the prompt with safer wording and removing sensitive or disallowed details.</p>
                  <ul>
                    <li>Avoid explicit violence, self-harm, sexual content, or illegal activity instructions.</li>
                    <li>Use neutral descriptive language for character, style, and scene.</li>
                    <li>If it still fails, simplify the prompt and re-add detail gradually.</li>
                  </ul>
                </div>
              ) : null}
            </ErrorState>
          </section>
        ) : null}

        <main className="app-layout app-layout--dashboard" aria-label="Promptsmith workspace">
          <HistoryPanel />
          <LineageWorkspace />
        </main>

        <Modal
          open={promptModalOpen}
          title="Prompt Workbench"
          size="xl"
          onClose={closePromptModal}
        >
          <PromptWorkbench
            anchorCommitId={promptModalAnchorCommitId}
            forceRoot={promptModalRootMode}
            onGenerated={closePromptModal}
          />
        </Modal>

        <Modal
          open={evalModalOpen}
          title="Eval Workbench"
          size="xl"
          onClose={closeEvalModal}
        >
          <EvalWorkbench anchorCommitId={evalModalAnchorCommitId} />
        </Modal>

        <Modal open={compareModalOpen} title="Compare Dashboard" size="xl" onClose={closeCompareModal}>
          <CompareDashboard />
        </Modal>

        <Modal
          open={Boolean(commitInfo)}
          title={commitInfo ? `Commit ${commitInfo.commit_id}` : "Commit Info"}
          size="lg"
          onClose={closeCommitInfoModal}
          footer={
            commitInfo ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    openPromptModal(commitInfo.commit_id);
                    closeCommitInfoModal();
                  }}
                >
                  Add Child Prompt
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    openEvalModal(commitInfo.commit_id);
                    closeCommitInfoModal();
                  }}
                >
                  Run Eval
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    requestDeleteCommit(commitInfo.commit_id);
                    closeCommitInfoModal();
                  }}
                >
                  Delete
                </Button>
              </>
            ) : null
          }
        >
          {commitInfo ? (
            <section className="commit-info">
              <div className="commit-info__grid">
                <div>
                  <h4>ID</h4>
                  <p>{commitInfo.commit_id}</p>
                </div>
                <div>
                  <h4>Status</h4>
                  <p>{commitInfo.status}</p>
                </div>
                <div>
                  <h4>Created</h4>
                  <p>{commitInfo.created_at}</p>
                </div>
                <div>
                  <h4>Parent</h4>
                  <p>{commitInfo.parent_commit_id || "(root)"}</p>
                </div>
                <div>
                  <h4>Model</h4>
                  <p>{commitInfo.model || "n/a"}</p>
                </div>
                <div>
                  <h4>Seed</h4>
                  <p>{commitInfo.seed || "n/a"}</p>
                </div>
              </div>
              {commitInfo.error ? (
                <div className="commit-info__error">
                  <h4>Error</h4>
                  <p>{commitInfo.error}</p>
                </div>
              ) : null}
              <div className="commit-info__prompt">
                <h4>Prompt</h4>
                <p>{commitInfo.prompt || "Prompt unavailable."}</p>
              </div>
              {commitInfoImage ? <img src={commitInfoImage} alt={`${commitInfo.commit_id} preview`} /> : null}
            </section>
          ) : null}
        </Modal>

        <Modal
          open={Boolean(deleteTarget)}
          title={deleteTarget ? `Delete ${deleteTarget.commit_id}` : "Delete commit"}
          size="md"
          onClose={clearDeleteCommitRequest}
          footer={
            <>
              <Button variant="ghost" onClick={clearDeleteCommitRequest}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={requestStates.delete === "loading"}
                onClick={() => {
                  if (deleteTargetCommitId) {
                    void deleteCommitSubtree(deleteTargetCommitId);
                  }
                }}
              >
                Delete Commit Tree
              </Button>
            </>
          }
        >
          {deleteTarget ? (
            <div className="delete-confirm">
              <p>This deletes this node and all descendants permanently.</p>
              <p>
                Root: <strong>{deleteTarget.commit_id}</strong>
              </p>
              <p>
                Commits affected: <strong>{deleteSize}</strong>
              </p>
            </div>
          ) : null}
        </Modal>

        <Modal
          open={graphFullscreenOpen}
          title="Lineage Graph"
          size="fullscreen"
          onClose={() => setGraphFullscreenOpen(false)}
        >
          <LineageWorkspace fullscreen />
        </Modal>

        <ToastHost />
      </div>
    </div>
  );
};

export default App;
