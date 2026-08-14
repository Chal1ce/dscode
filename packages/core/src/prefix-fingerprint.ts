import { createHash } from "node:crypto";

export const PREFIX_FINGERPRINT_SCHEMA_VERSION = 1 as const;

export const PREFIX_SEGMENTS = ["system", "tools", "config", "history"] as const;
export type PrefixSegment = (typeof PREFIX_SEGMENTS)[number];
export type PrefixChange = "initial" | "none" | PrefixSegment;

export interface PrefixSegmentFingerprint {
  hash: string;
  bytes: number;
  items?: number;
}

export interface RequestPrefixFingerprint {
  schemaVersion: typeof PREFIX_FINGERPRINT_SCHEMA_VERSION;
  hash: string;
  segments: Record<PrefixSegment, PrefixSegmentFingerprint>;
}

export interface PrefixDiagnostic {
  requestIndex: number;
  epoch: number;
  change: PrefixChange;
  changedSegments: PrefixSegment[];
  fingerprint: RequestPrefixFingerprint;
}

export class PrefixFingerprintTracker {
  private previous: RequestPrefixFingerprint | undefined;
  private requestIndex = 0;
  private epoch = 0;

  reset(): void {
    this.previous = undefined;
    this.requestIndex = 0;
    this.epoch = 0;
  }

  observe(fingerprint: RequestPrefixFingerprint): PrefixDiagnostic {
    const previous = this.previous;
    const changedSegments = previous
      ? PREFIX_SEGMENTS.filter(
          (segment) => previous.segments[segment].hash !== fingerprint.segments[segment].hash,
        )
      : [];
    this.requestIndex += 1;
    if (!previous || changedSegments.some((segment) => segment !== "history")) this.epoch += 1;
    this.previous = fingerprint;
    return {
      requestIndex: this.requestIndex,
      epoch: this.epoch,
      change: previous ? changedSegments[0] ?? "none" : "initial",
      changedSegments,
      fingerprint,
    };
  }
}

export function fingerprintRequestPrefix(payload: unknown): RequestPrefixFingerprint {
  const request = isRecord(payload) ? payload : { value: payload };
  const input = request.input ?? request.messages ?? request.contents ?? request.prompt ?? null;
  const explicitSystem = request.instructions ?? request.system;
  const system = explicitSystem !== undefined ? explicitSystem : extractSystemMessages(input);
  const history = stripSystemMessages(input);
  const tools = request.tools ?? null;
  const config = Object.fromEntries(
    Object.entries(request).filter(
      ([key]) => !["instructions", "system", "input", "messages", "contents", "prompt", "tools"].includes(key),
    ),
  );
  const values: Record<PrefixSegment, unknown> = { system, tools, config, history };
  const segments = Object.fromEntries(
    PREFIX_SEGMENTS.map((segment) => {
      const serialized = stableSerialize(values[segment]);
      return [
        segment,
        {
          hash: digest(serialized),
          bytes: Buffer.byteLength(serialized, "utf8"),
          ...(Array.isArray(values[segment]) ? { items: values[segment].length } : {}),
        },
      ];
    }),
  ) as Record<PrefixSegment, PrefixSegmentFingerprint>;
  const hash = digest(
    PREFIX_SEGMENTS.map((segment) => `${segment}:${segments[segment].hash}`).join("\n"),
  );
  return { schemaVersion: PREFIX_FINGERPRINT_SCHEMA_VERSION, hash, segments };
}

export function prefixDiagnosticAttributes(
  diagnostic: PrefixDiagnostic,
): Record<string, string | number | boolean> {
  return {
    prefixSchema: diagnostic.fingerprint.schemaVersion,
    prefixRequestIndex: diagnostic.requestIndex,
    prefixEpoch: diagnostic.epoch,
    prefixHash: diagnostic.fingerprint.hash,
    prefixChange: diagnostic.change,
    prefixChangedSegments: diagnostic.changedSegments.join(","),
    prefixSystemHash: diagnostic.fingerprint.segments.system.hash,
    prefixToolsHash: diagnostic.fingerprint.segments.tools.hash,
    prefixConfigHash: diagnostic.fingerprint.segments.config.hash,
    prefixHistoryHash: diagnostic.fingerprint.segments.history.hash,
    prefixBytes: PREFIX_SEGMENTS.reduce(
      (total, segment) => total + diagnostic.fingerprint.segments[segment].bytes,
      0,
    ),
  };
}

function extractSystemMessages(input: unknown): unknown {
  if (!Array.isArray(input)) return null;
  const messages = input.filter((item) => isRecord(item) && item.role === "system");
  return messages.length > 0 ? messages : null;
}

function stripSystemMessages(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  return input.filter((item) => !(isRecord(item) && item.role === "system"));
}

function stableSerialize(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "number:NaN";
    if (value === Infinity) return "number:Infinity";
    if (value === -Infinity) return "number:-Infinity";
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (typeof value === "function") return "function";
  if (typeof value !== "object") return JSON.stringify(String(value));
  if (ancestors.has(value)) return "[circular]";
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item, nextAncestors)).join(",")}]`;
  }
  const entries = Object.entries(value)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested, nextAncestors)}`);
  return `{${entries.join(",")}}`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
