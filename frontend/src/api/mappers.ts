import type { CompareResponse, HistoryResponse, HistoryItem } from "./types";

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

export const formatExplanationValue = (value: string | number | boolean | null): string => {
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  if (value === null) {
    return "n/a";
  }

  return String(value);
};
