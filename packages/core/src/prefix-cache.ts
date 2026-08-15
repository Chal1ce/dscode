import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const prefixCacheBackendSchema = z.enum(["native", "vllm", "sglang"]);
export type PrefixCacheBackend = z.infer<typeof prefixCacheBackendSchema>;

export interface PrefixCacheRequestContext {
  provider?: string;
  model?: string;
  api?: string;
}

export interface PrefixCacheUsage {
  cacheRead?: number;
  cacheWrite?: number;
}

export interface PrefixCacheAdapter {
  readonly backend: PrefixCacheBackend;
  setSession(sessionId: string | undefined): void;
  transformRequest(payload: unknown, context: PrefixCacheRequestContext): unknown;
  extractCacheUsage(usage: unknown): PrefixCacheUsage;
  diagnosticAttributes(): Record<string, string | number | boolean>;
}

export interface PrefixCacheAdapterOptions {
  runtimeId?: string;
}

/**
 * Select the request-level hint for a prefix-cache implementation. The
 * default adapter is intentionally identity-preserving for compatibility.
 */
export function createPrefixCacheAdapter(
  backend: PrefixCacheBackend = "native",
  options: PrefixCacheAdapterOptions = {},
): PrefixCacheAdapter {
  const runtimeId = options.runtimeId ?? randomUUID();
  if (backend === "vllm") return new VllmPrefixCacheAdapter(runtimeId);
  if (backend === "sglang") return new SglangPrefixCacheAdapter(runtimeId);
  return new NativePrefixCacheAdapter(runtimeId);
}

export function extractPrefixCacheUsage(usage: unknown): PrefixCacheUsage {
  if (!isRecord(usage)) return {};
  const promptDetails = isRecord(usage.prompt_tokens_details)
    ? usage.prompt_tokens_details
    : undefined;
  const inputDetails = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : undefined;
  const cacheRead = firstFiniteNumber(
    usage.cacheRead,
    usage.cache_read,
    promptDetails?.cached_tokens,
    inputDetails?.cached_tokens,
    usage.prompt_cache_hit_tokens,
  );
  const cacheWrite = firstFiniteNumber(
    usage.cacheWrite,
    usage.cache_write,
    promptDetails?.cache_write_tokens,
    inputDetails?.cache_write_tokens,
  );
  return {
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
  };
}

abstract class BasePrefixCacheAdapter implements PrefixCacheAdapter {
  abstract readonly backend: PrefixCacheBackend;
  protected sessionId: string | undefined;

  constructor(protected readonly runtimeId: string) {}

  setSession(sessionId: string | undefined): void {
    this.sessionId = sessionId?.trim() || undefined;
  }

  abstract transformRequest(payload: unknown, context: PrefixCacheRequestContext): unknown;

  extractCacheUsage(usage: unknown): PrefixCacheUsage {
    return extractPrefixCacheUsage(usage);
  }

  diagnosticAttributes(): Record<string, string | number | boolean> {
    return {
      prefixCacheBackend: this.backend,
      prefixCacheIdentityHash: digest(this.identity()),
    };
  }

  protected identity(): string {
    return this.sessionId ? `session:${this.sessionId}` : `runtime:${this.runtimeId}`;
  }

  protected isOpenAICompatible(context: PrefixCacheRequestContext): boolean {
    return (
      context.api === undefined ||
      context.api === "openai-completions" ||
      context.api === "openai-responses"
    );
  }
}

class NativePrefixCacheAdapter extends BasePrefixCacheAdapter {
  readonly backend = "native" as const;

  transformRequest(payload: unknown, _context: PrefixCacheRequestContext): unknown {
    return payload;
  }

  diagnosticAttributes(): Record<string, string | number | boolean> {
    return {};
  }
}

class VllmPrefixCacheAdapter extends BasePrefixCacheAdapter {
  readonly backend = "vllm" as const;

  transformRequest(payload: unknown, context: PrefixCacheRequestContext): unknown {
    if (!this.isOpenAICompatible(context) || !isRecord(payload)) return payload;
    return {
      ...payload,
      cache_salt: opaqueToken("dscode-vllm", this.identity()),
    };
  }
}

class SglangPrefixCacheAdapter extends BasePrefixCacheAdapter {
  readonly backend = "sglang" as const;

  transformRequest(payload: unknown, context: PrefixCacheRequestContext): unknown {
    if (!this.isOpenAICompatible(context) || !isRecord(payload)) return payload;
    return {
      ...payload,
      session_id: opaqueToken("dscode-sglang", this.identity()),
    };
  }
}

function opaqueToken(namespace: string, identity: string): string {
  return `${namespace}-${digest(`${namespace}\0${identity}`).slice(0, 32)}`;
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
