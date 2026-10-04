import type { Duration } from "../temporal/duration.ts";

// Inter-builtin capability implemented by shared Intl, not a backend formatter.
// Kind selects Instant, time, date, date-time, year-month, month-day, zoned,
// Date.toLocaleString, Date.toLocaleDateString or Date.toLocaleTimeString (0..9).
// Immutable slots cross this boundary without constructing temporary values.
export interface TimeLocaleSource {
  formatDateTime(
    kind: number,
    milliseconds: number,
    calendar: string,
    locales: Intl.LocalesArgument,
    options: Readonly<Intl.DateTimeFormatOptions> | undefined,
    timeZone: string | undefined,
  ): string;
  formatDuration(
    value: Duration,
    locales: Intl.LocalesArgument,
    options: Readonly<Intl.DurationFormatOptions> | undefined,
  ): string;
}
