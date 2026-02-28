import type { AppToast, HistoryItem, RequestError } from "../api/types";
import { useAppStore } from "./store";

export const useHistory = (): HistoryItem[] => useAppStore((state) => state.history);
export const useBaselineCommitId = (): string | undefined => useAppStore((state) => state.activeBaselineCommitId);
export const useSelectedCommitId = (): string | undefined => useAppStore((state) => state.selectedCommitId);
export const useCompareResult = () => useAppStore((state) => state.latestCompareResult);
export const useRequestStates = () => useAppStore((state) => state.requestStates);
export const useLastError = (): RequestError | undefined => useAppStore((state) => state.lastError);
export const useToasts = (): AppToast[] => useAppStore((state) => state.toasts);
