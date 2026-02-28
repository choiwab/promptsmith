import { useMemo, useRef, useState } from "react";
import type { HistoryItem } from "../../api/types";

interface LineageGraphProps {
  items: HistoryItem[];
  selectedCommitId?: string;
  baselineCommitId?: string;
  compareSelectionMode: boolean;
  compareSelectionCommitIds: string[];
  resolveAssetUrl?: (path?: string) => string | undefined;
  onNodeClick: (commitId: string) => void;
  onPromptAction: (commitId: string) => void;
  onEvalAction: (commitId: string) => void;
  onDeleteAction: (commitId: string) => void;
}

interface PositionedNode {
  item: HistoryItem;
  depth: number;
  row: number;
}

interface Edge {
  from: PositionedNode;
  to: PositionedNode;
}

type TooltipDirection = "above" | "below";

const TOOLTIP_ESTIMATED_HEIGHT = 220;

const byCreatedAtAsc = (left: HistoryItem, right: HistoryItem): number => {
  const l = Date.parse(left.created_at);
  const r = Date.parse(right.created_at);
  if (Number.isNaN(l) || Number.isNaN(r)) {
    return left.commit_id.localeCompare(right.commit_id);
  }
  if (l === r) {
    return left.commit_id.localeCompare(right.commit_id);
  }
  return l - r;
};

const shortPrompt = (value?: string): string => {
  if (!value) {
    return "No prompt";
  }
  const trimmed = value.trim();
  if (trimmed.length <= 40) {
    return trimmed;
  }
  return `${trimmed.slice(0, 39)}...`;
};

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

const layoutGraph = (items: HistoryItem[]): { nodes: PositionedNode[]; edges: Edge[]; maxDepth: number } => {
  const sorted = [...items].sort(byCreatedAtAsc);
  const byId = new Map(sorted.map((item) => [item.commit_id, item]));
  const children = new Map<string, HistoryItem[]>();

  for (const item of sorted) {
    if (!item.parent_commit_id) {
      continue;
    }
    if (!byId.has(item.parent_commit_id)) {
      continue;
    }
    const list = children.get(item.parent_commit_id) ?? [];
    list.push(item);
    children.set(item.parent_commit_id, list);
  }

  for (const list of children.values()) {
    list.sort(byCreatedAtAsc);
  }

  const roots = sorted.filter((item) => !item.parent_commit_id || !byId.has(item.parent_commit_id));
  roots.sort(byCreatedAtAsc);

  const nodes: PositionedNode[] = [];
  const edges: Edge[] = [];
  const placed = new Set<string>();
  let row = 0;
  let maxDepth = 0;

  const walk = (item: HistoryItem, depth: number) => {
    const node: PositionedNode = { item, depth, row };
    nodes.push(node);
    placed.add(item.commit_id);
    row += 1;
    maxDepth = Math.max(maxDepth, depth);

    for (const child of children.get(item.commit_id) ?? []) {
      const childNode: PositionedNode = { item: child, depth: depth + 1, row };
      edges.push({ from: node, to: childNode });
      walk(child, depth + 1);
    }
  };

  for (const root of roots) {
    if (!placed.has(root.commit_id)) {
      walk(root, 0);
    }
  }

  for (const item of sorted) {
    if (!placed.has(item.commit_id)) {
      walk(item, 0);
    }
  }

  const alignedEdges = edges
    .map((edge) => {
      const from = nodes.find((node) => node.item.commit_id === edge.from.item.commit_id);
      const to = nodes.find((node) => node.item.commit_id === edge.to.item.commit_id);
      return from && to ? { from, to } : null;
    })
    .filter((edge): edge is Edge => edge !== null);

  return { nodes, edges: alignedEdges, maxDepth };
};

export const LineageGraph = ({
  items,
  selectedCommitId,
  baselineCommitId,
  compareSelectionMode,
  compareSelectionCommitIds,
  resolveAssetUrl,
  onNodeClick,
  onPromptAction,
  onEvalAction,
  onDeleteAction
}: LineageGraphProps) => {
  const { nodes, edges, maxDepth } = useMemo(() => layoutGraph(items), [items]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [tooltipDirections, setTooltipDirections] = useState<Record<string, TooltipDirection>>({});

  const colWidth = 280;
  const rowHeight = 108;
  const padX = 28;
  const padY = 24;
  const nodeW = 224;
  const nodeH = 74;
  const width = Math.max(680, padX * 2 + (maxDepth + 1) * colWidth);
  const height = Math.max(320, padY * 2 + Math.max(nodes.length, 1) * rowHeight);

  const nodeX = (depth: number): number => padX + depth * colWidth;
  const nodeY = (row: number): number => padY + row * rowHeight;

  const updateTooltipDirection = (commitId: string, nodeElement: HTMLDivElement) => {
    if (!scrollRef.current) {
      return;
    }

    const containerRect = scrollRef.current.getBoundingClientRect();
    const nodeRect = nodeElement.getBoundingClientRect();
    const spaceAbove = nodeRect.top - containerRect.top;
    const spaceBelow = containerRect.bottom - nodeRect.bottom;
    const direction: TooltipDirection =
      spaceAbove < TOOLTIP_ESTIMATED_HEIGHT && spaceBelow >= spaceAbove ? "below" : "above";

    setTooltipDirections((prev) => (prev[commitId] === direction ? prev : { ...prev, [commitId]: direction }));
  };

  const safeResolveAssetUrl = typeof resolveAssetUrl === "function" ? resolveAssetUrl : (path?: string) => path;

  return (
    <div className="lineage-graph-scroll" ref={scrollRef}>
      <div className={`lineage-canvas${nodes.length === 0 ? " lineage-canvas--empty" : ""}`} style={{ width, height }}>
        {nodes.length === 0 ? (
          <div className="lineage-empty lineage-empty--canvas">
            No lineage data yet. Use Add First Commit in Commit History.
          </div>
        ) : null}
        <svg className="lineage-graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Commit lineage graph">
          {edges.map((edge) => {
            const fromX = nodeX(edge.from.depth) + nodeW;
            const fromY = nodeY(edge.from.row) + nodeH / 2;
            const toX = nodeX(edge.to.depth);
            const toY = nodeY(edge.to.row) + nodeH / 2;
            const controlOffset = Math.max(42, (toX - fromX) / 2);
            const d = `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`;
            return <path key={`${edge.from.item.commit_id}-${edge.to.item.commit_id}`} className="lineage-edge" d={d} />;
          })}
        </svg>

        {nodes.map((node) => {
          const x = nodeX(node.depth);
          const y = nodeY(node.row);
          const isSelected = selectedCommitId === node.item.commit_id;
          const isBaseline = baselineCommitId === node.item.commit_id;
          const compareIndex = compareSelectionCommitIds.indexOf(node.item.commit_id);
          const previewUrl = safeResolveAssetUrl(node.item.image_paths?.[0]);
          const tooltipDirection = tooltipDirections[node.item.commit_id] ?? "above";

          const classes = ["lineage-node-card"];
          if (isSelected) {
            classes.push("lineage-node-card--selected");
          }
          if (isBaseline) {
            classes.push("lineage-node-card--baseline");
          }
          if (compareIndex === 0) {
            classes.push("lineage-node-card--compare-a");
          } else if (compareIndex === 1) {
            classes.push("lineage-node-card--compare-b");
          }

          return (
            <div
              key={node.item.commit_id}
              className={classes.join(" ")}
              style={{ left: x, top: y, width: nodeW, minHeight: nodeH }}
              onMouseEnter={(event) => updateTooltipDirection(node.item.commit_id, event.currentTarget)}
              onFocusCapture={(event) => updateTooltipDirection(node.item.commit_id, event.currentTarget as HTMLDivElement)}
            >
              <button
                type="button"
                className="lineage-node-card__main"
                onClick={() => onNodeClick(node.item.commit_id)}
                aria-label={`Open commit ${node.item.commit_id}`}
              >
                <span className="lineage-node-card__title">{node.item.commit_id}</span>
                <span className="lineage-node-card__prompt">{shortPrompt(node.item.prompt)}</span>
                <span className="lineage-node-card__meta">{node.item.status}</span>
              </button>

              {compareSelectionMode && compareIndex >= 0 ? (
                <span className="lineage-node-card__marker">{compareIndex === 0 ? "A" : "B"}</span>
              ) : null}

              <div className="lineage-node-card__actions" role="group" aria-label={`Actions for ${node.item.commit_id}`}>
                <button
                  type="button"
                  className="lineage-icon-btn"
                  title="Add child prompt"
                  aria-label="Add child prompt"
                  onClick={() => onPromptAction(node.item.commit_id)}
                >
                  +
                </button>
                <button
                  type="button"
                  className="lineage-icon-btn"
                  title="Create eval"
                  aria-label="Create eval"
                  onClick={() => onEvalAction(node.item.commit_id)}
                >
                  E
                </button>
                <button
                  type="button"
                  className="lineage-icon-btn lineage-icon-btn--danger"
                  title="Delete node and descendants"
                  aria-label="Delete node and descendants"
                  onClick={() => onDeleteAction(node.item.commit_id)}
                >
                  x
                </button>
              </div>

              <div className={`lineage-node-card__tooltip lineage-node-card__tooltip--${tooltipDirection}`} role="tooltip">
                {previewUrl ? (
                  <img
                    className="lineage-node-card__tooltip-image"
                    src={previewUrl}
                    alt={`${node.item.commit_id} preview`}
                    loading="lazy"
                  />
                ) : null}
                <strong>{node.item.commit_id}</strong>
                <span>{node.item.status}</span>
                <span>{formatDate(node.item.created_at)}</span>
              </div>
            </div>
          );
        })}

      </div>
    </div>
  );
};
