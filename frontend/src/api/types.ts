export type UIVerdict = "pass" | "fail" | "inconclusive";

export type AsyncState = "idle" | "loading" | "success" | "error";
export type ObjectivePreset = "adherence" | "aesthetic" | "product";
export type ImageQuality = "low" | "medium" | "high";

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
  parent_commit_id?: string;
}

export interface GenerateResponse {
  commit_id: string;
  status: string;
  prompt: string;
  parent_commit_id?: string;
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
  parent_commit_id?: string;
  status: string;
  created_at: string;
  image_paths?: string[];
}

export interface HistoryResponse {
  items: HistoryItem[];
  next_cursor?: string;
  active_baseline_commit_id?: string;
}

export interface Project {
  project_id: string;
  name: string;
  active_baseline_commit_id?: string;
  created_at: string;
  updated_at: string;
}

export interface EnsureProjectRequest {
  project_id: string;
  name?: string;
}

export interface EnsureProjectResponse extends Project {
  created: boolean;
}

export interface ListProjectsResponse {
  items: Project[];
}

export interface EvalConstraints {
  must_include: string[];
  must_avoid: string[];
}

export interface CreateEvalRunRequest {
  project_id: string;
  base_prompt: string;
  objective_preset: ObjectivePreset;
  image_model: string;
  n_variants: number;
  quality: ImageQuality;
  parent_commit_id?: string;
  constraints?: Partial<EvalConstraints>;
}

export interface EvalProgress {
  total_variants: number;
  generated_variants: number;
  evaluated_variants: number;
  failed_variants: number;
}

export interface EvalVariant {
  variant_id: string;
  variant_prompt: string;
  mutation_tags: string[];
  parent_commit_id?: string | null;
  status: string;
  generation_latency_ms?: number | null;
  judge_latency_ms?: number | null;
  commit_id?: string | null;
  image_url?: string | null;
  rationale: string;
  confidence: number;
  prompt_adherence: number;
  subject_fidelity: number;
  composition_quality: number;
  style_coherence: number;
  technical_artifact_penalty: number;
  strength_tags: string[];
  failure_tags: string[];
  composite_score: number;
  rank?: number | null;
  error?: string | null;
}

export interface EvalSuggestion {
  prompt_text: string;
  rationale: string;
}

export interface EvalRunResponse {
  run_id: string;
  project_id: string;
  base_prompt: string;
  parent_commit_id?: string | null;
  anchor_commit_id?: string | null;
  objective_preset: ObjectivePreset;
  image_model: string;
  n_variants: number;
  quality: ImageQuality;
  constraints: EvalConstraints;
  status: string;
  stage: string;
  degraded: boolean;
  error?: string | null;
  progress: EvalProgress;
  variants: EvalVariant[];
  leaderboard: EvalVariant[];
  top_k: string[];
  suggestions: {
    conservative: EvalSuggestion;
    balanced: EvalSuggestion;
    aggressive: EvalSuggestion;
  };
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface RequestError {
  code: string;
  message: string;
  requestId?: string;
  status: number;
  operation?: "project" | "history" | "generate" | "baseline" | "compare" | "eval";
  retryable: boolean;
}

export interface AppToast {
  id: string;
  kind: "success" | "error" | "info";
  message: string;
}
