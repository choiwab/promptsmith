import { describe, expect, it } from "vitest";
import { normalizeCompareResponse, normalizeHistoryResponse } from "./mappers";

describe("mappers", () => {
  it("normalizes compare response optional fields", () => {
    const response = normalizeCompareResponse({
      report_id: "r001",
      baseline_commit_id: "c001",
      candidate_commit_id: "c002",
      scores: {
        pixel_diff_score: 0.2,
        semantic_similarity: 0.8,
        vision_structural_score: 0.1,
        drift_score: 0.22,
        threshold: 0.3
      },
      verdict: "pass",
      explanation: {},
      artifacts: {}
    });

    expect(response.degraded).toBe(false);
    expect(response.artifacts.diff_heatmap).toBeUndefined();
    expect(response.artifacts.overlay).toBeUndefined();
  });

  it("sorts history in descending created_at order", () => {
    const history = normalizeHistoryResponse({
      items: [
        {
          commit_id: "c001",
          status: "success",
          created_at: "2026-02-27T10:00:00Z"
        },
        {
          commit_id: "c002",
          status: "success",
          created_at: "2026-02-28T10:00:00Z"
        }
      ]
    });

    expect(history.items[0]?.commit_id).toBe("c002");
  });
});
