import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LineageGraph } from "./LineageGraph";

const items = [
  {
    commit_id: "c001",
    status: "success",
    created_at: "2026-02-28T10:00:00Z",
    prompt: "root prompt"
  },
  {
    commit_id: "c002",
    status: "success",
    created_at: "2026-02-28T11:00:00Z",
    parent_commit_id: "c001",
    prompt: "child prompt"
  }
];

describe("LineageGraph", () => {
  it("invokes node action callbacks", () => {
    const onNodeClick = vi.fn();
    const onPromptAction = vi.fn();
    const onEvalAction = vi.fn();
    const onDeleteAction = vi.fn();

    render(
      <LineageGraph
        items={items}
        selectedCommitId="c001"
        baselineCommitId={undefined}
        compareSelectionMode={false}
        compareSelectionCommitIds={[]}
        positionsScopeKey="default"
        resolveAssetUrl={(path) => (path ? `http://localhost:8000${path}` : undefined)}
        onNodeClick={onNodeClick}
        onPromptAction={onPromptAction}
        onEvalAction={onEvalAction}
        onDeleteAction={onDeleteAction}
      />
    );

    fireEvent.click(screen.getAllByLabelText("Add child prompt")[0]);
    fireEvent.click(screen.getAllByLabelText("Create eval")[0]);
    fireEvent.click(screen.getAllByLabelText("Delete node and descendants")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Open commit c001" }));

    expect(onPromptAction).toHaveBeenCalledWith("c001");
    expect(onEvalAction).toHaveBeenCalledWith("c001");
    expect(onDeleteAction).toHaveBeenCalledWith("c001");
    expect(onNodeClick).toHaveBeenCalledWith("c001");
  });

  it("shows compare markers for selected pair", () => {
    render(
      <LineageGraph
        items={items}
        selectedCommitId={undefined}
        baselineCommitId={undefined}
        compareSelectionMode
        compareSelectionCommitIds={["c001", "c002"]}
        positionsScopeKey="default"
        resolveAssetUrl={(path) => (path ? `http://localhost:8000${path}` : undefined)}
        onNodeClick={vi.fn()}
        onPromptAction={vi.fn()}
        onEvalAction={vi.fn()}
        onDeleteAction={vi.fn()}
      />
    );

    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("B").length).toBeGreaterThan(0);
  });

  it("renders interactive canvas for drag and pan gestures", () => {
    const { container } = render(
      <LineageGraph
        items={items}
        selectedCommitId={undefined}
        baselineCommitId={undefined}
        compareSelectionMode={false}
        compareSelectionCommitIds={[]}
        positionsScopeKey="default"
        resolveAssetUrl={(path) => (path ? `http://localhost:8000${path}` : undefined)}
        onNodeClick={vi.fn()}
        onPromptAction={vi.fn()}
        onEvalAction={vi.fn()}
        onDeleteAction={vi.fn()}
      />
    );

    const scroll = container.querySelector(".lineage-graph-scroll");
    const canvas = container.querySelector(".lineage-canvas");
    const nodeMain = screen.getByRole("button", { name: "Open commit c001" });
    expect(scroll).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(nodeMain).toBeInTheDocument();

    if (!canvas) {
      return;
    }

    fireEvent.pointerDown(canvas, { button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 60 });
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 60 });
  });
});
