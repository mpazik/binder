import { describe, it, expect, setSystemTime } from "bun:test";
import type {
  DateRange,
  Period,
  CalendarInterval,
  CalendarIntervalObject,
  PeriodOrientation,
} from "./time.ts";
import {
  formatDuration,
  formatRelativeDate,
  getDurationFromStart,
  getDateRangeFromDate,
  formatDatePeriod,
  comparePeriods,
  comparePeriodObjects,
  parseIsoPeriodDate,
  parseIsoTimestamps,
} from "./time.ts";

describe("formatDuration", () => {
  const testCases = [
    { input: 500, expected: "0s" },
    { input: 1000, expected: "1s" },
    { input: 59000, expected: "59s" },
    { input: 60000, expected: "1m" },
    { input: 61000, expected: "1m 1s" },
    { input: 3600000, expected: "1h" },
    { input: 3661000, expected: "1h 1m" },
    { input: 86400000, expected: "1d" },
    { input: 90000000, expected: "1d 1h" },
    { input: 86400000 + 3600000 + 60000 + 1000, expected: "1d 1h" },
  ];

  testCases.forEach(({ input, expected }) => {
    it(`formats ${input}ms correctly as ${expected}`, () => {
      expect(formatDuration(input)).toBe(expected);
    });
  });
});

describe("getDurationFromStart", () => {
  it("calculates duration from start time", () => {
    // Mock current time
    const now = new Date(2024, 0, 1, 12, 5, 0); // 12:05:00
    const fiveMinutesAgo = new Date(2024, 0, 1, 12, 0, 0); // 12:00:00

    setSystemTime(now.getTime());

    const duration = getDurationFromStart(fiveMinutesAgo);
    expect(duration).toBe(5 * 60 * 1000); // 5 minutes in milliseconds
  });
});

describe("getDateRangeFromDate", () => {
  const check = (input: string, expected: DateRange | undefined) => {
    const result = getDateRangeFromDate(input);
    expect(result).toEqual(expected);
  };

  it("should return undefined for invalid input", () => {
    check("", undefined);
    check("invalid-date", undefined);
    check("2023-13-45", undefined);
  });

  it("should handle daily format (YYYY-MM-DD)", () =>
    check("2023-12-25", {
      since: new Date(2023, 11, 25, 0, 0, 0, 0),
      till: new Date(2023, 11, 25, 23, 59, 59, 999),
    }));

  it("should handle monthly format (YYYY-MM)", () =>
    check("2023-12", {
      since: new Date(2023, 11, 1, 0, 0, 0, 0),
      till: new Date(2023, 11, 31, 23, 59, 59, 999),
    }));

  it("should handle weekly format (YYYY-Www)", () =>
    check("2023-W01", {
      since: new Date(2023, 0, 2, 0, 0, 0, 0),
      till: new Date(2023, 0, 8, 23, 59, 59, 999),
    }));

  it("should handle yearly format (YYYY)", () =>
    check("2023", {
      since: new Date(2023, 0, 1, 0, 0, 0, 0),
      till: new Date(2023, 11, 31, 23, 59, 59, 999),
    }));

  it("should handle leap years correctly", () =>
    check("2024-02", {
      since: new Date(2024, 1, 1, 0, 0, 0, 0),
      till: new Date(2024, 1, 29, 23, 59, 59, 999),
    }));

  it("should handle edge cases in date formats", () => {
    check("2023-1-1", undefined);
    check("2023-1", undefined);
    check("2023-W1", undefined);
  });
});

describe("formatDatePeriod", () => {
  const check = (date: Date, expectations: Record<Period, string>) => {
    Object.entries(expectations).forEach(([period, expected]) => {
      expect(formatDatePeriod(date, period as Period)).toBe(
        expected as CalendarInterval,
      );
    });
  };

  it("formats start of year date", () => {
    check(new Date(2024, 0, 1), {
      day: "2024-01-01",
      week: "2024-W01",
      month: "2024-01",
      year: "2024",
    });
  });

  it("formats end of year dates", () => {
    check(new Date(2020, 11, 30), {
      day: "2020-12-30",
      week: "2020-W53",
      month: "2020-12",
      year: "2020",
    });
  });

  it("formats leap year date", () => {
    check(new Date(2024, 1, 29), {
      day: "2024-02-29",
      week: "2024-W09",
      month: "2024-02",
      year: "2024",
    });
  });

  it("formats mid-month date", () => {
    check(new Date(2024, 2, 14), {
      day: "2024-03-14",
      week: "2024-W11",
      month: "2024-03",
      year: "2024",
    });
  });

  it("ensures formatted dates can be parsed back", () => {
    const date = new Date(2024, 2, 14);
    const periods: Period[] = ["day", "week", "month", "year"];

    periods.forEach((period) => {
      const formatted = formatDatePeriod(date, period);
      const range = getDateRangeFromDate(formatted);

      expect(range).toBeDefined();
      expect(date.getTime()).toBeGreaterThanOrEqual(range!.since.getTime());
      expect(date.getTime()).toBeLessThanOrEqual(range!.till.getTime());
    });
  });
});

describe("comparePeriods", () => {
  const check = (
    period1: CalendarIntervalObject,
    period2: CalendarIntervalObject,
    expected: "less" | "equal" | "greater",
  ) => {
    if (expected === "less") {
      expect(comparePeriods(period1, period2)).toBeLessThan(0);
    } else if (expected === "equal") {
      expect(comparePeriods(period1, period2)).toBe(0);
    } else {
      expect(comparePeriods(period1, period2)).toBeGreaterThan(0);
    }
  };

  it("compares years correctly", () => {
    check({ year: 2023 }, { year: 2024 }, "less");
    check({ year: 2024 }, { year: 2023 }, "greater");
    check({ year: 2024 }, { year: 2024 }, "equal");
  });

  it("compares weeks correctly", () => {
    check({ year: 2024, week: 1 }, { year: 2024, week: 2 }, "less");
    check({ year: 2024, week: 2 }, { year: 2024, week: 1 }, "greater");
    check({ year: 2024, week: 1 }, { year: 2024, week: 1 }, "equal");
    check({ year: 2023, week: 1 }, { year: 2024, week: 1 }, "less");
  });

  it("compares months correctly", () => {
    check({ year: 2024, month: 1 }, { year: 2024, month: 2 }, "less");
    check({ year: 2024, month: 2 }, { year: 2024, month: 1 }, "greater");
    check({ year: 2024, month: 1 }, { year: 2024, month: 1 }, "equal");
    check({ year: 2023, month: 1 }, { year: 2024, month: 1 }, "less");
  });

  it("compares days correctly", () => {
    check(
      { year: 2024, month: 1, day: 1 },
      { year: 2024, month: 1, day: 2 },
      "less",
    );
    check(
      { year: 2024, month: 1, day: 1 },
      { year: 2024, month: 1, day: 1 },
      "equal",
    );
    check(
      { year: 2023, month: 1, day: 1 },
      { year: 2024, month: 1, day: 1 },
      "less",
    );
    check(
      { year: 2024, month: 1, day: 1 },
      { year: 2024, month: 2, day: 1 },
      "less",
    );
  });

  it("handles different period formats", () => {
    check({ year: 2024 }, { year: 2024, month: 1 }, "equal");
    check({ year: 2024, month: 1, day: 1 }, { year: 2024, week: 1 }, "equal");
  });
});

describe("parseIsoPeriodDate", () => {
  const check = (input: CalendarInterval, expected: CalendarIntervalObject) => {
    expect(parseIsoPeriodDate(input)).toEqual(expected);
  };

  it("correctly parses year-only format", () => {
    check("2024" as CalendarInterval, {
      year: 2024,
    });
  });

  it("correctly parses year-month format", () => {
    check("2024-05" as CalendarInterval, {
      year: 2024,
      month: 5,
    });
  });

  it("correctly parses year-month-day format", () => {
    check("2024-05-15" as CalendarInterval, {
      year: 2024,
      month: 5,
      day: 15,
    });
  });

  it("correctly parses year-week format", () => {
    check("2024-W12" as CalendarInterval, {
      year: 2024,
      week: 12,
    });
  });
});

describe("comparePeriodObjects", () => {
  const check = (
    period1: CalendarIntervalObject,
    period2: CalendarIntervalObject,
    expected: PeriodOrientation,
  ) => {
    expect(comparePeriodObjects(period1, period2)).toBe(expected);
  };

  it("correctly determines relationships between periods", () => {
    check({ year: 2023 }, { year: 2024 }, "past");
    check({ year: 2024 }, { year: 2024 }, "present");
    check({ year: 2025 }, { year: 2024 }, "future");

    check(
      { year: 2024, month: 1, day: 1 },
      { year: 2024, month: 1, day: 2 },
      "past",
    );
    check({ year: 2024, month: 2 }, { year: 2024, month: 1 }, "future");
    check({ year: 2024, week: 10 }, { year: 2024, week: 10 }, "present");
  });
});

describe("parseIsoTimestamps", () => {
  const check = (input: Record<string, any>, expected: Record<string, any>) => {
    const result = parseIsoTimestamps(input);

    expect(result).toEqual(expected);
  };

  it("converts ISO timestamp strings to Date objects", () => {
    check(
      { timestamp: "2024-01-15T10:30:45.123Z", name: "test" },
      { timestamp: new Date("2024-01-15T10:30:45.123Z"), name: "test" },
    );
  });

  it("leaves non-ISO strings unchanged", () => {
    check(
      { notTimestamp: "2024-01-15", text: "hello" },
      { notTimestamp: "2024-01-15", text: "hello" },
    );
  });

  it("handles nested objects recursively", () => {
    check(
      {
        user: {
          createdAt: "2024-01-15T10:30:45.123Z",
          profile: { name: "John" },
        },
      },
      {
        user: {
          createdAt: new Date("2024-01-15T10:30:45.123Z"),
          profile: { name: "John" },
        },
      },
    );
  });

  it("handles arrays with timestamps", () => {
    check(
      { timestamps: ["2024-01-15T10:30:45.123Z", "not timestamp"] },
      { timestamps: [new Date("2024-01-15T10:30:45.123Z"), "not timestamp"] },
    );
  });

  it("handles arrays of objects", () => {
    check(
      { events: [{ occurredAt: "2024-01-15T10:30:45.123Z", id: 1 }] },
      { events: [{ occurredAt: new Date("2024-01-15T10:30:45.123Z"), id: 1 }] },
    );
  });

  it("preserves null and primitive values", () => {
    check(
      { nullValue: null, number: 42, boolean: true },
      { nullValue: null, number: 42, boolean: true },
    );
  });
});

describe("formatRelativeDate", () => {
  it("formats dates relative to current time", () => {
    const now = new Date(2024, 0, 15, 12, 0, 0); // Jan 15, 2024 12:00:00
    setSystemTime(now.getTime());

    expect(formatRelativeDate(new Date(2024, 0, 15, 10, 0, 0))).toBe("Today");
    expect(formatRelativeDate(new Date(2024, 0, 14, 10, 0, 0))).toBe(
      "Yesterday",
    );
    expect(formatRelativeDate(new Date(2024, 0, 13, 10, 0, 0))).toBe(
      "2 days ago",
    );
    expect(formatRelativeDate(new Date(2024, 0, 10, 10, 0, 0))).toBe(
      "5 days ago",
    );
    expect(formatRelativeDate(new Date(2024, 0, 8, 10, 0, 0))).toBe(
      "1 weeks ago",
    );

    // For older dates, it should use the formatDate function (locale-dependent)
    const oldDate = new Date(2023, 11, 15, 10, 0, 0);
    const result = formatRelativeDate(oldDate);
    expect(result).toContain("23"); // Should contain the year (may be abbreviated)
    expect(result).toContain("10:00"); // Should contain the time
  });
});
