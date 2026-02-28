import type { CompareResponse, EvalRunResponse, HistoryResponse, HistoryItem } from "./types";

const byCreatedAtDesc = (a: HistoryItem, b: HistoryItem): number => {
  const left = new Date(a.created_at).getTime();
  const right = new Date(b.created_at).getTime();
  return right - left;
};

export const normalizeHistoryResponse = (input: HistoryResponse): HistoryResponse => {
  return {
    ...input,
    items: [...input.items].sort(byCreatedAtDesc)
  };
};

export const normalizeCompareResponse = (input: CompareResponse): CompareResponse => {
  return {
    ...input,
    degraded: Boolean(input.degraded),
    explanation: input.explanation ?? {},
    artifacts: {
      diff_heatmap: input.artifacts?.diff_heatmap,
      overlay: input.artifacts?.overlay
    }
  };
};

export const normalizeEvalRunResponse = (input: EvalRunResponse): EvalRunResponse => {
  return {
    ...input,
    degraded: Boolean(input.degraded),
    variants: Array.isArray(input.variants) ? input.variants : [],
    leaderboard: Array.isArray(input.leaderboard) ? input.leaderboard : [],
    top_k: Array.isArray(input.top_k) ? input.top_k : [],
    suggestions: {
      conservative: input.suggestions?.conservative ?? { prompt_text: "", rationale: "" },
      balanced: input.suggestions?.balanced ?? { prompt_text: "", rationale: "" },
      aggressive: input.suggestions?.aggressive ?? { prompt_text: "", rationale: "" }
    }
  };
};

export const formatExplanationValue = (value: string | number | boolean | null): string => {
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  if (value === null) {
    return "n/a";
  }

  return String(value);
};
