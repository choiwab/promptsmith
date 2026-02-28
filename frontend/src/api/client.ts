import type {
  ApiErrorEnvelope,
  BaselineRequest,
  BaselineResponse,
  CompareRequest,
  CompareResponse,
  CreateEvalRunRequest,
  DeleteCommitResponse,
  DeleteProjectResponse,
  EnsureProjectRequest,
  EnsureProjectResponse,
  EvalRunResponse,
  GenerateRequest,
  GenerateResponse,
  HistoryResponse,
  ListProjectsResponse,
  RequestError
} from "./types";

const DEFAULT_TIMEOUT_MS = 130000;
const API_TIMEOUT_MS = (() => {
  const raw = import.meta.env.VITE_API_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_TIMEOUT_MS;
})();

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly requestId?: string;
  public readonly status: number;
  public readonly retryable: boolean;

  constructor(details: { code: string; message: string; requestId?: string; status: number; retryable: boolean }) {
    super(details.message);
    this.name = "ApiClientError";
    this.code = details.code;
    this.requestId = details.requestId;
    this.status = details.status;
    this.retryable = details.retryable;
  }

  toRequestError(operation: RequestError["operation"]): RequestError {
    return {
      code: this.code,
      message: this.message,
      requestId: this.requestId,
      status: this.status,
      operation,
      retryable: this.retryable
    };
  }
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async generate(payload: GenerateRequest): Promise<GenerateResponse> {
    return this.request<GenerateResponse>("/generate", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async setBaseline(payload: BaselineRequest): Promise<BaselineResponse> {
    return this.request<BaselineResponse>("/baseline", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async compare(payload: CompareRequest): Promise<CompareResponse> {
    return this.request<CompareResponse>("/compare", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async deleteCommit(projectId: string, commitId: string): Promise<DeleteCommitResponse> {
    const search = new URLSearchParams({ project_id: projectId });
    return this.request<DeleteCommitResponse>(`/commits/${encodeURIComponent(commitId)}?${search.toString()}`, {
      method: "DELETE"
    });
  }

  async createEvalRun(payload: CreateEvalRunRequest): Promise<EvalRunResponse> {
    return this.request<EvalRunResponse>("/eval-runs", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async getEvalRun(runId: string): Promise<EvalRunResponse> {
    return this.request<EvalRunResponse>(`/eval-runs/${encodeURIComponent(runId)}`, {
      method: "GET"
    });
  }

  async getHistory(projectId: string, limit = 20, cursor?: string): Promise<HistoryResponse> {
    const search = new URLSearchParams({
      project_id: projectId,
      limit: String(limit)
    });
    if (cursor) {
      search.set("cursor", cursor);
    }

    return this.request<HistoryResponse>(`/history?${search.toString()}`, {
      method: "GET"
    });
  }

  async ensureProject(payload: EnsureProjectRequest): Promise<EnsureProjectResponse> {
    return this.request<EnsureProjectResponse>("/projects", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async listProjects(): Promise<ListProjectsResponse> {
    return this.request<ListProjectsResponse>("/projects", {
      method: "GET"
    });
  }

  async deleteProject(projectId: string): Promise<DeleteProjectResponse> {
    return this.request<DeleteProjectResponse>(`/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE"
    });
  }

  resolveAssetUrl(path?: string): string | undefined {
    if (!path) {
      return undefined;
    }

    if (/^https?:\/\//.test(path)) {
      return path;
    }

    if (path.startsWith("/")) {
      return `${this.baseUrl}${path}`;
    }

    return `${this.baseUrl}/${path}`;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers || {})
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw await this.parseError(response);
      }

      return (await response.json()) as T;
    } catch (error: unknown) {
      if (error instanceof ApiClientError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiClientError({
          code: "REQUEST_TIMEOUT",
          message: "Request timed out. Please retry.",
          status: 0,
          retryable: true
        });
      }

      throw new ApiClientError({
        code: "API_UNAVAILABLE",
        message: "Cannot reach backend. Verify server is running and retry.",
        status: 0,
        retryable: true
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseError(response: Response): Promise<ApiClientError> {
    let parsed: Partial<ApiErrorEnvelope> | null = null;

    try {
      parsed = (await response.json()) as Partial<ApiErrorEnvelope>;
    } catch {
      parsed = null;
    }

    const code = parsed?.error?.code ?? "UNKNOWN_ERROR";
    const message = parsed?.error?.message ?? `Request failed with status ${response.status}.`;
    const requestId = parsed?.error?.request_id;
    const retryable = response.status >= 500 || response.status === 429;

    return new ApiClientError({
      code,
      message,
      requestId,
      status: response.status,
      retryable
    });
  }
}

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
export const apiClient = new ApiClient(apiBaseUrl);
