import { trimHTTPTabOrSpace } from "../core/ascii.ts";
import {
  coerceToBoolean,
  coerceToDOMString,
  requireArguments,
  requireDictionary,
  toLongLong,
} from "../core/webidl.ts";
import { Headers } from "../fetch/headers.ts";

export type CookieSameSite = "Strict" | "Lax" | "None";

/** The standalone Undici-compatible Set-Cookie helper shape. */
export interface Cookie {
  name: string;
  value: string;
  expires?: Date | number;
  maxAge?: number;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: CookieSameSite;
  unparsed?: string[];
}

export interface DeleteCookieAttributes {
  path?: string;
  domain?: string;
}

export type CookiePair = readonly [name: string, value: string];

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lowerMonths = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function requireHeaders(value: Headers, operation: string): void {
  if (!(value instanceof Headers)) throw new TypeError(operation + " requires Headers");
}

function hasCTLExcludingTab(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code >= 0 && code <= 8) || (code >= 10 && code <= 31) || code === 127) return true;
  }
  return false;
}

function validateCookieName(name: string): void {
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (
      code < 33 ||
      code > 126 ||
      code === 34 ||
      code === 40 ||
      code === 41 ||
      code === 44 ||
      code === 47 ||
      code === 58 ||
      code === 59 ||
      code === 60 ||
      code === 61 ||
      code === 62 ||
      code === 63 ||
      code === 64 ||
      code === 91 ||
      code === 92 ||
      code === 93 ||
      code === 123 ||
      code === 125
    ) {
      throw new TypeError("Invalid cookie name");
    }
  }
}

function validateCookieValue(value: string): void {
  let start = 0;
  let end = value.length;
  if (value.charCodeAt(0) === 34) {
    if (end === 1 || value.charCodeAt(end - 1) !== 34) {
      throw new TypeError("Invalid cookie value");
    }
    start++;
    end--;
  }
  for (let index = start; index < end; index++) {
    const code = value.charCodeAt(index);
    if (code < 33 || code > 126 || code === 34 || code === 44 || code === 59 || code === 92) {
      throw new TypeError("Invalid cookie value");
    }
  }
}

function isLetterOrDigit(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function validateCookieDomain(domain: string): void {
  if (domain.length === 0 || domain.length > 255) throw new TypeError("Invalid cookie domain");
  let labelLength = 0;
  for (let index = 0; index < domain.length; index++) {
    const code = domain.charCodeAt(index);
    if (code === 46) {
      if (labelLength === 0 || domain.charCodeAt(index - 1) === 45) {
        throw new TypeError("Invalid cookie domain");
      }
      labelLength = 0;
      continue;
    }
    if ((labelLength === 0 && !isLetterOrDigit(code)) || (!isLetterOrDigit(code) && code !== 45)) {
      throw new TypeError("Invalid cookie domain");
    }
    labelLength++;
    if (labelLength > 63) throw new TypeError("Invalid cookie domain");
  }
  if (labelLength === 0 || domain.charCodeAt(domain.length - 1) === 45) {
    throw new TypeError("Invalid cookie domain");
  }
}

function validateCookiePath(path: string): void {
  for (let index = 0; index < path.length; index++) {
    const code = path.charCodeAt(index);
    if (code < 32 || code > 126 || code === 59) throw new TypeError("Invalid cookie path");
  }
}

function twoDigits(value: number): string {
  return value < 10 ? "0" + value : `${value}`;
}

function toIMFDate(input: Date | number): string {
  const date = typeof input === "number" ? new Date(input) : input;
  const time = date.getTime();
  if (!Number.isFinite(time)) throw new TypeError("Invalid cookie expiry");
  const day = days[date.getUTCDay()];
  const month = months[date.getUTCMonth()];
  if (day === undefined || month === undefined) throw new TypeError("Invalid cookie expiry");
  return (
    day +
    ", " +
    twoDigits(date.getUTCDate()) +
    " " +
    month +
    " " +
    date.getUTCFullYear() +
    " " +
    twoDigits(date.getUTCHours()) +
    ":" +
    twoDigits(date.getUTCMinutes()) +
    ":" +
    twoDigits(date.getUTCSeconds()) +
    " GMT"
  );
}

function digitsAtStart(value: string, minimum: number, maximum: number): number {
  let length = 0;
  while (length < value.length && length < maximum) {
    const code = value.charCodeAt(length);
    if (code < 48 || code > 57) break;
    length++;
  }
  return length >= minimum ? length : 0;
}

function parseDecimalPrefix(value: string, length: number): number {
  let result = 0;
  for (let index = 0; index < length; index++) result = result * 10 + value.charCodeAt(index) - 48;
  return result;
}

function isDateDelimiter(code: number): boolean {
  return (
    code === 9 ||
    (code >= 32 && code <= 47) ||
    (code >= 59 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

function dateTokens(value: string): string[] {
  const result: string[] = [];
  let start = -1;
  for (let index = 0; index <= value.length; index++) {
    const delimiter = index === value.length || isDateDelimiter(value.charCodeAt(index));
    if (delimiter) {
      if (start >= 0) {
        result.push(value.slice(start, index));
        start = -1;
      }
    } else if (start < 0) start = index;
  }
  return result;
}

/** RFC6265bis cookie-date parsing, deliberately independent of host Date.parse. */
export function parseCookieDate(value: string): Date | null {
  let day = -1;
  let month = -1;
  let year = -1;
  let hour = -1;
  let minute = -1;
  let second = -1;

  for (const token of dateTokens(value)) {
    if (hour < 0) {
      const first = digitsAtStart(token, 1, 2);
      if (first > 0 && token.charCodeAt(first) === 58) {
        const tail = token.slice(first + 1);
        const secondLength = digitsAtStart(tail, 1, 2);
        if (secondLength > 0 && tail.charCodeAt(secondLength) === 58) {
          const last = tail.slice(secondLength + 1);
          const thirdLength = digitsAtStart(last, 1, 2);
          if (
            thirdLength > 0 &&
            (thirdLength === last.length || !isDigit(last.charCodeAt(thirdLength)))
          ) {
            hour = parseDecimalPrefix(token, first);
            minute = parseDecimalPrefix(tail, secondLength);
            second = parseDecimalPrefix(last, thirdLength);
            continue;
          }
        }
      }
    }
    if (day < 0) {
      const length = digitsAtStart(token, 1, 2);
      if (length > 0 && (length === token.length || !isDigit(token.charCodeAt(length)))) {
        day = parseDecimalPrefix(token, length);
        continue;
      }
    }
    if (month < 0 && token.length >= 3) {
      const candidate = token.slice(0, 3).toLowerCase();
      const index = lowerMonths.indexOf(candidate);
      if (index >= 0) {
        month = index;
        continue;
      }
    }
    if (year < 0) {
      const length = digitsAtStart(token, 2, 4);
      if (length >= 2 && (length === token.length || !isDigit(token.charCodeAt(length)))) {
        year = parseDecimalPrefix(token, length);
      }
    }
  }

  if (year >= 70 && year <= 99) year += 1900;
  else if (year >= 0 && year <= 69) year += 2000;
  if (
    day < 1 ||
    day > 31 ||
    month < 0 ||
    year < 1601 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  const time = Date.UTC(year, month, day, hour, minute, second);
  const date = new Date(time);
  if (
    !Number.isFinite(time) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  return date;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function parseMaxAge(value: string): number | undefined {
  if (value.length === 0) return undefined;
  let start = 0;
  if (value.charCodeAt(0) === 45) {
    if (value.length === 1) return undefined;
    start = 1;
  }
  for (let index = start; index < value.length; index++) {
    if (!isDigit(value.charCodeAt(index))) return undefined;
  }
  const result = Number(value);
  return Number.isFinite(result)
    ? result
    : result < 0
      ? Number.MIN_SAFE_INTEGER
      : Number.MAX_SAFE_INTEGER;
}

/** Parse one Set-Cookie field using RFC6265bis's liberal receiving algorithm. */
export interface ParsedCookie {
  readonly cookie: Cookie;
  readonly pathAttributePresent: boolean;
}

/** @internal The storage algorithm supplies the request URL's default path. */
export function parseCookieForRequest(input: string, defaultPath: string): ParsedCookie | null {
  const header = coerceToDOMString(input);
  if (hasCTLExcludingTab(header)) return null;
  const semicolon = header.indexOf(";");
  const pair = semicolon < 0 ? header : header.slice(0, semicolon);
  const equals = pair.indexOf("=");
  const name = trimHTTPTabOrSpace(equals < 0 ? "" : pair.slice(0, equals));
  const value = trimHTTPTabOrSpace(equals < 0 ? pair : pair.slice(equals + 1));
  if (name.length + value.length > 4096) return null;
  const result: Cookie = { name, value };
  const unparsed: string[] = [];
  let pathAttributePresent = false;
  let cursor = semicolon < 0 ? header.length + 1 : semicolon + 1;

  while (cursor <= header.length) {
    const next = header.indexOf(";", cursor);
    const part = next < 0 ? header.slice(cursor) : header.slice(cursor, next);
    cursor = next < 0 ? header.length + 1 : next + 1;
    const attributeEquals = part.indexOf("=");
    const attributeName = trimHTTPTabOrSpace(
      attributeEquals < 0 ? part : part.slice(0, attributeEquals),
    );
    const attributeValue = trimHTTPTabOrSpace(
      attributeEquals < 0 ? "" : part.slice(attributeEquals + 1),
    );
    if (attributeValue.length > 1024) continue;
    const key = attributeName.toLowerCase();
    if (key === "expires") {
      const expires = parseCookieDate(attributeValue);
      if (expires !== null) result.expires = expires;
    } else if (key === "max-age") {
      const maxAge = parseMaxAge(attributeValue);
      if (maxAge !== undefined) result.maxAge = maxAge;
    } else if (key === "domain") {
      result.domain = (
        attributeValue.charAt(0) === "." ? attributeValue.slice(1) : attributeValue
      ).toLowerCase();
    } else if (key === "path") {
      pathAttributePresent = true;
      result.path =
        attributeValue.length > 0 && attributeValue.charAt(0) === "/"
          ? attributeValue
          : defaultPath;
    } else if (key === "secure") result.secure = true;
    else if (key === "httponly") result.httpOnly = true;
    else if (key === "samesite") {
      const sameSite = attributeValue.toLowerCase();
      if (sameSite === "strict") result.sameSite = "Strict";
      else if (sameSite === "lax") result.sameSite = "Lax";
      else if (sameSite === "none") result.sameSite = "None";
    } else unparsed.push(attributeName + "=" + attributeValue);
  }
  if (unparsed.length > 0) result.unparsed = unparsed;
  return { cookie: result, pathAttributePresent };
}

export function parseCookie(input: string): Cookie | null {
  return parseCookieForRequest(input, "/")?.cookie ?? null;
}

function convertCookie(input: Cookie): Cookie {
  requireDictionary(input, "cookie");
  const result: Cookie = {
    name: coerceToDOMString(input.name),
    value: coerceToDOMString(input.value),
  };
  if (input.expires !== undefined && input.expires !== null) {
    result.expires =
      typeof input.expires === "number" && input.expires >= 0 && Number.isFinite(input.expires)
        ? new Date(Math.floor(input.expires))
        : typeof input.expires === "number"
          ? new Date(Number.NaN)
          : new Date(input.expires);
  }
  if (input.maxAge !== undefined && input.maxAge !== null) result.maxAge = toLongLong(input.maxAge);
  if (input.domain !== undefined && input.domain !== null)
    result.domain = coerceToDOMString(input.domain);
  if (input.path !== undefined && input.path !== null) result.path = coerceToDOMString(input.path);
  if (input.secure !== undefined && input.secure !== null)
    result.secure = coerceToBoolean(input.secure);
  if (input.httpOnly !== undefined && input.httpOnly !== null)
    result.httpOnly = coerceToBoolean(input.httpOnly);
  if (input.sameSite !== undefined) {
    const value = coerceToDOMString(input.sameSite);
    if (value !== "Strict" && value !== "Lax" && value !== "None") {
      throw new TypeError("Invalid cookie SameSite value");
    }
    result.sameSite = value;
  }
  const parts: string[] = [];
  if (input.unparsed !== undefined) {
    for (const part of input.unparsed) parts.push(coerceToDOMString(part));
  }
  result.unparsed = parts;
  return result;
}

/** Serialize one Set-Cookie field without allowing attributes to inject new fields. */
export function serializeCookie(input: Cookie): string | null {
  const cookie = convertCookie(input);
  if (cookie.name.length === 0) return null;
  validateCookieName(cookie.name);
  validateCookieValue(cookie.value);
  const output = [cookie.name + "=" + cookie.value];
  const lowerName = cookie.name.toLowerCase();
  const hostPrefix = lowerName.startsWith("__host-");
  const securePrefix = hostPrefix || lowerName.startsWith("__secure-");
  const secure = cookie.secure === true || securePrefix;
  const domain = hostPrefix ? undefined : cookie.domain;
  const path = hostPrefix ? "/" : cookie.path;
  if (secure) output.push("Secure");
  if (cookie.httpOnly === true) output.push("HttpOnly");
  if (cookie.maxAge !== undefined) {
    if (cookie.maxAge < 0) throw new TypeError("Invalid cookie max-age");
    output.push("Max-Age=" + cookie.maxAge);
  }
  if (domain !== undefined && domain.length > 0) {
    validateCookieDomain(domain);
    output.push("Domain=" + domain);
  }
  if (path !== undefined && path.length > 0) {
    validateCookiePath(path);
    output.push("Path=" + path);
  }
  if (
    cookie.expires !== undefined &&
    Number.isFinite(typeof cookie.expires === "number" ? cookie.expires : cookie.expires.getTime())
  ) {
    output.push("Expires=" + toIMFDate(cookie.expires));
  }
  if (cookie.sameSite !== undefined) output.push("SameSite=" + cookie.sameSite);
  for (const part of cookie.unparsed ?? []) {
    const equals = part.indexOf("=");
    if (equals < 0) throw new TypeError("Invalid unparsed cookie attribute");
    const name = trimHTTPTabOrSpace(part.slice(0, equals));
    const value = part.slice(equals + 1);
    validateCookieName(name);
    validateCookieValue(value);
    output.push(name + "=" + value);
  }
  return output.join("; ");
}

export function getSetCookies(headers: Headers): Cookie[] {
  requireArguments(arguments, 1, "getSetCookies");
  requireHeaders(headers, "getSetCookies");
  const result: Cookie[] = [];
  for (const value of headers.getSetCookie()) {
    const cookie = parseCookie(value);
    if (cookie !== null) result.push(cookie);
  }
  return result;
}

export function setCookie(headers: Headers, cookie: Cookie): void {
  requireArguments(arguments, 2, "setCookie");
  requireHeaders(headers, "setCookie");
  const value = serializeCookie(cookie);
  if (value !== null) headers.append("set-cookie", value);
}

export function deleteCookie(
  headers: Headers,
  name: string,
  attributes: DeleteCookieAttributes = {},
): void {
  requireArguments(arguments, 2, "deleteCookie");
  requireHeaders(headers, "deleteCookie");
  requireDictionary(attributes, "attributes");
  setCookie(headers, {
    name: coerceToDOMString(name),
    value: "",
    expires: 0,
    domain: attributes.domain,
    path: attributes.path,
  });
}

/** Parse a Cookie request field without constructing a dynamic property map. */
export function getCookiePairs(headers: Headers): CookiePair[] {
  requireArguments(arguments, 1, "getCookiePairs");
  requireHeaders(headers, "getCookiePairs");
  const value = headers.get("cookie");
  if (value === null || value.length === 0) return [];
  const result: CookiePair[] = [];
  for (const piece of value.split(";")) {
    const equals = piece.indexOf("=");
    const name = trimHTTPTabOrSpace(equals < 0 ? piece : piece.slice(0, equals));
    const cookieValue = equals < 0 ? "" : piece.slice(equals + 1);
    result.push([name, cookieValue]);
  }
  return result;
}
