import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

beforeEach(() => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      items: [],
      next_cursor: null
    })
  });

  vi.stubGlobal("fetch", fetchMock);
});

describe("App smoke", () => {
  it("renders dashboard shell without inline workbench panels", async () => {
    render(<App />);

    expect(screen.getByText("Commit History")).toBeInTheDocument();
    expect(screen.getByText("Lineage Graph")).toBeInTheDocument();
    expect(screen.queryByText("Eval Workbench")).not.toBeInTheDocument();
    expect(screen.queryByText("Prompt Workbench")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("No commits yet. Generate your first commit.")).toBeInTheDocument();
    });
  });
});
