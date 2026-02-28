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
  it("renders primary panels", async () => {
    render(<App />);

    expect(screen.getByText("Prompt Workbench")).toBeInTheDocument();
    expect(screen.getByText("Commit History")).toBeInTheDocument();
    expect(screen.getByText("Compare Dashboard")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Set a baseline commit to run regression checks.")).toBeInTheDocument();
    });
  });
});
