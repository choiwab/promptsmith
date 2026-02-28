import { Button } from "../../components/Button";
import {
  useBaselineCommitId,
  useCompareSelectionCommitIds,
  useCompareSelectionMode,
  useHistory,
  useProjectId,
  useSelectedCommitId
} from "../../state/selectors";
import { useAppStore } from "../../state/store";
import { LineageGraph } from "./LineageGraph";

interface LineageWorkspaceProps {
  fullscreen?: boolean;
}

export const LineageWorkspace = ({ fullscreen = false }: LineageWorkspaceProps) => {
  const history = useHistory();
  const projectId = useProjectId();
  const baselineCommitId = useBaselineCommitId();
  const selectedCommitId = useSelectedCommitId();
  const compareSelectionMode = useCompareSelectionMode();
  const compareSelectionCommitIds = useCompareSelectionCommitIds();
  const setSelectedCommit = useAppStore((state) => state.setSelectedCommit);
  const openPromptModal = useAppStore((state) => state.openPromptModal);
  const openEvalModal = useAppStore((state) => state.openEvalModal);
  const openCommitInfoModal = useAppStore((state) => state.openCommitInfoModal);
  const requestDeleteCommit = useAppStore((state) => state.requestDeleteCommit);
  const lineageNodePositions = useAppStore((state) => state.lineageNodePositionsByProject[state.projectId]);
  const setLineageNodePositions = useAppStore((state) => state.setLineageNodePositions);
  const selectCompareNode = useAppStore((state) => state.selectCompareNode);
  const toggleCompareSelectionMode = useAppStore((state) => state.toggleCompareSelectionMode);
  const setGraphFullscreenOpen = useAppStore((state) => state.setGraphFullscreenOpen);
  const resolveAssetUrl = useAppStore((state) => state.resolveAssetUrl);
  const selectedCommit = history.find((item) => item.commit_id === selectedCommitId);

  return (
    <section className={`panel panel--lineage${fullscreen ? " panel--lineage-fullscreen" : ""}`}>
      <header className="lineage-section__header lineage-section__header--with-controls">
        <div>
          <h2>Lineage Graph</h2>
          <p>
            {selectedCommit
              ? `Selected ${selectedCommit.commit_id}${selectedCommit.parent_commit_id ? ` from ${selectedCommit.parent_commit_id}` : " (root)"}`
              : "Select a commit to inspect lineage."}
          </p>
          {compareSelectionMode ? (
            <p className="lineage-section__hint">
              Compare mode: select {compareSelectionCommitIds.length === 0 ? "A (baseline)" : "B (candidate)"} node.
            </p>
          ) : (
            <p className="lineage-section__hint">
              Drag background to pan. Shift+drag to multi-select, then drag a selected node to move the group.
            </p>
          )}
        </div>
        <div className="lineage-section__controls">
          <Button
            variant={compareSelectionMode ? "secondary" : "ghost"}
            onClick={() => toggleCompareSelectionMode()}
            aria-pressed={compareSelectionMode}
          >
            {compareSelectionMode ? "Cancel Compare" : "Compare"}
          </Button>
          <Button variant="ghost" onClick={() => setGraphFullscreenOpen(!fullscreen)}>
            {fullscreen ? "Exit Fullscreen" : "Expand"}
          </Button>
        </div>
      </header>

      <LineageGraph
        items={history}
        selectedCommitId={selectedCommitId}
        baselineCommitId={baselineCommitId}
        compareSelectionMode={compareSelectionMode}
        compareSelectionCommitIds={compareSelectionCommitIds}
        resolveAssetUrl={resolveAssetUrl}
        positionsScopeKey={projectId}
        persistedNodePositions={lineageNodePositions}
        onNodePositionsChange={(positions) => setLineageNodePositions(projectId, positions)}
        onNodeClick={(commitId) => {
          setSelectedCommit(commitId);
          if (compareSelectionMode) {
            void selectCompareNode(commitId);
            return;
          }
          openCommitInfoModal(commitId);
        }}
        onPromptAction={(commitId) => openPromptModal(commitId)}
        onEvalAction={(commitId) => openEvalModal(commitId)}
        onDeleteAction={(commitId) => requestDeleteCommit(commitId)}
      />
    </section>
  );
};
