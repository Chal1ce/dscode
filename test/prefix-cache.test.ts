import { describe, expect, it } from "vitest";
import {
  createPrefixCacheAdapter,
  extractPrefixCacheUsage,
} from "../packages/core/src/prefix-cache.js";

const openAiRequest = { model: "test-model", messages: [{ role: "user", content: "hello" }] };
const openAiContext = { api: "openai-completions" };

describe("prefix cache adapters", () => {
  it("keeps the native backend payload-identical", () => {
    const payload = { ...openAiRequest };
    const adapter = createPrefixCacheAdapter("native", { runtimeId: "runtime-a" });

    expect(adapter.transformRequest(payload, openAiContext)).toBe(payload);
    expect(adapter.diagnosticAttributes()).toEqual({});
  });

  it("derives a stable opaque vLLM cache salt from the session", () => {
    const first = createPrefixCacheAdapter("vllm", { runtimeId: "runtime-a" });
    const second = createPrefixCacheAdapter("vllm", { runtimeId: "runtime-a" });
    first.setSession("session-a");
    second.setSession("session-a");

    const firstPayload = first.transformRequest(openAiRequest, openAiContext) as Record<string, unknown>;
    const secondPayload = second.transformRequest(openAiRequest, openAiContext) as Record<string, unknown>;

    expect(firstPayload.cache_salt).toBe(secondPayload.cache_salt);
    expect(firstPayload.cache_salt).toEqual(expect.stringMatching(/^dscode-vllm-[0-9a-f]{32}$/));
    expect(String(firstPayload.cache_salt)).not.toContain("session-a");
    expect(JSON.stringify(first.diagnosticAttributes())).not.toContain("session-a");
  });

  it("derives a stable opaque SGLang session id and skips incompatible APIs", () => {
    const adapter = createPrefixCacheAdapter("sglang", { runtimeId: "runtime-a" });
    adapter.setSession("session-a");

    const payload = adapter.transformRequest(openAiRequest, openAiContext) as Record<string, unknown>;
    const unchanged = adapter.transformRequest(openAiRequest, { api: "anthropic-messages" });

    expect(payload.session_id).toEqual(expect.stringMatching(/^dscode-sglang-[0-9a-f]{32}$/));
    expect(String(payload.session_id)).not.toContain("session-a");
    expect(unchanged).toBe(openAiRequest);
  });

  it("best-effort closes an SGLang session with the same opaque id", async () => {
    const adapter = createPrefixCacheAdapter("sglang", { runtimeId: "runtime-a" });
    adapter.setSession("session-a");
    const request = adapter.transformRequest(openAiRequest, openAiContext) as Record<string, unknown>;
    let closedSession: string | undefined;

    await adapter.closeSession(async (sessionId) => {
      closedSession = sessionId;
    });

    expect(closedSession).toBe(request.session_id);
    await expect(
      adapter.closeSession(async () => {
        throw new Error("server unavailable");
      }),
    ).resolves.toBeUndefined();
  });

  it("normalizes cache usage and safely ignores missing fields", () => {
    expect(
      extractPrefixCacheUsage({
        prompt_tokens_details: { cached_tokens: 120, cache_write_tokens: 8 },
      }),
    ).toEqual({ cacheRead: 120, cacheWrite: 8 });
    expect(extractPrefixCacheUsage({ cacheRead: 0 })).toEqual({ cacheRead: 0 });
    expect(extractPrefixCacheUsage(undefined)).toEqual({});
  });
});
