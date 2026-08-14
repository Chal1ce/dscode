import { describe, expect, it } from "vitest";
import {
  PrefixFingerprintTracker,
  fingerprintRequestPrefix,
  prefixDiagnosticAttributes,
} from "../packages/core/src/prefix-fingerprint.js";
import { summarizeTrace } from "../packages/core/src/replay.js";

const baseRequest = {
  model: "deepseek-v4-flash",
  instructions: "stable system prompt",
  tools: [{ name: "read_file", parameters: { z: 1, a: 2 } }],
  input: [{ role: "user", content: "private prompt" }],
};

describe("request prefix fingerprint", () => {
  it("is stable for object key order while preserving tool order", () => {
    const first = fingerprintRequestPrefix(baseRequest);
    const reordered = fingerprintRequestPrefix({
      input: baseRequest.input,
      tools: [{ name: "read_file", parameters: { a: 2, z: 1 } }],
      instructions: baseRequest.instructions,
      model: baseRequest.model,
    });

    expect(reordered).toEqual(first);
    expect(
      fingerprintRequestPrefix({
        ...baseRequest,
        tools: [{ name: "write_file", parameters: { a: 2, z: 1 } }],
      }).segments.tools.hash,
    ).not.toBe(first.segments.tools.hash);
  });

  it("identifies the first changed segment and keeps history-only changes in one epoch", () => {
    const tracker = new PrefixFingerprintTracker();
    const initial = tracker.observe(fingerprintRequestPrefix(baseRequest));
    const same = tracker.observe(fingerprintRequestPrefix(baseRequest));
    const historyChange = tracker.observe(
      fingerprintRequestPrefix({
        ...baseRequest,
        input: [...baseRequest.input, { role: "assistant", content: "response" }],
      }),
    );
    const configChange = tracker.observe(
      fingerprintRequestPrefix({ ...baseRequest, model: "deepseek-v4-pro" }),
    );

    expect(initial.change).toBe("initial");
    expect(same.change).toBe("none");
    expect(historyChange.change).toBe("history");
    expect(historyChange.epoch).toBe(initial.epoch);
    expect(configChange.change).toBe("config");
    expect(configChange.epoch).toBeGreaterThan(historyChange.epoch);
  });

  it("projects prefix attributes and cache usage through replay", () => {
    const diagnostic = new PrefixFingerprintTracker().observe(
      fingerprintRequestPrefix(baseRequest),
    );
    const timestamp = new Date().toISOString();
    const report = summarizeTrace([
      {
        schemaVersion: 1,
        traceId: "trace-1",
        runId: "run-1",
        spanId: "run:run-1",
        timestamp,
        type: "run_start",
        status: "started",
      },
      {
        schemaVersion: 1,
        traceId: "trace-1",
        runId: "run-1",
        spanId: "model:1",
        timestamp,
        type: "model_request",
        status: "started",
        attributes: prefixDiagnosticAttributes(diagnostic),
      },
      {
        schemaVersion: 1,
        traceId: "trace-1",
        runId: "run-1",
        spanId: "model:1",
        timestamp,
        type: "model_response",
        status: "completed",
        usage: { cacheRead: 120, total: 140 },
      },
      {
        schemaVersion: 1,
        traceId: "trace-1",
        runId: "run-1",
        spanId: "run:run-1",
        timestamp,
        type: "run_end",
        status: "completed",
      },
    ]);

    expect(report.prefix.requests).toBe(1);
    expect(report.prefix.uniqueHashes).toBe(1);
    expect(report.prefix.changes).toEqual({ initial: 1 });
    expect(report.prefix.observations).toEqual([
      {
        requestIndex: 1,
        prefixHash: diagnostic.fingerprint.hash,
        change: "initial",
        cacheReadTokens: 120,
      },
    ]);
  });
});
