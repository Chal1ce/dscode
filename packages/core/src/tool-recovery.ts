import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const TOOL_DISPATCH_ENTRY = "dscode-tool-dispatch";
export const TOOL_RECOVERY_ENTRY = "dscode-tool-recovery";
export const TOOL_RECOVERY_SCHEMA_VERSION = 1 as const;

export type ToolDispatchState = "started" | "completed" | "failed" | "blocked";
export type ToolRecoveryClassification =
  | "tool_not_started"
  | "tool_outcome_unknown"
  | "interrupted";
export type ToolRecoverySource = "session_start" | "session_tree" | "session_shutdown";

export interface ToolDispatchMarker {
  schemaVersion: typeof TOOL_RECOVERY_SCHEMA_VERSION;
  state: ToolDispatchState;
  toolCallId: string;
  toolName: string;
}

export interface ToolRecoveryMarker {
  schemaVersion: typeof TOOL_RECOVERY_SCHEMA_VERSION;
  classification: ToolRecoveryClassification;
  source: ToolRecoverySource;
  toolCallId: string;
  toolName: string;
}

export interface PendingToolRecovery {
  classification: ToolRecoveryClassification;
  toolCallId: string;
  toolName: string;
}

export function createToolDispatchMarker(
  toolCallId: string,
  toolName: string,
  state: ToolDispatchState,
): ToolDispatchMarker {
  return {
    schemaVersion: TOOL_RECOVERY_SCHEMA_VERSION,
    state,
    toolCallId,
    toolName,
  };
}

export function createToolRecoveryMarker(
  pending: PendingToolRecovery,
  source: ToolRecoverySource,
): ToolRecoveryMarker {
  return {
    schemaVersion: TOOL_RECOVERY_SCHEMA_VERSION,
    classification: pending.classification,
    source,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
  };
}

export function restoreToolDispatchStates(
  entries: readonly SessionEntry[],
): Map<string, ToolDispatchMarker> {
  const states = new Map<string, ToolDispatchMarker>();
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== TOOL_DISPATCH_ENTRY) continue;
    const marker = parseToolDispatchMarker(entry.data);
    if (marker) states.set(marker.toolCallId, marker);
  }
  return states;
}

export function restoreToolRecoveryMarkers(
  entries: readonly SessionEntry[],
): ToolRecoveryMarker[] {
  const markers: ToolRecoveryMarker[] = [];
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== TOOL_RECOVERY_ENTRY) continue;
    const marker = parseToolRecoveryMarker(entry.data);
    if (marker) markers.push(marker);
  }
  return markers;
}

export function findPendingToolRecoveries(
  entries: readonly SessionEntry[],
  source: ToolRecoverySource,
): PendingToolRecovery[] {
  const calls = new Map<string, string>();
  const toolResults = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    if (entry.message.role === "toolResult") {
      if (typeof entry.message.toolCallId === "string") toolResults.add(entry.message.toolCallId);
      continue;
    }
    if (entry.message.role !== "assistant") continue;
    for (const content of entry.message.content) {
      if (!isRecord(content) || content.type !== "toolCall") continue;
      if (typeof content.id !== "string" || typeof content.name !== "string") continue;
      calls.set(content.id, content.name);
    }
  }

  const dispatchStates = restoreToolDispatchStates(entries);
  const recoveries: PendingToolRecovery[] = [];
  for (const [toolCallId, toolName] of calls) {
    if (toolResults.has(toolCallId)) continue;
    const dispatch = dispatchStates.get(toolCallId);
    if (dispatch?.state === "completed" || dispatch?.state === "failed" || dispatch?.state === "blocked") {
      continue;
    }
    recoveries.push({
      classification:
        dispatch?.state === "started"
          ? source === "session_shutdown"
            ? "interrupted"
            : "tool_outcome_unknown"
          : "tool_not_started",
      toolCallId,
      toolName,
    });
  }
  return recoveries;
}

export function toolRecoveryKey(toolCallId: string, classification: ToolRecoveryClassification): string {
  return `${toolCallId}\n${classification}`;
}

function parseToolDispatchMarker(value: unknown): ToolDispatchMarker | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== TOOL_RECOVERY_SCHEMA_VERSION ||
    typeof value.toolCallId !== "string" ||
    typeof value.toolName !== "string" ||
    !isToolDispatchState(value.state)
  ) {
    return undefined;
  }
  return {
    schemaVersion: TOOL_RECOVERY_SCHEMA_VERSION,
    state: value.state,
    toolCallId: value.toolCallId,
    toolName: value.toolName,
  };
}

function parseToolRecoveryMarker(value: unknown): ToolRecoveryMarker | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== TOOL_RECOVERY_SCHEMA_VERSION ||
    typeof value.toolCallId !== "string" ||
    typeof value.toolName !== "string" ||
    !isToolRecoveryClassification(value.classification) ||
    !isToolRecoverySource(value.source)
  ) {
    return undefined;
  }
  return {
    schemaVersion: TOOL_RECOVERY_SCHEMA_VERSION,
    classification: value.classification,
    source: value.source,
    toolCallId: value.toolCallId,
    toolName: value.toolName,
  };
}

function isToolDispatchState(value: unknown): value is ToolDispatchState {
  return value === "started" || value === "completed" || value === "failed" || value === "blocked";
}

function isToolRecoveryClassification(value: unknown): value is ToolRecoveryClassification {
  return value === "tool_not_started" || value === "tool_outcome_unknown" || value === "interrupted";
}

function isToolRecoverySource(value: unknown): value is ToolRecoverySource {
  return value === "session_start" || value === "session_tree" || value === "session_shutdown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
