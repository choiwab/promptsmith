import { create } from "zustand";
import { apiClient, ApiClientError } from "../api/client";
import { normalizeCompareResponse, normalizeEvalRunResponse, normalizeHistoryResponse } from "../api/mappers";
import type {
  AppToast,
  AsyncState,
  CompareResponse,
  CreateEvalRunRequest,
  EvalRunResponse,
  HistoryItem,
  Project,
  RequestError
} from "../api/types";

type OperationKey = "project" | "history" | "generate" | "baseline" | "compare" | "eval" | "delete";

type LastOperation =
  | { kind: "project"; projectId: string; name?: string }
  | { kind: "projectDelete"; projectId: string }
  | { kind: "history" }
  | { kind: "generate"; prompt: string; model: string; seed?: string; parentCommitId?: string }
  | { kind: "baseline"; commitId: string }
  | { kind: "compare"; commitId: string; baselineCommitId?: string }
  | { kind: "eval"; payload: CreateEvalRunRequest }
  | { kind: "delete"; commitId: string }
  | null;

interface RequestStates {
  project: AsyncState;
  history: AsyncState;
  generate: AsyncState;
  baseline: AsyncState;
  compare: AsyncState;
  eval: AsyncState;
  delete: AsyncState;
}

interface AppState {
  projectId: string;
  projects: Project[];
  model: string;
  history: HistoryItem[];
  nextCursor?: string;
  activeBaselineCommitId?: string;
  selectedCommitId?: string;
  latestCompareResult?: CompareResponse;
  latestEvalRun?: EvalRunResponse;
  requestStates: RequestStates;
  lastError?: RequestError;
  lastOperation: LastOperation;
  toasts: AppToast[];
  promptModalOpen: boolean;
  promptModalAnchorCommitId?: string;
  evalModalOpen: boolean;
  evalModalAnchorCommitId?: string;
  compareModalOpen: boolean;
  commitInfoCommitId?: string;
  graphFullscreenOpen: boolean;
  compareSelectionMode: boolean;
  compareSelectionCommitIds: string[];
  deleteTargetCommitId?: string;
  setSelectedCommit: (commitId?: string) => void;
  dismissToast: (id: string) => void;
  pushToast: (kind: AppToast["kind"], message: string) => void;
  clearError: () => void;
  refreshProjects: () => Promise<void>;
  setProject: (projectId: string, name?: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  fetchHistory: () => Promise<void>;
  generateCommit: (prompt: string, seed?: string, parentCommitId?: string) => Promise<void>;
  setBaseline: (commitId: string) => Promise<void>;
  compareCommit: (commitId: string, baselineCommitId?: string) => Promise<void>;
  selectCompareNode: (commitId: string) => Promise<void>;
  toggleCompareSelectionMode: (enabled?: boolean) => void;
  deleteCommitSubtree: (commitId: string) => Promise<void>;
  requestDeleteCommit: (commitId?: string) => void;
  clearDeleteCommitRequest: () => void;
  openPromptModal: (anchorCommitId?: string) => void;
  closePromptModal: () => void;
  openEvalModal: (anchorCommitId?: string) => void;
  closeEvalModal: () => void;
  openCompareModal: () => void;
  closeCompareModal: () => void;
  openCommitInfoModal: (commitId: string) => void;
  closeCommitInfoModal: () => void;
  setGraphFullscreenOpen: (open: boolean) => void;
  runEvalPipeline: (payload: CreateEvalRunRequest) => Promise<void>;
  retryLastOperation: () => Promise<void>;
  resolveAssetUrl: (path?: string) => string | undefined;
}

const initialRequestStates: RequestStates = {
  project: "idle",
  history: "idle",
  generate: "idle",
  baseline: "idle",
  compare: "idle",
  eval: "idle",
  delete: "idle"
};

const toRequestError = (error: unknown, operation: OperationKey): RequestError => {
  if (error instanceof ApiClientError) {
    return error.toRequestError(operation);
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "An unexpected error occurred.",
    status: 0,
    operation,
    retryable: false
  };
};

const setRequestState = (state: AppState, operation: OperationKey, value: AsyncState): RequestStates => {
  return {
    ...state.requestStates,
    [operation]: value
  };
};

const pushToastState = (state: AppState, toast: AppToast): AppToast[] => {
  return [...state.toasts, toast].slice(-5);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const useAppStore = create<AppState>((set, get) => ({
  projectId: "default",
  projects: [],
  model: "gpt-image-1",
  history: [],
  nextCursor: undefined,
  activeBaselineCommitId: undefined,
  selectedCommitId: undefined,
  latestCompareResult: undefined,
  latestEvalRun: undefined,
  requestStates: initialRequestStates,
  lastError: undefined,
  lastOperation: null,
  toasts: [],
  promptModalOpen: false,
  promptModalAnchorCommitId: undefined,
  evalModalOpen: false,
  evalModalAnchorCommitId: undefined,
  compareModalOpen: false,
  commitInfoCommitId: undefined,
  graphFullscreenOpen: false,
  compareSelectionMode: false,
  compareSelectionCommitIds: [],
  deleteTargetCommitId: undefined,

  setSelectedCommit: (commitId) => {
    set({ selectedCommitId: commitId });
  },

  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    }));
  },

  pushToast: (kind, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({
      toasts: pushToastState(state, { id, kind, message })
    }));
  },

  clearError: () => {
    set({ lastError: undefined });
  },

  refreshProjects: async () => {
    try {
      const response = await apiClient.listProjects();
      set({ projects: response.items });
    } catch {
      // Keep project listing best-effort so the app remains usable even if listing fails.
    }
  },

  setProject: async (projectId, name) => {
    const trimmedProjectId = projectId.trim();
    const trimmedName = name?.trim() || undefined;
    if (!trimmedProjectId) {
      return;
    }

    set((state) => ({
      requestStates: setRequestState(state, "project", "loading"),
      lastError: undefined,
      lastOperation: { kind: "project", projectId: trimmedProjectId, name: trimmedName }
    }));

    try {
      const response = await apiClient.ensureProject({
        project_id: trimmedProjectId,
        name: trimmedName
      });

      set((state) => ({
        projectId: response.project_id,
        history: [],
        nextCursor: undefined,
        activeBaselineCommitId: response.active_baseline_commit_id,
        selectedCommitId: undefined,
        latestCompareResult: undefined,
        latestEvalRun: undefined,
        requestStates: setRequestState(state, "project", "success")
      }));

      await Promise.all([get().fetchHistory(), get().refreshProjects()]);
    } catch (error: unknown) {
      const parsed = toRequestError(error, "project");
      set((state) => ({
        requestStates: setRequestState(state, "project", "error"),
        lastError: parsed,
        toasts: pushToastState(state, {
          id: `${Date.now()}-project-error`,
          kind: "error",
          message: `${parsed.code}: ${parsed.message}`
        })
      }));
    }
  },

  deleteProject: async (projectId) => {
    const targetProjectId = projectId.trim();
    if (!targetProjectId) {
      return;
    }

    set((state) => ({
      requestStates: setRequestState(state, "project", "loading"),
      lastError: undefined,
      lastOperation: { kind: "projectDelete", projectId: targetProjectId }
    }));

    try {
      await apiClient.deleteProject(targetProjectId);
      const wasActiveProject = get().projectId === targetProjectId;

      set((state) => ({
        projects: state.projects.filter((project) => project.project_id !== targetProjectId),
        requestStates: setRequestState(state, "project", "success"),
        toasts: pushToastState(state, {
          id: `${Date.now()}-project-delete`,
          kind: "success",
          message: `Deleted project ${targetProjectId}.`
        })
      }));

      if (wasActiveProject) {
        const fallbackProjectId =
          get().projects.find((project) => project.project_id !== targetProjectId)?.project_id ?? "default";
        await get().setProject(fallbackProjectId);
        return;
      }

      await get().refreshProjects();
    } catch (error: unknown) {
      const parsed = toRequestError(error, "project");
      set((state) => ({
        requestStates: setRequestState(state, "project", "error"),
        lastError: parsed,
        toasts: pushToastState(state, {
          id: `${Date.now()}-project-delete-error`,
          kind: "error",
          message: `${parsed.code}: ${parsed.message}`
        })
      }));
    }
  },

  fetchHistory: async () => {
    set((state) => ({
      requestStates: setRequestState(state, "history", "loading"),
      lastError: undefined,
      lastOperation: { kind: "history" }
    }));

    try {
      const response = normalizeHistoryResponse(await apiClient.getHistory(get().projectId));

      set((state) => {
        const selectedCommitId =
          state.selectedCommitId && response.items.some((item) => item.commit_id === state.selectedCommitId)
            ? state.selectedCommitId
            : response.items[0]?.commit_id;

        const compareSelectionCommitIds = state.compareSelectionCommitIds.filter((id) =>
          response.items.some((item) => item.commit_id === id)
        );

        return {
          history: response.items,
          nextCursor: response.next_cursor,
          activeBaselineCommitId: response.active_baseline_commit_id ?? state.activeBaselineCommitId,
          selectedCommitId,
          compareSelectionCommitIds,
          requestStates: setRequestState(state, "history", "success")
        };
      });
    } catch (error: unknown) {
      const parsed = toRequestError(error, "history");

      if (parsed.code === "PROJECT_NOT_FOUND") {
        try {
          await apiClient.ensureProject({ project_id: get().projectId });
          const response = normalizeHistoryResponse(await apiClient.getHistory(get().projectId));

          set((state) => {
            const selectedCommitId =
              state.selectedCommitId && response.items.some((item) => item.commit_id === state.selectedCommitId)
                ? state.selectedCommitId
                : response.items[0]?.commit_id;

            return {
              history: response.items,
              nextCursor: response.next_cursor,
              activeBaselineCommitId: response.active_baseline_commit_id ?? state.activeBaselineCommitId,
              selectedCommitId,
              requestStates: setRequestState(state, "history", "success")
            };
          });
          return;
        } catch {
          // Keep the original project-not-found error if ensure+retry fails.
        }
      }

      set((state) => ({
        requestStates: setRequestState(state, "history", "error"),
        lastError: parsed
      }));
    }
  },

  generateCommit: async (prompt, seed, parentCommitId) => {
    const startedAtMs = Date.now();
    const knownCommitIds = new Set(get().history.map((item) => item.commit_id));

    set((state) => ({
      requestStates: setRequestState(state, "generate", "loading"),
      lastError: undefined,
      lastOperation: { kind: "generate", prompt, model: state.model, seed, parentCommitId }
    }));

    try {
      const response = await apiClient.generate({
        project_id: get().projectId,
        prompt,
        model: get().model,
        seed: seed || undefined,
        parent_commit_id: parentCommitId || undefined
      });

      set((state) => {
        const generatedItem: HistoryItem = {
          commit_id: response.commit_id,
          status: response.status,
          created_at: response.created_at,
          prompt: response.prompt || prompt,
          parent_commit_id: response.parent_commit_id,
          image_paths: response.image_paths,
          model: state.model,
          seed
        };

        const existing = state.history.find((item) => item.commit_id === response.commit_id);
        const history = existing ? state.history : [generatedItem, ...state.history];

        return {
          history,
          selectedCommitId: response.commit_id,
          requestStates: setRequestState(state, "generate", "success"),
          toasts: pushToastState(state, {
            id: `${Date.now()}-gen`,
            kind: "success",
            message: `Generated ${response.commit_id}.`
          })
        };
      });

      await get().fetchHistory();
    } catch (error: unknown) {
      const parsed = toRequestError(error, "generate");

      if (parsed.code === "REQUEST_TIMEOUT") {
        try {
          const historyResponse = normalizeHistoryResponse(await apiClient.getHistory(get().projectId));
          const recoveredCommit = historyResponse.items.find((item) => {
            if (knownCommitIds.has(item.commit_id)) {
              return false;
            }
            if (item.status !== "success" || item.prompt !== prompt) {
              return false;
            }

            const createdAtMs = Date.parse(item.created_at);
            if (Number.isNaN(createdAtMs)) {
              return true;
            }
            return createdAtMs >= startedAtMs - 120_000;
          });

          if (recoveredCommit) {
            set((state) => ({
              history: historyResponse.items,
              nextCursor: historyResponse.next_cursor,
              activeBaselineCommitId: historyResponse.active_baseline_commit_id ?? state.activeBaselineCommitId,
              selectedCommitId: recoveredCommit.commit_id,
              requestStates: setRequestState(state, "generate", "success"),
              lastError: undefined,
              toasts: pushToastState(state, {
                id: `${Date.now()}-gen-timeout-recovered`,
                kind: "success",
                message: `Generation completed as ${recoveredCommit.commit_id}.`
              })
            }));
            return;
          }

          set((state) => ({
            history: historyResponse.items,
            nextCursor: historyResponse.next_cursor,
            activeBaselineCommitId: historyResponse.active_baseline_commit_id ?? state.activeBaselineCommitId
          }));
        } catch {
          // Keep the original timeout error if follow-up history reconciliation fails.
        }
      }

      set((state) => ({
        requestStates: setRequestState(state, "generate", "error"),
        lastError: parsed,
        toasts: pushToastState(state, {
          id: `${Date.now()}-gen-error`,
          kind: "error",
          message: `${parsed.code}: ${parsed.message}`
        })
      }));
    }
  },

  setBaseline: async (commitId) => {
    set((state) => ({
      requestStates: setRequestState(state, "baseline", "loading"),
      lastError: undefined,
      lastOperation: { kind: "baseline", commitId }
    }));

    try {
      const response = await apiClient.setBaseline({
        project_id: get().projectId,
        commit_id: commitId
      });

      set((state) => ({
        activeBaselineCommitId: response.active_baseline_commit_id,
        requestStates: setRequestState(state, "baseline", "success"),
        toasts: pushToastState(state, {
          id: `${Date.now()}-baseline`,
          kind: "success",
          message: `Baseline set to ${response.active_baseline_commit_id}.`
        })
      }));
    } catch (error: unknown) {
      const parsed = toRequestError(error, "baseline");
      set((state) => ({
        requestStates: setRequestState(state, "baseline", "error"),
        lastError: parsed,
        toasts: pushToastState(state, {
          id: `${Date.now()}-baseline-error`,
          kind: "error",
          message: `${parsed.code}: ${parsed.message}`
        })
      }));
    }
  },

  compareCommit: async (commitId, baselineCommitId) => {
    const fallbackBaselineId = get().activeBaselineCommitId;
    const resolvedBaselineId = baselineCommitId ?? fallbackBaselineId;

    if (!resolvedBaselineId) {
      const error: RequestError = {
        code: "BASELINE_NOT_SET",
        message: "Set a baseline commit to run regression checks.",
        status: 400,
        operation: "compare",
        retryable: false
      };

      set((state) => ({
        lastError: error,
        requestStates: setRequestState(state, "compare", "error"),
        compareModalOpen: true
      }));
      return;
    }

    set((state) => ({
      requestStates: setRequestState(state, "compare", "loading"),
      selectedCommitId: commitId,
      lastError: undefined,
      lastOperation: { kind: "compare", commitId, baselineCommitId: resolvedBaselineId },
      compareModalOpen: true,
      latestCompareResult: undefined,
      compareSelectionMode: false
    }));

    try {
      const response = normalizeCompareResponse(
        await apiClient.compare({
          project_id: get().projectId,
          candidate_commit_id: commitId,
          baseline_commit_id: resolvedBaselineId
        })
      );

      set((state) => ({
        latestCompareResult: response,
        requestStates: setRequestState(state, "compare", "success"),
        compareSelectionCommitIds: []
      }));
    } catch (error: unknown) {
      const parsed = toRequestError(error, "compare");
      set((state) => ({
        requestStates: setRequestState(state, "compare", "error"),
        lastError: parsed,
        compareSelectionCommitIds: [],
        toasts: pushToastState(state, {
          id: `${Date.now()}-compare-error`,
          kind: "error",
          message: `${parsed.code}: ${parsed.message}`
        })
      }));
    }
  },

  toggleCompareSelectionMode: (enabled) => {
    set((state) => {
      const next = typeof enabled === "boolean" ? enabled : !state.compareSelectionMode;
      return {
        compareSelectionMode: next,
        compareSelectionCommitIds: next ? state.compareSelectionCommitIds : []
      };
    });
  },

  selectCompareNode: async (commitId) => {
    const state = get();
    if (!state.compareSelectionMode) {
      return;
    }

    if (state.compareSelectionCommitIds.includes(commitId)) {
      return;
    }

    if (state.compareSelectionCommitIds.length === 0) {
      set({ compareSelectionCommitIds: [commitId], selectedCommitId: commitId });
      return;
    }

    const baselineCommitId = state.compareSelectionCommitIds[0];
    set({
      compareSelectionCommitIds: [baselineCommitId, commitId],
      compareSelectionMode: false,
      selectedCommitId: commitId
    });
    await get().compareCommit(commitId, baselineCommitId);
    set({ compareSelectionCommitIds: [] });
  },

  requestDeleteCommit: (commitId) => {
    set({ deleteTargetCommitId: commitId });
  },

  clearDeleteCommitRequest: () => {
    set({ deleteTargetCommitId: undefined });
  },

  deleteCommitSubtree: async (commitId) => {
    set((state) => ({
      requestStates: setRequestState(state, "delete", "loading"),
      lastError: undefined,
      lastOperation: { kind: "delete", commitId }
    }));

    try {
      const response = await apiClient.deleteCommit(get().projectId, commitId);
      const deletedIds = new Set(response.deleted_commit_ids);

      set((state) => {
        const history = state.history.filter((item) => !deletedIds.has(item.commit_id));
        const selectedCommitId = state.selectedCommitId && deletedIds.has(state.selectedCommitId)
          ? history[0]?.commit_id
          : state.selectedCommitId;
        const latestCompareResult =
          state.latestCompareResult &&
          (deletedIds.has(state.latestCompareResult.baseline_commit_id) ||
            deletedIds.has(state.latestCompareResult.candidate_commit_id))
            ? undefined
            : state.latestCompareResult;

        return {
          history,
          selectedCommitId,
          latestCompareResult,
          activeBaselineCommitId: response.active_baseline_commit_id,
          deleteTargetCommitId: undefined,
          requestStates: setRequestState(state, "delete", "success"),
          commitInfoCommitId: state.commitInfoCommitId && deletedIds.has(state.commitInfoCommitId) ? undefined : state.commitInfoCommitId,
          toasts: pushToastState(state, {
            id: `${Date.now()}-delete-success`,
            kind: "success",
            message: `Deleted ${response.deleted_commit_ids.length} commit(s).`
          })
        };
      });

      await get().fetchHistory();
    } catch (error: unknown) {
      const parsed = toRequestError(error, "delete");
      set((state) => ({
        requestStates: setRequestState(state, "delete", "error"),
        lastError: parsed,
        toasts: pushToastState(state, {
          id: `${Date.now()}-delete-error`,
          kind: "error",
          message: `${parsed.code}: ${parsed.message}`
        })
      }));
    }
  },

  openPromptModal: (anchorCommitId) => {
    set({
      promptModalOpen: true,
      promptModalAnchorCommitId: anchorCommitId,
      selectedCommitId: anchorCommitId ?? get().selectedCommitId
    });
  },

  closePromptModal: () => {
    set({ promptModalOpen: false, promptModalAnchorCommitId: undefined });
  },

  openEvalModal: (anchorCommitId) => {
    set({
      evalModalOpen: true,
      evalModalAnchorCommitId: anchorCommitId,
      selectedCommitId: anchorCommitId ?? get().selectedCommitId
    });
  },

  closeEvalModal: () => {
    set({ evalModalOpen: false, evalModalAnchorCommitId: undefined });
  },

  openCompareModal: () => {
    set({ compareModalOpen: true });
  },

  closeCompareModal: () => {
    set({ compareModalOpen: false });
  },

  openCommitInfoModal: (commitId) => {
    set({
      commitInfoCommitId: commitId,
      selectedCommitId: commitId
    });
  },

  closeCommitInfoModal: () => {
    set({ commitInfoCommitId: undefined });
  },

  setGraphFullscreenOpen: (open) => {
    set({ graphFullscreenOpen: open });
  },

  runEvalPipeline: async (payload) => {
    const normalizedPayload: CreateEvalRunRequest = {
      ...payload,
      constraints: {
        must_include: payload.constraints?.must_include ?? [],
        must_avoid: payload.constraints?.must_avoid ?? []
      }
    };

    set((state) => ({
      requestStates: setRequestState(state, "eval", "loading"),
      lastError: undefined,
      lastOperation: { kind: "eval", payload: normalizedPayload }
    }));

    try {
      let currentRun = normalizeEvalRunResponse(await apiClient.createEvalRun(normalizedPayload));
      set({ latestEvalRun: currentRun });

      const terminalStatuses = new Set(["completed", "completed_degraded", "failed"]);
      for (let attempt = 0; attempt < 90; attempt += 1) {
        if (terminalStatuses.has(currentRun.status)) {
          break;
        }

        await sleep(1200);
        currentRun = normalizeEvalRunResponse(await apiClient.getEvalRun(currentRun.run_id));
        set({ latestEvalRun: currentRun });
      }

      if (currentRun.status === "failed") {
        const failure: RequestError = {
          code: "EVAL_RUN_FAILED",
          message: currentRun.error || "Eval run failed.",
          status: 500,
          operation: "eval",
          retryable: true
        };
        set((state) => ({
          requestStates: setRequestState(state, "eval", "error"),
          lastError: failure,
          toasts: pushToastState(state, {
            id: `${Date.now()}-eval-failed`,
            kind: "error",
            message: failure.message
          })
        }));
        return;
      }

      if (!terminalStatuses.has(currentRun.status)) {
        set((state) => ({
          requestStates: setRequestState(state, "eval", "success"),
          toasts: pushToastState(state, {
            id: `${Date.now()}-eval-running`,
            kind: "info",
            message: `Eval run ${currentRun.run_id} is still running in background.`
          })
        }));
        return;
      }

      set((state) => ({
        requestStates: setRequestState(state, "eval", "success"),
        latestEvalRun: currentRun,
        toasts: pushToastState(state, {
          id: `${Date.now()}-eval-success`,
          kind: currentRun.degraded ? "info" : "success",
          message: currentRun.degraded
            ? `Eval ${currentRun.run_id} completed in degraded mode.`
            : `Eval ${currentRun.run_id} completed.`
        })
      }));

      await get().fetchHistory();
      set({ lastOperation: { kind: "eval", payload: normalizedPayload } });
    } catch (error: unknown) {
      const parsed = toRequestError(error, "eval");
      set((state) => ({
        requestStates: setRequestState(state, "eval", "error"),
        lastError: parsed,
        toasts: pushToastState(state, {
          id: `${Date.now()}-eval-error`,
          kind: "error",
          message: `${parsed.code}: ${parsed.message}`
        })
      }));
    }
  },

  retryLastOperation: async () => {
    const op = get().lastOperation;
    if (!op) {
      return;
    }

    if (op.kind === "history") {
      await get().fetchHistory();
      return;
    }

    if (op.kind === "project") {
      await get().setProject(op.projectId, op.name);
      return;
    }

    if (op.kind === "projectDelete") {
      await get().deleteProject(op.projectId);
      return;
    }

    if (op.kind === "generate") {
      await get().generateCommit(op.prompt, op.seed, op.parentCommitId);
      return;
    }

    if (op.kind === "baseline") {
      await get().setBaseline(op.commitId);
      return;
    }

    if (op.kind === "eval") {
      await get().runEvalPipeline(op.payload);
      return;
    }

    if (op.kind === "delete") {
      await get().deleteCommitSubtree(op.commitId);
      return;
    }

    await get().compareCommit(op.commitId, op.baselineCommitId);
  },

  resolveAssetUrl: (path) => {
    return apiClient.resolveAssetUrl(path);
  }
}));
