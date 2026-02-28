export type UIVerdict = "pass" | "fail" | "inconclusive";

export type AsyncState = "idle" | "loading" | "success" | "error";

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id?: string;
  };
}

export interface GenerateRequest {
  project_id: string;
  prompt: string;
  model: string;
  seed?: string;
}

export interface GenerateResponse {
  commit_id: string;
  status: string;
  image_paths: string[];
  created_at: string;
}

export interface BaselineRequest {
  project_id: string;
  commit_id: string;
}

export interface BaselineResponse {
  project_id: string;
  active_baseline_commit_id: string;
  updated_at: string;
}

export interface CompareRequest {
  project_id: string;
  candidate_commit_id: string;
}

export interface CompareScores {
  pixel_diff_score: number;
  semantic_similarity: number;
  vision_structural_score: number;
  drift_score: number;
  threshold: number;
}

export interface CompareArtifacts {
  diff_heatmap?: string;
  overlay?: string;
}

export interface CompareResponse {
  report_id: string;
  baseline_commit_id: string;
  candidate_commit_id: string;
  scores: CompareScores;
  verdict: UIVerdict;
  degraded?: boolean;
  explanation: Record<string, string | number | boolean | null>;
  artifacts: CompareArtifacts;
}

export interface HistoryItem {
  commit_id: string;
  prompt?: string;
  status: string;
  created_at: string;
  image_paths?: string[];
}

export interface HistoryResponse {
  items: HistoryItem[];
  next_cursor?: string;
  active_baseline_commit_id?: string;
}

export interface RequestError {
  code: string;
  message: string;
  requestId?: string;
  status: number;
  operation?: "history" | "generate" | "baseline" | "compare";
  retryable: boolean;
}

export interface AppToast {
  id: string;
  kind: "success" | "error" | "info";
  message: string;
}
