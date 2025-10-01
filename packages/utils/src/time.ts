import {
  parse,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfYear,
  endOfYear,
  isValid,
  intervalToDuration,
  format,
  addDays,
  addMonths,
  addWeeks,
  addYears,
} from "date-fns";
import type { Brand } from "./type";
import type { Comparator } from "./function";
import type { JsonObject } from "./json";

export { addDays, addMonths, addWeeks, addYears };

/**
 * Branded type for Unix epoch timestamps (milliseconds since Jan 1 1970)
 */
export type EpochTimestamp = Brand<number, "timestamp">;
export type IsoTimestamp = Brand<string, "iso-timestamp">;

export const newTimestamp = (
  timestamp?: string | Date | number,
): EpochTimestamp =>
  timestamp
    ? (new Date(timestamp).getTime() as EpochTimestamp)
    : (Date.now() as EpochTimestamp);

export const newIsoTimestamp = (
  timestamps?: string | Date | number,
): IsoTimestamp =>
  timestamps
    ? (new Date(timestamps).toISOString() as IsoTimestamp)
    : (new Date().toISOString() as IsoTimestamp);

export const formatDate = (date: Date) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);

export const formatRelativeDate = (date: Date | string) => {
  const dateObj = new Date(date);

  if (isNaN(dateObj.getTime())) {
    return "Invalid date";
  }

  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatDate(dateObj);
};

export const isIsoTimestamp = (value: string): value is IsoTimestamp => {
  return value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) !== null;
};

export const parseIsoTimestamps = <T extends object = object>(
  value: JsonObject,
): T => {
  const parseValue = (val: unknown): unknown => {
    if (typeof val === "string" && isIsoTimestamp(val)) {
      return new Date(val);
    }

    if (Array.isArray(val)) {
      return val.map(parseValue);
    }

    if (val !== null && typeof val === "object") {
      return Object.fromEntries(
        Object.entries(val).map(([key, value]) => [key, parseValue(value)]),
      );
    }

    return val;
  };

  return parseValue(value) as T;
};

export const formatDuration = (durationInMs: number): string => {
  const duration = intervalToDuration({
    start: 0,
    end: durationInMs,
  });

  if (duration.days && duration.days > 0) {
    return `${duration.days}d${duration.hours ? ` ${duration.hours}h` : ""}`;
  }

  if (duration.hours && duration.hours > 0) {
    return `${duration.hours}h${duration.minutes ? ` ${duration.minutes}m` : ""}`;
  }

  if (duration.minutes && duration.minutes > 0) {
    return `${duration.minutes}m${duration.seconds ? ` ${duration.seconds}s` : ""}`;
  }

  return `${duration.seconds || 0}s`;
};

export const getDurationFromStart = (startTime: Date): number => {
  return new Date().getTime() - startTime.getTime();
};

/**
 * Represents a range of dates
 * @since - Start of the range inclusive
 * @till - End of the range exclusive
 */
export type DateRange = {
  since: Date;
  till: Date;
};

export type Period = "day" | "week" | "month" | "year";
export type CalendarInterval = Brand<string, "Interval">;
export type CalendarIntervalObject = {
  year: number;
  month?: number;
  week?: number;
  day?: number;
};

export const getDateRangeForPeriod = (
  date: Date,
  period: Period,
): DateRange => {
  switch (period) {
    case "day":
      return {
        since: startOfDay(date),
        till: endOfDay(date),
      };
    case "week":
      return {
        since: startOfWeek(date, { weekStartsOn: 1 }),
        till: endOfWeek(date, { weekStartsOn: 1 }),
      };
    case "month":
      return {
        since: startOfMonth(date),
        till: endOfMonth(date),
      };
    case "year":
      return {
        since: startOfYear(date),
        till: endOfYear(date),
      };
  }
};

export const formatDatePeriod = (
  date: Date,
  period: Period,
): CalendarInterval => {
  switch (period) {
    case "day":
      return format(date, "yyyy-MM-dd") as CalendarInterval;
    case "week":
      return format(date, "yyyy-'W'II") as CalendarInterval;
    case "month":
      return format(date, "yyyy-MM") as CalendarInterval;
    case "year":
      return format(date, "yyyy") as CalendarInterval;
  }
};

export const parseIsoPeriodDate = (
  date: CalendarInterval,
): CalendarIntervalObject => {
  if (date.includes("-W")) {
    const [yearStr, weekStr] = date.split("-W");
    const year = Number(yearStr);
    const week = Number(weekStr);
    return { year, week };
  }
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
};

export const comparePeriods: Comparator<CalendarIntervalObject> = (
  period1,
  period2,
) => {
  if (period1.year !== period2.year) {
    return period1.year - period2.year;
  }

  if (period1.week !== undefined && period2.week !== undefined) {
    return period1.week - period2.week;
  }

  if (period1.month !== undefined && period2.month !== undefined) {
    if (period1.month !== period2.month) {
      return period1.month - period2.month;
    }

    if (period1.day !== undefined && period2.day !== undefined) {
      return period1.day - period2.day;
    }
  }

  return 0;
};

export type PeriodOrientation = "past" | "present" | "future";

export const comparePeriodObjects = (
  period1: CalendarIntervalObject,
  period2: CalendarIntervalObject,
): PeriodOrientation => {
  const comparison = comparePeriods(period1, period2);
  if (comparison < 0) return "past";
  if (comparison > 0) return "future";
  return "present";
};

/**
 * Returns a date range based on the format of the input date string
 * Supported formats:
 * - YYYY-MM-DD: Day range (start of day to end of day)
 * - YYYY-MM: Month range (start of month to end of month)
 * - YYYY-Www: Week range (start of week to end of week when ww is the week number)
 * - YYYY: Year range (start of year to end of year)
 */
export const getDateRangeFromDate = (date: string): DateRange | undefined => {
  if (!date) return undefined;

  const [format, period]: [string | undefined, Period] =
    /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? ["yyyy-MM-dd", "day"]
      : /^\d{4}-\d{2}$/.test(date)
        ? ["yyyy-MM", "month"]
        : /^\d{4}-W\d{2}$/.test(date)
          ? ["RRRR-'W'II", "week"]
          : /^\d{4}$/.test(date)
            ? ["yyyy", "year"]
            : [undefined, "year"];

  if (!format) return undefined;

  const parsedDate = parse(date, format, new Date());
  if (!isValid(parsedDate)) return undefined;

  return getDateRangeForPeriod(parsedDate, period);
};

// Duration in seconds
export type DurationSeconds = Brand<number, "DurationSeconds">;
export const createDurationSeconds = (seconds: number): DurationSeconds =>
  seconds as DurationSeconds;
