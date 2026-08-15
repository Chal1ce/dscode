export type ContextPressure = "unknown" | "normal" | "elevated" | "critical" | "overflow";

export interface ContextPressureSnapshot {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
  pressure: ContextPressure;
}

/** Classify context occupancy for diagnostics without changing compaction behavior. */
export function getContextPressureSnapshot(
  tokens: number | null | undefined,
  contextWindow: number | null | undefined,
): ContextPressureSnapshot {
  const validTokens = typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0;
  const validWindow =
    typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0;
  if (!validTokens || !validWindow) {
    return {
      tokens: validTokens ? tokens : null,
      contextWindow: validWindow ? contextWindow : null,
      percent: null,
      pressure: "unknown",
    };
  }

  const percent = (tokens / contextWindow) * 100;
  return {
    tokens,
    contextWindow,
    percent,
    pressure:
      percent < 75
        ? "normal"
        : percent < 90
          ? "elevated"
          : percent < 100
            ? "critical"
            : "overflow",
  };
}

export function contextPressureAttributes(
  snapshot: ContextPressureSnapshot,
): Record<string, string | number | boolean> {
  return {
    contextPressure: snapshot.pressure,
    ...(snapshot.tokens === null ? {} : { contextTokens: snapshot.tokens }),
    ...(snapshot.contextWindow === null ? {} : { contextWindow: snapshot.contextWindow }),
    ...(snapshot.percent === null ? {} : { contextPercent: snapshot.percent }),
  };
}
