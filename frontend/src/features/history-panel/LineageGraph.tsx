import { useMemo } from "react";
import type { HistoryItem } from "../../api/types";

interface LineageGraphProps {
  items: HistoryItem[];
  selectedCommitId?: string;
  baselineCommitId?: string;
  onSelect: (commitId: string) => void;
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
  if (trimmed.length <= 28) {
    return trimmed;
  }
  return `${trimmed.slice(0, 27)}...`;
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

export const LineageGraph = ({ items, selectedCommitId, baselineCommitId, onSelect }: LineageGraphProps) => {
  const { nodes, edges, maxDepth } = useMemo(() => layoutGraph(items), [items]);

  if (nodes.length === 0) {
    return <div className="lineage-empty">No lineage data yet.</div>;
  }

  const colWidth = 230;
  const rowHeight = 78;
  const padX = 28;
  const padY = 24;
  const nodeW = 184;
  const nodeH = 46;
  const width = padX * 2 + (maxDepth + 1) * colWidth;
  const height = Math.max(160, padY * 2 + nodes.length * rowHeight);

  const nodeX = (depth: number): number => padX + depth * colWidth;
  const nodeY = (row: number): number => padY + row * rowHeight;

  return (
    <div className="lineage-graph-scroll">
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

        {nodes.map((node) => {
          const x = nodeX(node.depth);
          const y = nodeY(node.row);
          const isSelected = selectedCommitId === node.item.commit_id;
          const isBaseline = baselineCommitId === node.item.commit_id;
          const stateClass = isSelected ? " lineage-node--selected" : isBaseline ? " lineage-node--baseline" : "";
          return (
            <g
              key={node.item.commit_id}
              className={`lineage-node${stateClass}`}
              onClick={() => onSelect(node.item.commit_id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(node.item.commit_id);
                }
              }}
            >
              <rect x={x} y={y} width={nodeW} height={nodeH} rx={8} />
              <text x={x + 10} y={y + 18} className="lineage-node__title">
                {node.item.commit_id}
              </text>
              <text x={x + 10} y={y + 35} className="lineage-node__prompt">
                {shortPrompt(node.item.prompt)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
