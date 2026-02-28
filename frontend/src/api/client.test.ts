import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient", () => {
  it("parses API error envelopes from non-2xx responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: "BASELINE_NOT_SET",
          message: "Set a baseline before comparing commits.",
          request_id: "req_123"
        }
      })
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("http://localhost:8000");

    await expect(client.compare({ project_id: "default", candidate_commit_id: "c0002" })).rejects.toMatchObject({
      code: "BASELINE_NOT_SET",
      message: "Set a baseline before comparing commits.",
      status: 400,
      requestId: "req_123"
    });
  });

  it("maps network failures to API_UNAVAILABLE", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("http://localhost:8000");

    await expect(client.getHistory("default")).rejects.toBeInstanceOf(ApiClientError);
    await expect(client.getHistory("default")).rejects.toMatchObject({
      code: "API_UNAVAILABLE",
      retryable: true,
      status: 0
    });
  });

  it("sends explicit baseline_commit_id when provided for compare", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        report_id: "r001",
        baseline_commit_id: "c001",
        candidate_commit_id: "c002",
        scores: {
          pixel_diff_score: 0.1,
          semantic_similarity: 0.9,
          vision_structural_score: 0.1,
          drift_score: 0.1,
          threshold: 0.3
        },
        verdict: "pass",
        explanation: {},
        artifacts: {}
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("http://localhost:8000");
    await client.compare({ project_id: "default", baseline_commit_id: "c001", candidate_commit_id: "c002" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("\"baseline_commit_id\":\"c001\"");
  });

  it("calls delete commit subtree endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        project_id: "default",
        deleted_commit_ids: ["c1", "c2"],
        deleted_report_ids: ["r1"],
        deleted_image_objects: 1,
        active_baseline_commit_id: null
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient("http://localhost:8000");
    await client.deleteCommit("default", "c1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]?.[0];
    expect(String(url)).toContain("/commits/c1?project_id=default");
  });
});
