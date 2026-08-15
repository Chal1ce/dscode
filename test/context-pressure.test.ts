import { describe, expect, it } from "vitest";
import {
  contextPressureAttributes,
  getContextPressureSnapshot,
} from "../packages/core/src/context-pressure.js";

describe("context pressure", () => {
  it.each([
    [0, "normal"],
    [749, "normal"],
    [750, "elevated"],
    [899, "elevated"],
    [900, "critical"],
    [999, "critical"],
    [1_000, "overflow"],
    [1_200, "overflow"],
  ])("classifies %s tokens in a 1,000-token window as %s", (tokens, pressure) => {
    expect(getContextPressureSnapshot(tokens, 1_000).pressure).toBe(pressure);
  });

  it("returns an unknown snapshot for missing or invalid measurements", () => {
    expect(getContextPressureSnapshot(null, 1_000)).toMatchObject({
      tokens: null,
      contextWindow: 1_000,
      percent: null,
      pressure: "unknown",
    });
    expect(getContextPressureSnapshot(-1, 1_000).pressure).toBe("unknown");
    expect(getContextPressureSnapshot(100, 0).pressure).toBe("unknown");
    expect(getContextPressureSnapshot(100, Number.NaN).pressure).toBe("unknown");
  });

  it("only emits numeric trace fields when measurements are known", () => {
    expect(contextPressureAttributes(getContextPressureSnapshot(900, 1_000))).toEqual({
      contextPressure: "critical",
      contextTokens: 900,
      contextWindow: 1_000,
      contextPercent: 90,
    });
    expect(contextPressureAttributes(getContextPressureSnapshot(null, null))).toEqual({
      contextPressure: "unknown",
    });
  });
});
