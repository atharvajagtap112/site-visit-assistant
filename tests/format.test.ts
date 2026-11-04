import { describe, expect, it } from "vitest";
import { formatDuration, formatVisitTime, formatWait, visitLabel } from "../lib/format";

describe("format", () => {
  const AT = new Date("2026-11-08T05:30:00Z"); // 11:00 am in India
  const WHEN = formatVisitTime(AT);
  const NOW = new Date("2026-11-08T06:00:00Z");

  it("shows India time, including across midnight", () => {
    expect(WHEN.replace(/\s/g, " ")).toBe("8 Nov, 11:00 am");
    expect(formatVisitTime(new Date("2026-11-08T20:00:00Z")).replace(/\s/g, " ")).toBe("9 Nov, 1:30 am");
  });

  it.each([
    ["no visit", null, "Not booked", false],
    ["cancelled", { status: "cancelled", startsAt: AT }, "Not booked", false],
    ["visited", { status: "visited", startsAt: AT }, `Visited ${WHEN}`, false],
    ["no-show", { status: "no_show", startsAt: AT }, `No-show ${WHEN}`, false],
    ["past booking", { status: "booked", startsAt: AT }, `Record show-up, ${WHEN}`, true],
    ["future booking", { status: "booked", startsAt: new Date("2026-11-09T05:30:00Z") }, null, false],
  ] as const)("labels %s", (_, visit, text, needsAction) => {
    const label = visitLabel(visit, NOW);
    expect(label.needsAction).toBe(needsAction);
    if (text) expect(label.text).toBe(text);
    else expect(label.text).toMatch(/^Booked /);
  });

  it.each([
    [-5, "0 sec"],
    [59, "59 sec"],
    [60, "1 min"],
    [3599, "59 min"],
    [3600, "1 hr"],
    [47 * 3600, "47 hr"],
    [48 * 3600, "2 days"],
  ])("formats a wait of %i seconds", (seconds, text) => {
    expect(formatWait(new Date(0), new Date(seconds * 1000))).toBe(text);
  });

  it("keeps the seconds of a short duration, so a figure near a target reads true", () => {
    expect(formatDuration(45_000)).toBe("45 sec");
    expect(formatDuration(299_000)).toBe("4 min 59 sec");
    expect(formatDuration(301_000)).toBe("5 min 1 sec");
    expect(formatDuration(3_600_000)).toBe("1 hr");
  });
});
