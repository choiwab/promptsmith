import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { HistoryItem } from "../../api/types";

interface LineageGraphProps {
  items: HistoryItem[];
  selectedCommitId?: string;
  baselineCommitId?: string;
  compareSelectionMode: boolean;
  compareSelectionCommitIds: string[];
  resolveAssetUrl?: (path?: string) => string | undefined;
  positionsScopeKey: string;
  persistedNodePositions?: Record<string, NodePoint>;
  onNodePositionsChange?: (positions: Record<string, NodePoint>) => void;
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
type CanvasGestureMode = "pan" | "select";

const TOOLTIP_ESTIMATED_HEIGHT = 220;
const DRAG_START_THRESHOLD = 4;

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

interface NodePoint {
  x: number;
  y: number;
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NodeDragSession {
  pointerId: number;
  commitId: string;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  draggedIds: string[];
  initialPositions: Record<string, NodePoint>;
}

interface CanvasGestureSession {
  pointerId: number;
  mode: CanvasGestureMode;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
  moved: boolean;
  selectOrigin?: NodePoint;
}

const normalizeRect = (from: NodePoint, to: NodePoint): SelectionRect => {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  return { x, y, width, height };
};

const intersectsRect = (
  a: SelectionRect,
  b: { x: number; y: number; width: number; height: number }
): boolean => {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
};

const clampPosition = (value: NodePoint): NodePoint => ({
  x: Math.max(10, value.x),
  y: Math.max(10, value.y)
});

export const LineageGraph = ({
  items,
  selectedCommitId,
  baselineCommitId,
  compareSelectionMode,
  compareSelectionCommitIds,
  resolveAssetUrl,
  positionsScopeKey,
  persistedNodePositions,
  onNodePositionsChange,
  onNodeClick,
  onPromptAction,
  onEvalAction,
  onDeleteAction
}: LineageGraphProps) => {
  const { nodes, edges, maxDepth } = useMemo(() => layoutGraph(items), [items]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nodeDragRef = useRef<NodeDragSession | null>(null);
  const canvasGestureRef = useRef<CanvasGestureSession | null>(null);
  const suppressClickCommitRef = useRef<string | null>(null);
  const [tooltipDirections, setTooltipDirections] = useState<Record<string, TooltipDirection>>({});
  const [nodePositions, setNodePositions] = useState<Record<string, NodePoint>>(() => persistedNodePositions ?? {});
  const [multiSelectedCommitIds, setMultiSelectedCommitIds] = useState<string[]>([]);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isDraggingNodes, setIsDraggingNodes] = useState(false);

  const colWidth = 280;
  const rowHeight = 108;
  const padX = 28;
  const padY = 24;
  const nodeW = 224;
  const nodeH = 74;

  const defaultNodePositions = useMemo<Record<string, NodePoint>>(() => {
    const mapped: Record<string, NodePoint> = {};
    for (const node of nodes) {
      mapped[node.item.commit_id] = {
        x: padX + node.depth * colWidth,
        y: padY + node.row * rowHeight
      };
    }
    return mapped;
  }, [nodes]);

  useEffect(() => {
    setNodePositions(persistedNodePositions ?? {});
    setMultiSelectedCommitIds([]);
  }, [positionsScopeKey, persistedNodePositions]);

  useEffect(() => {
    setNodePositions((previous) => {
      const next: Record<string, NodePoint> = {};
      let changed = false;
      for (const node of nodes) {
        const commitId = node.item.commit_id;
        const existing = previous[commitId];
        const fallback = defaultNodePositions[commitId];
        next[commitId] = existing ?? fallback;
        if (!existing) {
          changed = true;
        }
      }
      if (!changed && Object.keys(previous).length !== Object.keys(next).length) {
        changed = true;
      }
      return changed ? next : previous;
    });
    setMultiSelectedCommitIds((previous) => previous.filter((id) => nodes.some((node) => node.item.commit_id === id)));
  }, [defaultNodePositions, nodes]);

  useEffect(() => {
    if (!onNodePositionsChange) {
      return;
    }
    onNodePositionsChange(nodePositions);
  }, [nodePositions, onNodePositionsChange]);

  const displayNodes = useMemo(() => {
    return nodes.map((node) => {
      const commitId = node.item.commit_id;
      const point = nodePositions[commitId] ?? defaultNodePositions[commitId];
      return {
        ...node,
        x: point.x,
        y: point.y
      };
    });
  }, [defaultNodePositions, nodePositions, nodes]);

  const nodeById = useMemo(() => {
    return new Map(displayNodes.map((node) => [node.item.commit_id, node]));
  }, [displayNodes]);

  const maxNodeX = displayNodes.length > 0 ? Math.max(...displayNodes.map((node) => node.x)) : padX;
  const maxNodeY = displayNodes.length > 0 ? Math.max(...displayNodes.map((node) => node.y)) : padY;
  const width = Math.max(680, padX * 2 + (maxDepth + 1) * colWidth, maxNodeX + nodeW + padX);
  const height = Math.max(320, padY * 2 + Math.max(nodes.length, 1) * rowHeight, maxNodeY + nodeH + padY);

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

  const toCanvasPoint = (clientX: number, clientY: number): NodePoint | null => {
    if (!scrollRef.current) {
      return null;
    }
    const rect = scrollRef.current.getBoundingClientRect();
    return {
      x: clientX - rect.left + scrollRef.current.scrollLeft,
      y: clientY - rect.top + scrollRef.current.scrollTop
    };
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest(".lineage-node-card")) {
      return;
    }
    const point = toCanvasPoint(event.clientX, event.clientY);
    if (!point || !scrollRef.current) {
      return;
    }

    const mode: CanvasGestureMode = event.shiftKey ? "select" : "pan";
    canvasGestureRef.current = {
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: scrollRef.current.scrollLeft,
      startScrollTop: scrollRef.current.scrollTop,
      moved: false,
      selectOrigin: mode === "select" ? point : undefined
    };
    if (mode === "select") {
      setSelectionRect({ x: point.x, y: point.y, width: 0, height: 0 });
    } else {
      setIsPanning(true);
    }
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = canvasGestureRef.current;
    if (!gesture || !scrollRef.current) {
      return;
    }
    const deltaX = event.clientX - gesture.startClientX;
    const deltaY = event.clientY - gesture.startClientY;
    if (!gesture.moved && Math.hypot(deltaX, deltaY) >= DRAG_START_THRESHOLD) {
      gesture.moved = true;
    }

    if (gesture.mode === "pan") {
      scrollRef.current.scrollLeft = gesture.startScrollLeft - deltaX;
      scrollRef.current.scrollTop = gesture.startScrollTop - deltaY;
      return;
    }

    const current = toCanvasPoint(event.clientX, event.clientY);
    if (!gesture.selectOrigin || !current) {
      return;
    }
    const nextRect = normalizeRect(gesture.selectOrigin, current);
    setSelectionRect(nextRect);
    setMultiSelectedCommitIds(
      displayNodes
        .filter((node) =>
          intersectsRect(nextRect, {
            x: node.x,
            y: node.y,
            width: nodeW,
            height: nodeH
          })
        )
        .map((node) => node.item.commit_id)
    );
  };

  const handleCanvasPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = canvasGestureRef.current;
    if (!gesture) {
      return;
    }
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (gesture.mode === "pan" && !gesture.moved) {
      setMultiSelectedCommitIds([]);
    }
    setIsPanning(false);
    setSelectionRect(null);
    canvasGestureRef.current = null;
  };

  const handleNodePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, commitId: string) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    const draggedIds = multiSelectedCommitIds.includes(commitId) ? multiSelectedCommitIds : [commitId];
    const initialPositions: Record<string, NodePoint> = {};
    for (const id of draggedIds) {
      const node = nodeById.get(id);
      if (node) {
        initialPositions[id] = { x: node.x, y: node.y };
      }
    }
    nodeDragRef.current = {
      pointerId: event.pointerId,
      commitId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
      draggedIds,
      initialPositions
    };
    if (!multiSelectedCommitIds.includes(commitId)) {
      setMultiSelectedCommitIds([commitId]);
    }
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handleNodePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = nodeDragRef.current;
    if (!drag) {
      return;
    }
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) >= DRAG_START_THRESHOLD) {
      drag.moved = true;
      setIsDraggingNodes(true);
    }
    if (!drag.moved) {
      return;
    }
    setNodePositions((previous) => {
      const next = { ...previous };
      for (const id of drag.draggedIds) {
        const base = drag.initialPositions[id];
        if (!base) {
          continue;
        }
        next[id] = clampPosition({
          x: base.x + deltaX,
          y: base.y + deltaY
        });
      }
      return next;
    });
  };

  const handleNodePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = nodeDragRef.current;
    if (!drag) {
      return;
    }
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) {
      suppressClickCommitRef.current = drag.commitId;
    }
    setIsDraggingNodes(false);
    nodeDragRef.current = null;
  };

  return (
    <div className={`lineage-graph-scroll${isPanning ? " lineage-graph-scroll--panning" : ""}`} ref={scrollRef}>
      <div
        className={`lineage-canvas${nodes.length === 0 ? " lineage-canvas--empty" : ""}${isDraggingNodes ? " lineage-canvas--dragging-nodes" : ""}`}
        style={{ width, height }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
      >
        {nodes.length === 0 ? (
          <div className="lineage-empty lineage-empty--canvas">
            No lineage data yet. Use Add First Commit in Commit History.
          </div>
        ) : null}
        <svg className="lineage-graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Commit lineage graph">
          {edges.map((edge) => {
            const fromNode = nodeById.get(edge.from.item.commit_id);
            const toNode = nodeById.get(edge.to.item.commit_id);
            if (!fromNode || !toNode) {
              return null;
            }
            const fromX = fromNode.x + nodeW;
            const fromY = fromNode.y + nodeH / 2;
            const toX = toNode.x;
            const toY = toNode.y + nodeH / 2;
            const controlOffset = Math.max(42, (toX - fromX) / 2);
            const d = `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`;
            return <path key={`${edge.from.item.commit_id}-${edge.to.item.commit_id}`} className="lineage-edge" d={d} />;
          })}
        </svg>

        {displayNodes.map((node) => {
          const x = node.x;
          const y = node.y;
          const isSelected = selectedCommitId === node.item.commit_id;
          const isBaseline = baselineCommitId === node.item.commit_id;
          const isMultiSelected = multiSelectedCommitIds.includes(node.item.commit_id);
          const compareIndex = compareSelectionCommitIds.indexOf(node.item.commit_id);
          const previewUrl = safeResolveAssetUrl(node.item.image_paths?.[0]);
          const tooltipDirection = tooltipDirections[node.item.commit_id] ?? "above";

          const classes = ["lineage-node-card"];
          if (isSelected) {
            classes.push("lineage-node-card--selected");
          }
          if (isMultiSelected) {
            classes.push("lineage-node-card--multi");
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
                onClick={() => {
                  if (suppressClickCommitRef.current === node.item.commit_id) {
                    suppressClickCommitRef.current = null;
                    return;
                  }
                  onNodeClick(node.item.commit_id);
                }}
                onPointerDown={(event) => handleNodePointerDown(event, node.item.commit_id)}
                onPointerMove={handleNodePointerMove}
                onPointerUp={handleNodePointerUp}
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
                  data-tooltip="Open Prompt Workbench to create a child commit from this node."
                  title="Open Prompt Workbench to create a child commit from this node."
                  aria-label="Add child prompt"
                  onClick={() => onPromptAction(node.item.commit_id)}
                >
                  +
                </button>
                <button
                  type="button"
                  className="lineage-icon-btn"
                  data-tooltip="Open Eval Workbench to run evaluations anchored to this commit."
                  title="Open Eval Workbench to run evaluations anchored to this commit."
                  aria-label="Create eval"
                  onClick={() => onEvalAction(node.item.commit_id)}
                >
                  E
                </button>
                <button
                  type="button"
                  className="lineage-icon-btn lineage-icon-btn--danger"
                  data-tooltip="Delete this commit and all descendant nodes."
                  title="Delete this commit and all descendant nodes."
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

        {selectionRect ? (
          <div
            className="lineage-selection-rect"
            style={{
              left: selectionRect.x,
              top: selectionRect.y,
              width: selectionRect.width,
              height: selectionRect.height
            }}
            aria-hidden="true"
          />
        ) : null}

      </div>
    </div>
  );
};
