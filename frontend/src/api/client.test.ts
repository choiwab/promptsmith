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
});
