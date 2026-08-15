import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  createToolDispatchMarker,
  findPendingToolRecoveries,
  TOOL_DISPATCH_ENTRY,
  type ToolDispatchState,
} from "../packages/core/src/tool-recovery.js";

describe("tool recovery taxonomy", () => {
  it("distinguishes calls that never reached dispatch from unknown outcomes", () => {
    const entries = [assistantEntry("not-started", "read"), assistantEntry("unknown", "write")] as SessionEntry[];
    entries.push(dispatchEntry("unknown", "write", "started"));

    expect(findPendingToolRecoveries(entries, "session_start")).toEqual([
      {
        classification: "tool_not_started",
        toolCallId: "not-started",
        toolName: "read",
      },
      {
        classification: "tool_outcome_unknown",
        toolCallId: "unknown",
        toolName: "write",
      },
    ]);
  });

  it("treats blocked calls as terminal and marks active calls interrupted on shutdown", () => {
    const entries = [
      assistantEntry("blocked", "apply_patch"),
      dispatchEntry("blocked", "apply_patch", "blocked"),
      assistantEntry("active", "exec_command"),
      dispatchEntry("active", "exec_command", "started"),
    ] as SessionEntry[];

    expect(findPendingToolRecoveries(entries, "session_shutdown")).toEqual([
      {
        classification: "interrupted",
        toolCallId: "active",
        toolName: "exec_command",
      },
    ]);
  });

  it("uses a legacy tool result as terminal evidence when no marker exists", () => {
    const entries = [assistantEntry("legacy", "read"), toolResultEntry("legacy")] as SessionEntry[];

    expect(findPendingToolRecoveries(entries, "session_start")).toEqual([]);
  });
});

function assistantEntry(toolCallId: string, toolName: string): SessionEntry {
  return {
    type: "message",
    id: `assistant-${toolCallId}`,
    parentId: null,
    timestamp: "2026-08-15T00:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: toolCallId, name: toolName, arguments: {} }],
      api: "openai-responses",
      provider: "deepseek",
      model: "test-model",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 0,
    },
  } as SessionEntry;
}

function dispatchEntry(toolCallId: string, toolName: string, state: ToolDispatchState): SessionEntry {
  return {
    type: "custom",
    id: `dispatch-${toolCallId}-${state}`,
    parentId: null,
    timestamp: "2026-08-15T00:00:01.000Z",
    customType: TOOL_DISPATCH_ENTRY,
    data: createToolDispatchMarker(toolCallId, toolName, state),
  } as SessionEntry;
}

function toolResultEntry(toolCallId: string): SessionEntry {
  return {
    type: "message",
    id: `result-${toolCallId}`,
    parentId: null,
    timestamp: "2026-08-15T00:00:02.000Z",
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "read",
      content: [{ type: "text", text: "ok" }],
      isError: false,
      details: {},
    },
  } as SessionEntry;
}
