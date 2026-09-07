import { parseDeltaSeconds } from "./cache-control.ts";
import type { CacheControlDirectives, ParsedCacheControl } from "./cache-control.ts";
import { trimHTTPTabOrSpace } from "../core/ascii.ts";

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const shortWeekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const longWeekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function decimal(value: string, start: number, length: number): number {
  let result = 0;
  for (let index = start; index < start + length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return -1;
    result = result * 10 + code - 48;
  }
  return result;
}

function monthIndex(value: string): number {
  return months.indexOf(value.toLowerCase());
}

function validShortWeekday(value: string): boolean {
  return shortWeekdays.includes(value.toLowerCase());
}

function validLongWeekday(value: string): boolean {
  return longWeekdays.includes(value.toLowerCase());
}

function makeTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number | null {
  if (
    year < 1601 ||
    month < 0 ||
    month > 11 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 60
  ) {
    return null;
  }
  const ordinarySecond = second === 60 ? 59 : second;
  const base = Date.UTC(year, month, day, hour, minute, ordinarySecond);
  const date = new Date(base);
  if (
    !Number.isFinite(base) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== ordinarySecond
  ) {
    return null;
  }
  return second === 60 ? base + 1000 : base;
}

function parseIMFFixdate(value: string): number | null {
  if (
    value.length !== 29 ||
    !validShortWeekday(value.slice(0, 3)) ||
    value.slice(3, 5) !== ", " ||
    value.charCodeAt(7) !== 32 ||
    value.charCodeAt(11) !== 32 ||
    value.charCodeAt(16) !== 32 ||
    value.charCodeAt(19) !== 58 ||
    value.charCodeAt(22) !== 58 ||
    value.charCodeAt(25) !== 32 ||
    value.slice(26).toLowerCase() !== "gmt"
  ) {
    return null;
  }
  return makeTime(
    decimal(value, 12, 4),
    monthIndex(value.slice(8, 11)),
    decimal(value, 5, 2),
    decimal(value, 17, 2),
    decimal(value, 20, 2),
    decimal(value, 23, 2),
  );
}

function parseRFC850Date(value: string, now: number): number | null {
  const comma = value.indexOf(",");
  if (
    comma < 6 ||
    !validLongWeekday(value.slice(0, comma)) ||
    value.slice(comma, comma + 2) !== ", " ||
    value.length !== comma + 24 ||
    value.charCodeAt(comma + 4) !== 45 ||
    value.charCodeAt(comma + 8) !== 45 ||
    value.charCodeAt(comma + 11) !== 32 ||
    value.charCodeAt(comma + 14) !== 58 ||
    value.charCodeAt(comma + 17) !== 58 ||
    value.charCodeAt(comma + 20) !== 32 ||
    value.slice(comma + 21).toLowerCase() !== "gmt"
  ) {
    return null;
  }
  const shortYear = decimal(value, comma + 9, 2);
  if (shortYear < 0) return null;
  const currentYear = new Date(now).getUTCFullYear();
  let year = Math.floor(currentYear / 100) * 100 + shortYear;
  if (year > currentYear + 50) year -= 100;
  return makeTime(
    year,
    monthIndex(value.slice(comma + 5, comma + 8)),
    decimal(value, comma + 2, 2),
    decimal(value, comma + 12, 2),
    decimal(value, comma + 15, 2),
    decimal(value, comma + 18, 2),
  );
}

function parseASCTime(value: string): number | null {
  if (
    value.length !== 24 ||
    !validShortWeekday(value.slice(0, 3)) ||
    value.charCodeAt(3) !== 32 ||
    value.charCodeAt(7) !== 32 ||
    value.charCodeAt(10) !== 32 ||
    value.charCodeAt(13) !== 58 ||
    value.charCodeAt(16) !== 58 ||
    value.charCodeAt(19) !== 32
  ) {
    return null;
  }
  const day = value.charCodeAt(8) === 32 ? decimal(value, 9, 1) : decimal(value, 8, 2);
  return makeTime(
    decimal(value, 20, 4),
    monthIndex(value.slice(4, 7)),
    day,
    decimal(value, 11, 2),
    decimal(value, 14, 2),
    decimal(value, 17, 2),
  );
}

/** RFC 9110 HTTP-date parsing without host-dependent `Date.parse`. */
export function parseHTTPDate(value: string, now: number): number | null {
  if (!Number.isFinite(now)) return null;
  return parseIMFFixdate(value) ?? parseRFC850Date(value, now) ?? parseASCTime(value);
}

/** Parse the first Age list member, discarding later members per RFC 9111. */
export function parseAge(value: string): number | null {
  const comma = value.indexOf(",");
  return parseDeltaSeconds(trimHTTPTabOrSpace(comma < 0 ? value : value.slice(0, comma)));
}

export interface StoredResponseTiming {
  /** Milliseconds when the request was sent. */
  readonly requestTime: number;
  /** Milliseconds when the response headers arrived. */
  readonly responseTime: number;
  /** Parsed Date field, or responseTime when Date was absent or invalid. */
  readonly dateValue: number;
  /** Parsed Age value in seconds, saturated per RFC 9111. */
  readonly ageValue: number;
}

/** RFC 9111 section 4.2.3 corrected age, in seconds. */
export function currentAgeSeconds(timing: StoredResponseTiming, now: number): number {
  const responseDelay = Math.max(0, (timing.responseTime - timing.requestTime) / 1000);
  const apparentAge = Math.max(0, (timing.responseTime - timing.dateValue) / 1000);
  const correctedAgeValue = Math.max(0, timing.ageValue) + responseDelay;
  const correctedInitialAge = Math.max(apparentAge, correctedAgeValue);
  const residentTime = Math.max(0, (now - timing.responseTime) / 1000);
  return correctedInitialAge + residentTime;
}

export interface FreshnessLifetimeInput {
  readonly shared: boolean;
  readonly parsed: ParsedCacheControl;
  readonly responseTime: number;
  readonly dateValue: number;
  /** `undefined` means absent; `null` means present but invalid. */
  readonly expiresValue?: number | null;
  readonly lastModifiedValue?: number | null;
  /** Whether status/method policy permits heuristic freshness. */
  readonly heuristicAllowed: boolean;
  /** Defaults to the conventional RFC 9111 example of ten percent. */
  readonly heuristicFraction?: number;
}

export type FreshnessSource = "s-maxage" | "max-age" | "expires" | "heuristic" | "none";

export interface FreshnessLifetime {
  readonly seconds: number;
  readonly source: FreshnessSource;
}

/** RFC 9111 section 4.2.1 freshness lifetime, before request constraints. */
export function freshnessLifetime(input: FreshnessLifetimeInput): FreshnessLifetime {
  const directives = input.parsed.directives;
  if (input.parsed.duplicateFreshnessDirective) return { seconds: 0, source: "none" };
  if (input.shared && directives.sMaxage !== undefined) {
    return { seconds: directives.sMaxage, source: "s-maxage" };
  }
  if (directives.maxAge !== undefined) {
    return { seconds: directives.maxAge, source: "max-age" };
  }
  if (input.expiresValue !== undefined) {
    if (input.expiresValue === null) return { seconds: 0, source: "expires" };
    return {
      seconds: Math.max(0, (input.expiresValue - input.dateValue) / 1000),
      source: "expires",
    };
  }
  if (
    input.heuristicAllowed &&
    input.lastModifiedValue !== undefined &&
    input.lastModifiedValue !== null
  ) {
    const fraction = input.heuristicFraction ?? 0.1;
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      throw new RangeError("Invalid heuristic freshness fraction");
    }
    return {
      seconds: Math.max(0, ((input.dateValue - input.lastModifiedValue) / 1000) * fraction),
      source: "heuristic",
    };
  }
  return { seconds: 0, source: "none" };
}

export type CacheReuseDecision = "fresh" | "stale-allowed" | "revalidate";

export interface CacheReuseInput {
  readonly currentAge: number;
  readonly freshnessLifetime: number;
  readonly request: CacheControlDirectives;
  readonly response: CacheControlDirectives;
  readonly shared: boolean;
}

/** Apply request constraints and stale permissions to a stored response. */
export function cacheReuseDecision(input: CacheReuseInput): CacheReuseDecision {
  if (input.request.noCache !== undefined || input.response.noCache === true) {
    return "revalidate";
  }
  let lifetime = input.freshnessLifetime;
  if (input.request.maxAge !== undefined) lifetime = Math.min(lifetime, input.request.maxAge);
  const ageWithRequiredFreshness = input.currentAge + (input.request.minFresh ?? 0);
  if (ageWithRequiredFreshness < lifetime) return "fresh";

  if (
    input.response.mustRevalidate === true ||
    (input.shared &&
      (input.response.proxyRevalidate === true || input.response.sMaxage !== undefined))
  ) {
    return "revalidate";
  }
  const maxStale = input.request.maxStale;
  if (maxStale === true) return "stale-allowed";
  if (typeof maxStale === "number" && input.currentAge - lifetime <= maxStale) {
    return "stale-allowed";
  }
  return "revalidate";
}
