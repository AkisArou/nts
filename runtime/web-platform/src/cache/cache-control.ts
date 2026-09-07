import { isHTTPTabOrSpace, trimHTTPTabOrSpace } from "../core/ascii.ts";
import { isToken } from "../fetch/headers.ts";

/** RFC 9111's required saturation value for an overflowing delta-seconds. */
export const MAX_DELTA_SECONDS = 2_147_483_648;

export type QualifiedCacheDirective = true | readonly string[];

export interface CacheExtensionDirective {
  readonly name: string;
  readonly value: string | null;
}

/**
 * Parsed Cache-Control directives shared by request and response policy.
 *
 * Qualified `private` and `no-cache` retain their field-name list. A bare
 * directive is `true`; malformed qualification is also made bare so a syntax
 * error cannot weaken a privacy or revalidation constraint.
 */
export interface CacheControlDirectives {
  maxAge?: number;
  maxStale?: number | true;
  minFresh?: number;
  noCache?: QualifiedCacheDirective;
  noStore?: boolean;
  noTransform?: boolean;
  onlyIfCached?: boolean;
  mustRevalidate?: boolean;
  mustUnderstand?: boolean;
  private?: QualifiedCacheDirective;
  proxyRevalidate?: boolean;
  public?: boolean;
  sMaxage?: number;
  immutable?: boolean;
  staleIfError?: number;
  staleWhileRevalidate?: number;
  readonly extensions: CacheExtensionDirective[];
}

export interface ParsedCacheControl {
  readonly directives: CacheControlDirectives;
  /** At least one list member had invalid HTTP field syntax. */
  readonly malformed: boolean;
  /** A freshness directive occurred more than once; policy treats it as stale. */
  readonly duplicateFreshnessDirective: boolean;
}

interface ParsedValue {
  readonly value: string;
  readonly next: number;
  readonly valid: boolean;
}

function skipOWS(value: string, index: number): number {
  while (index < value.length && isHTTPTabOrSpace(value.charCodeAt(index))) index++;
  return index;
}

function tokenEnd(value: string, start: number): number {
  let end = start;
  while (end < value.length) {
    const code = value.charCodeAt(end);
    if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      "!#$%&'*+-.^_`|~".includes(value.charAt(end))
    ) {
      end++;
    } else break;
  }
  return end;
}

function skipToComma(value: string, index: number): number {
  let quoted = false;
  let escaped = false;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (escaped) escaped = false;
    else if (quoted && code === 92) escaped = true;
    else if (code === 34) quoted = !quoted;
    else if (!quoted && code === 44) return index + 1;
    index++;
  }
  return index;
}

function parseQuotedString(value: string, start: number): ParsedValue {
  let result = "";
  let index = start + 1;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 34) return { value: result, next: index + 1, valid: true };
    if (code === 92) {
      index++;
      if (index >= value.length) break;
      const escaped = value.charCodeAt(index);
      if (escaped > 255 || (escaped !== 9 && (escaped < 32 || escaped === 127))) break;
      result += value.charAt(index);
      index++;
      continue;
    }
    if (code > 255 || (code !== 9 && (code < 32 || code === 127))) break;
    result += value.charAt(index);
    index++;
  }
  return { value: result, next: value.length, valid: false };
}

export function parseDeltaSeconds(value: string): number | null {
  if (value.length === 0) return null;
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return null;
    result = result * 10 + code - 48;
    if (result >= MAX_DELTA_SECONDS) return MAX_DELTA_SECONDS;
  }
  return result;
}

function parseFieldNames(value: string): string[] | null {
  const result: string[] = [];
  let start = 0;
  for (let index = 0; index <= value.length; index++) {
    if (index !== value.length && value.charCodeAt(index) !== 44) continue;
    const field = trimHTTPTabOrSpace(value.slice(start, index)).toLowerCase();
    if (!isToken(field)) return null;
    result.push(field);
    start = index + 1;
  }
  return result.length === 0 ? null : result;
}

function addQualified(
  previous: QualifiedCacheDirective | undefined,
  value: string | null,
): QualifiedCacheDirective {
  if (previous === true || value === null) return true;
  const fields = parseFieldNames(value);
  if (fields === null) return true;
  if (previous === undefined) return fields;
  const result = previous.slice();
  for (const field of fields) if (!result.includes(field)) result.push(field);
  return result;
}

function sawName(names: string[], name: string): boolean {
  if (names.includes(name)) return true;
  names.push(name);
  return false;
}

/**
 * Parse Cache-Control using RFC 9110 list/token/quoted-string syntax.
 *
 * OWS around `=` is accepted deliberately. Besides being common wire input, it
 * prevents qualified `private`/`no-cache` constraints from being discarded by
 * the parser ambiguity behind GHSA-jr45-8vmc-qm54.
 */
export function parseCacheControl(value: string): ParsedCacheControl {
  const directives: CacheControlDirectives = { extensions: [] };
  const freshnessNames: string[] = [];
  let malformed = false;
  let duplicateFreshnessDirective = false;
  let index = 0;

  while (index < value.length) {
    index = skipOWS(value, index);
    while (index < value.length && value.charCodeAt(index) === 44) {
      index = skipOWS(value, index + 1);
    }
    if (index >= value.length) break;

    const start = index;
    const end = tokenEnd(value, start);
    if (end === start) {
      malformed = true;
      index = skipToComma(value, index);
      continue;
    }
    const name = value.slice(start, end).toLowerCase();
    index = skipOWS(value, end);
    let argument: string | null = null;
    if (index < value.length && value.charCodeAt(index) === 61) {
      index = skipOWS(value, index + 1);
      if (index < value.length && value.charCodeAt(index) === 34) {
        const parsed = parseQuotedString(value, index);
        argument = parsed.value;
        index = parsed.next;
        if (!parsed.valid) {
          malformed = true;
          index = skipToComma(value, index);
        }
      } else {
        const argumentEnd = tokenEnd(value, index);
        if (argumentEnd === index) {
          malformed = true;
          index = skipToComma(value, index);
        } else {
          argument = value.slice(index, argumentEnd);
          index = argumentEnd;
        }
      }
    }
    index = skipOWS(value, index);
    if (index < value.length && value.charCodeAt(index) !== 44) {
      malformed = true;
      index = skipToComma(value, index);
      continue;
    }
    if (index < value.length) index++;

    const delta = argument === null ? null : parseDeltaSeconds(argument);
    switch (name) {
      case "max-age":
      case "s-maxage":
      case "min-fresh":
      case "stale-if-error":
      case "stale-while-revalidate": {
        if (sawName(freshnessNames, name)) duplicateFreshnessDirective = true;
        if (delta === null) malformed = true;
        else if (name === "max-age")
          directives.maxAge = Math.min(directives.maxAge ?? delta, delta);
        else if (name === "s-maxage")
          directives.sMaxage = Math.min(directives.sMaxage ?? delta, delta);
        else if (name === "min-fresh")
          directives.minFresh = Math.max(directives.minFresh ?? delta, delta);
        else if (name === "stale-if-error")
          directives.staleIfError = Math.min(directives.staleIfError ?? delta, delta);
        else
          directives.staleWhileRevalidate = Math.min(
            directives.staleWhileRevalidate ?? delta,
            delta,
          );
        break;
      }
      case "max-stale":
        if (sawName(freshnessNames, name)) duplicateFreshnessDirective = true;
        if (argument === null) directives.maxStale = true;
        else if (delta === null) malformed = true;
        else if (directives.maxStale !== true)
          directives.maxStale = Math.min(directives.maxStale ?? delta, delta);
        break;
      case "no-cache":
        directives.noCache = addQualified(directives.noCache, argument);
        break;
      case "private":
        directives.private = addQualified(directives.private, argument);
        break;
      case "no-store":
        directives.noStore = true;
        if (argument !== null) malformed = true;
        break;
      case "no-transform":
        directives.noTransform = true;
        if (argument !== null) malformed = true;
        break;
      case "only-if-cached":
        directives.onlyIfCached = true;
        if (argument !== null) malformed = true;
        break;
      case "must-revalidate":
        directives.mustRevalidate = true;
        if (argument !== null) malformed = true;
        break;
      case "must-understand":
        if (argument === null) directives.mustUnderstand = true;
        else malformed = true;
        break;
      case "proxy-revalidate":
        directives.proxyRevalidate = true;
        if (argument !== null) malformed = true;
        break;
      case "public":
        if (argument === null) directives.public = true;
        else malformed = true;
        break;
      case "immutable":
        if (argument === null) directives.immutable = true;
        else malformed = true;
        break;
      default:
        directives.extensions.push({ name, value: argument });
        break;
    }
  }

  return { directives, malformed, duplicateFreshnessDirective };
}
