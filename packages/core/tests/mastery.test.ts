import { describe, expect, it } from "vitest";
import { calculateMastery, calculateNextReview } from "../src/mastery";

describe("mastery calculation", () => {
  it("increments mastery by 0.25 on correct answer", () => {
    expect(calculateMastery(0.0, "correct")).toBe(0.25);
    expect(calculateMastery(0.5, "correct")).toBe(0.75);
    expect(calculateMastery(0.8, "correct")).toBe(1.0); // clamped at 1.0
  });

  it("increments mastery by 0.10 on partially_correct answer", () => {
    expect(calculateMastery(0.0, "partially_correct")).toBe(0.1);
    expect(calculateMastery(0.45, "partially_correct")).toBe(0.55);
    expect(calculateMastery(0.95, "partially_correct")).toBe(1.0); // clamped at 1.0
  });

  it("decrements mastery by 0.20 on incorrect answer", () => {
    expect(calculateMastery(0.5, "incorrect")).toBe(0.3);
    expect(calculateMastery(0.1, "incorrect")).toBe(0.0); // clamped at 0.0
    expect(calculateMastery(0.0, "incorrect")).toBe(0.0);
  });

  it("clamps values between 0.0 and 1.0 strictly", () => {
    expect(calculateMastery(0.99, "correct")).toBe(1.0);
    expect(calculateMastery(0.05, "incorrect")).toBe(0.0);
  });
});

describe("spaced review calculation", () => {
  it("schedules review in 3 days for mastery >= 0.8", () => {
    const base = new Date("2026-10-17T12:00:00.000Z");
    const next = calculateNextReview(0.85, base);
    expect(next).toBe("2026-10-20T12:00:00.000Z");
  });

  it("schedules review in 1 day for 0.5 <= mastery < 0.8", () => {
    const base = new Date("2026-10-17T12:00:00.000Z");
    const next = calculateNextReview(0.6, base);
    expect(next).toBe("2026-10-18T12:00:00.000Z");
  });

  it("schedules review in 4 hours for mastery < 0.5", () => {
    const base = new Date("2026-10-17T12:00:00.000Z");
    const next = calculateNextReview(0.2, base);
    expect(next).toBe("2026-10-17T16:00:00.000Z");
  });
});
