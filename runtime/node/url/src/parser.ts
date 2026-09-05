// The WHATWG basic URL parser, from https://url.spec.whatwg.org/.
//
// From the standard rather than from node, because node's is C++: `node:url`
// hands `URL` to the `ada` parser through a binding, so there is no JavaScript
// to transcribe. What both implement is this algorithm, and the Web Platform
// Tests corpus that node checks itself against -- `urltestdata.json`, some six
// thousand cases -- is the same one we check against.
//
// The algorithm is a state machine over the input with a pointer that can move
// backwards, which is why it is written as an explicit loop with a `state`
// variable rather than as a recursive descent: several states re-examine a
// character they have already read, and one of them restarts the whole parse.
//
// Three things about it are unintuitive and all three are deliberate:
//
//   - A "special" scheme (http, https, ws, wss, ftp, file) parses differently
//     from every other. It gets a default port, treats a backslash as a
//     separator, and normalises its host. Nothing else does.
//   - Failure is a return value, not an exception. Most of the states can fail
//     and the caller decides whether that is a `TypeError` or a `null`.
//   - The path of a non-special URL may be a single opaque string rather than
//     a list of segments, and the two serialise differently.

import { ERR_INVALID_URL } from "../../internal/errors.ts";
import { decodeIn } from "../../buffer/src/encodings.ts";

export function isSpecialScheme(scheme: string): boolean {
  switch (scheme) {
    case "ftp":
    case "file":
    case "http":
    case "https":
    case "ws":
    case "wss":
      return true;
    default:
      return false;
  }
}

function defaultPort(scheme: string): number | null {
  switch (scheme) {
    case "ftp": return 21;
    case "http":
    case "ws": return 80;
    case "https":
    case "wss": return 443;
    default: return null;
  }
}

/**
 * A parsed URL, in the standard's terms.
 *
 * `path` is a list for a URL with a hierarchical path and a single string for
 * one with an opaque path -- `mailto:x@y` has no segments to speak of, and
 * treating its body as a one-element list would let `..` remove it.
 */
export interface UrlRecord {
  scheme: string;
  username: string;
  password: string;
  host: string | null;
  port: number | null;
  path: string[] | string;
  query: string | null;
  fragment: string | null;
}

export function hasOpaquePath(
  url: UrlRecord,
): url is UrlRecord & { path: string } {
  return typeof url.path === "string";
}

function hierarchicalPath(url: UrlRecord): string[] {
  const path = url.path;
  if (typeof path === "string") {
    throw new Error("URL hierarchical-path state invariant violated");
  }
  return path;
}

function opaquePath(url: UrlRecord): string {
  const path = url.path;
  if (typeof path !== "string") {
    throw new Error("URL opaque-path state invariant violated");
  }
  return path;
}

// ------------------------------------------------------------- code points

function isAsciiDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function isAsciiAlpha(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

function isAsciiAlphanumeric(c: number): boolean {
  return isAsciiAlpha(c) || isAsciiDigit(c);
}

function isAsciiHexDigit(c: number): boolean {
  return isAsciiDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

/** C0 controls and space are stripped only from the two ends. */
function trimC0ControlOrSpace(input: string): string {
  let start = 0;
  while (start < input.length && input.charCodeAt(start) <= 0x20) start++;

  let end = input.length;
  while (end > start && input.charCodeAt(end - 1) <= 0x20) end--;
  return start === 0 && end === input.length ? input : input.slice(start, end);
}

/** Tabs, LF, and CR are removed wherever the parser sees them. */
function removeTabsAndNewlines(input: string): string {
  let first = -1;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      first = index;
      break;
    }
  }
  if (first < 0) return input;

  let output = input.slice(0, first);
  let textStart = first + 1;
  for (let index = textStart; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      output += input.slice(textStart, index);
      textStart = index + 1;
    }
  }
  return output + input.slice(textStart);
}

function asciiDigitValue(code: number): number {
  if (isAsciiDigit(code)) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

function isAllAsciiDigits(input: string): boolean {
  if (input.length === 0) return false;
  for (let index = 0; index < input.length; index++) {
    if (!isAsciiDigit(input.charCodeAt(index))) return false;
  }
  return true;
}

/** `C:` or `C|` — the shape that makes a Windows drive letter. */
function isWindowsDriveLetter(s: string): boolean {
  return s.length === 2 && isAsciiAlpha(s.charCodeAt(0)) &&
    (s[1] === ":" || s[1] === "|");
}

/** The same, but only `C:` counts once the URL is normalised. */
function isNormalizedWindowsDriveLetter(s: string): boolean {
  return s.length === 2 && isAsciiAlpha(s.charCodeAt(0)) && s[1] === ":";
}

function startsWithWindowsDriveLetter(input: string, at: number): boolean {
  const rest = input.length - at;
  return rest >= 2 && isWindowsDriveLetter(input.slice(at, at + 2)) &&
    (rest === 2 || "/\\?#".includes(input[at + 2] ?? ""));
}

function isSingleDot(segment: string): boolean {
  const lower = segment.toLowerCase();
  return lower === "." || lower === "%2e";
}

function isDoubleDot(segment: string): boolean {
  const lower = segment.toLowerCase();
  return lower === ".." || lower === ".%2e" || lower === "%2e." || lower === "%2e%2e";
}

// ------------------------------------------------------- percent encoding

/**
 * One code point, percent-encoded in UTF-8.
 *
 * Byte by byte, because the escape is defined over the encoded form: a
 * character outside the Basic Multilingual Plane becomes four escapes, not
 * one.
 */
function percentEncode(codePoint: string): string {
  let out = "";
  for (const byte of utf8Bytes(codePoint)) {
    out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (const ch of str) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(
        0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f),
      );
    }
  }
  return out;
}

/**
 * The percent-encode sets, https://url.spec.whatwg.org/#percent-encoded-bytes.
 *
 * Each is a superset of the one before it. They are ordered that way in the
 * standard and the nesting is the point: a character escaped in a path is
 * escaped in a query, and the differences between them are small and
 * deliberate. `'` is escaped in a *special* query only, because a URL in an
 * HTML attribute delimited by single quotes would otherwise end early.
 */
function inC0ControlPercentEncodeSet(c: number): boolean {
  return c <= 0x1f || c > 0x7e;
}

function inFragmentPercentEncodeSet(c: number): boolean {
  return inC0ControlPercentEncodeSet(c) ||
    c === 0x20 || c === 0x22 || c === 0x3c || c === 0x3e || c === 0x60;
}

function inQueryPercentEncodeSet(c: number): boolean {
  return inC0ControlPercentEncodeSet(c) ||
    c === 0x20 || c === 0x22 || c === 0x23 || c === 0x3c || c === 0x3e;
}

function inSpecialQueryPercentEncodeSet(c: number): boolean {
  return inQueryPercentEncodeSet(c) || c === 0x27;
}

function inPathPercentEncodeSet(c: number): boolean {
  return inQueryPercentEncodeSet(c) ||
    c === 0x3f || c === 0x5e || c === 0x60 || c === 0x7b || c === 0x7d;
}

function inUserinfoPercentEncodeSet(c: number): boolean {
  return inPathPercentEncodeSet(c) ||
    c === 0x2f || c === 0x3a || c === 0x3b || c === 0x3d || c === 0x40 ||
    (c >= 0x5b && c <= 0x5e) || c === 0x7c;
}

/** Everything a URL component may not carry when it stands on its own. */
function inComponentPercentEncodeSet(c: number): boolean {
  return inUserinfoPercentEncodeSet(c) ||
    (c >= 0x24 && c <= 0x26) || c === 0x2b || c === 0x2c;
}

/**
 * `application/x-www-form-urlencoded`, which is the widest of the sets.
 *
 * It escapes several characters a URL would keep -- `!`, `'`, `(`, `)`, `~` --
 * because a form-encoded body is read by software older than the URL standard,
 * and those characters have meant something in some of it.
 */
export function inUrlencodedPercentEncodeSet(c: number): boolean {
  return inComponentPercentEncodeSet(c) ||
    c === 0x21 || (c >= 0x27 && c <= 0x29) || c === 0x7e;
}

/**
 * A user or password, encoded for storage.
 *
 * The setters use this rather than re-entering the parser: a value containing
 * `/` or `@` is not a syntax error there, it is a value that has to be escaped
 * so that it cannot be read as the end of the credentials.
 */
export function percentEncodeUserinfo(input: string): string {
  return utf8PercentEncodeString(input, inUserinfoPercentEncodeSet);
}

type EncodeSet = (c: number) => boolean;

function utf8PercentEncodeString(input: string, inSet: EncodeSet): string {
  let out = "";
  for (const ch of input) {
    const c = ch.codePointAt(0) ?? 0;
    out += inSet(c) ? percentEncode(ch) : ch;
  }
  return out;
}

/** `%41` back to `A`, leaving a malformed escape alone. */
export function percentDecodeBytes(input: string): Uint8Array {
  const bytes: number[] = [];
  const raw = utf8Bytes(input);
  for (let i = 0; i < raw.length; i++) {
    const byte = raw[i];
    if (byte === undefined) break;
    const firstHex = raw[i + 1];
    const secondHex = raw[i + 2];
    if (byte !== 0x25 || firstHex === undefined || secondHex === undefined ||
        !isAsciiHexDigit(firstHex) || !isAsciiHexDigit(secondHex)) {
      bytes.push(byte);
      continue;
    }
    bytes.push(Number.parseInt(String.fromCharCode(firstHex, secondHex), 16));
    i += 2;
  }
  return new Uint8Array(bytes);
}

export function percentDecodeString(input: string): string {
  const bytes = percentDecodeBytes(input);
  return decodeIn(bytes, 0, bytes.length, "utf8");
}

// ------------------------------------------------------------------ hosts

/**
 * Is this a valid opaque host? Everything except the forbidden code points.
 *
 * A non-special scheme does not have a *domain*, only a string, so no IDNA and
 * no IPv4 shorthand. `web+demo://%zz` keeps its `%zz`.
 */
const FORBIDDEN_HOST = new Set([
  0x00, 0x09, 0x0a, 0x0d, 0x20, 0x23, 0x2f, 0x3a, 0x3c, 0x3e, 0x3f,
  0x40, 0x5b, 0x5c, 0x5d, 0x5e, 0x7c,
]);

/** The domain set adds `%`, since a domain is percent-decoded before parsing. */
function isForbiddenDomainCodePoint(c: number): boolean {
  return FORBIDDEN_HOST.has(c) || c <= 0x1f || c === 0x25 || c === 0x7f;
}

function parseOpaqueHost(input: string): string | null {
  for (const ch of input) {
    if (FORBIDDEN_HOST.has(ch.codePointAt(0) ?? 0)) {
      return null;
    }
  }
  // Only the forbidden-host set, not the wider domain one: a non-special
  // scheme's host is an arbitrary string and `sc://\u0001/` is a valid URL.
  return utf8PercentEncodeString(input, inC0ControlPercentEncodeSet);
}

/**
 * `1.2.3.4`, `0x7f.1`, `2130706433` — the four historical spellings.
 *
 * Returns the address as a number, `null` when the input is not an IPv4
 * address at all (so the caller should treat it as a domain), or `false` when
 * it looks like one and is malformed (so the caller must fail).
 */
function parseIPv4Number(input: string): { value: number; validationError: boolean } | null {
  if (input === "") return null;
  let validationError = false;
  let radix = 10;
  let rest = input;

  if (rest.length >= 2 && rest[0] === "0" && (rest[1] === "x" || rest[1] === "X")) {
    validationError = true;
    rest = rest.slice(2);
    radix = 16;
  } else if (rest.length >= 2 && rest[0] === "0") {
    validationError = true;
    rest = rest.slice(1);
    radix = 8;
  }

  if (rest === "") return { value: 0, validationError: true };

  let value = 0;
  for (let index = 0; index < rest.length; index++) {
    const digit = asciiDigitValue(rest.charCodeAt(index));
    if (digit < 0 || digit >= radix) return null;
    value = value * radix + digit;
  }
  return { value, validationError };
}

/**
 * https://url.spec.whatwg.org/#ends-in-a-number-checker
 *
 * This is what decides whether a host is *meant* to be an IPv4 address, and it
 * has to be decided before parsing: `http://foo.2.3.4` is a failure rather
 * than a domain named `foo.2.3.4`, because its last label is a number and so
 * the whole thing claims to be an address. Without the check a malformed
 * address quietly becomes a domain name that will not resolve.
 */
function endsInANumber(input: string): boolean {
  const parts = input.split(".");
  if (parts[parts.length - 1] === "" && parts.length > 1) {
    parts.pop();
  }
  if (parts.length === 0) return false;
  const last = parts[parts.length - 1];
  if (last === undefined) return false;
  if (isAllAsciiDigits(last)) return true;
  return parseIPv4Number(last) !== null;
}

/** Only called when `endsInANumber`, so anything short of an address fails. */
function parseIPv4(input: string): number | false {
  const parts = input.split(".");
  // A trailing dot is allowed and ignored: `1.2.3.4.` is `1.2.3.4`.
  if (parts.length > 1 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  if (parts.length > 4) return false;

  let address = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === undefined) return false;
    const parsed = parseIPv4Number(part);
    if (parsed === null) return false;
    const isLast = index === parts.length - 1;
    if (isLast) {
      // The last part fills every byte left in the address:
      // `1.2.65534` is `1.2.255.254`.
      if (parsed.value >= 256 ** (5 - parts.length)) return false;
      address += parsed.value;
    } else {
      if (parsed.value > 255) return false;
      address += parsed.value * 256 ** (3 - index);
    }
  }
  return address;
}

function serializeIPv4(address: number): string {
  let out = "";
  let n = address;
  for (let i = 1; i <= 4; i++) {
    out = String(n % 256) + out;
    if (i !== 4) out = `.${out}`;
    n = Math.floor(n / 256);
  }
  return out;
}

/** https://url.spec.whatwg.org/#concept-ipv6-parser */
function parseIPv6(input: string): number[] | null {
  const address = [0, 0, 0, 0, 0, 0, 0, 0];
  let pieceIndex = 0;
  let compress: number | null = null;
  const chars = [...input];
  let pointer = 0;
  const c = (): string | undefined => chars[pointer];

  if (c() === ":") {
    if (chars[pointer + 1] !== ":") return null;
    pointer += 2;
    pieceIndex++;
    compress = pieceIndex;
  }

  while (pointer < chars.length) {
    if (pieceIndex === 8) return null;
    if (c() === ":") {
      if (compress !== null) return null;
      pointer++;
      pieceIndex++;
      compress = pieceIndex;
      continue;
    }
    let value = 0;
    let length = 0;
    let current = c();
    while (length < 4 && current !== undefined && isAsciiHexDigit(current.charCodeAt(0))) {
      value = value * 16 + Number.parseInt(current, 16);
      pointer++;
      length++;
      current = c();
    }
    if (c() === ".") {
      // An IPv4 address in the last two pieces: `::ffff:192.0.2.1`.
      if (length === 0) return null;
      pointer -= length;
      if (pieceIndex > 6) return null;
      let numbersSeen = 0;
      while (c() !== undefined) {
        let ipv4Piece: number | null = null;
        if (numbersSeen > 0) {
          if (c() === "." && numbersSeen < 4) {
            pointer++;
          } else {
            return null;
          }
        }
        current = c();
        if (current === undefined || !isAsciiDigit(current.charCodeAt(0))) return null;
        while (current !== undefined && isAsciiDigit(current.charCodeAt(0))) {
          const number = Number(current);
          if (ipv4Piece === null) {
            ipv4Piece = number;
          } else if (ipv4Piece === 0) {
            return null;
          } else {
            ipv4Piece = ipv4Piece * 10 + number;
          }
          if (ipv4Piece > 255) return null;
          pointer++;
          current = c();
        }
        if (ipv4Piece === null) return null;
        address[pieceIndex] = (address[pieceIndex] ?? 0) * 256 + ipv4Piece;
        numbersSeen++;
        if (numbersSeen === 2 || numbersSeen === 4) pieceIndex++;
      }
      if (numbersSeen !== 4) return null;
      break;
    } else if (c() === ":") {
      pointer++;
      if (c() === undefined) return null;
    } else if (c() !== undefined) {
      return null;
    }
    address[pieceIndex] = value;
    pieceIndex++;
  }

  if (compress !== null) {
    // Move the pieces after the `::` to the end, filling the middle with zeros.
    let swaps = pieceIndex - compress;
    pieceIndex = 7;
    while (pieceIndex !== 0 && swaps > 0) {
      const tmp = address[compress + swaps - 1] ?? 0;
      address[compress + swaps - 1] = address[pieceIndex] ?? 0;
      address[pieceIndex] = tmp;
      pieceIndex--;
      swaps--;
    }
  } else if (pieceIndex !== 8) {
    return null;
  }

  return address;
}

/**
 * The shortest serialisation, https://url.spec.whatwg.org/#concept-ipv6-serializer.
 *
 * The longest run of zeroes becomes `::`, and only a run longer than one — a
 * single zero piece is shorter written out than compressed.
 */
function serializeIPv6(address: readonly number[]): string {
  let out = "";
  let compress: number | null = null;
  let longest = 1;
  let run = 0;
  let runStart = 0;
  for (let i = 0; i < 8; i++) {
    if (address[i] === 0) {
      if (run === 0) runStart = i;
      run++;
      if (run > longest) {
        longest = run;
        compress = runStart;
      }
    } else {
      run = 0;
    }
  }

  let ignore0 = false;
  for (let pieceIndex = 0; pieceIndex < 8; pieceIndex++) {
    if (ignore0 && address[pieceIndex] === 0) continue;
    if (ignore0) ignore0 = false;
    if (compress === pieceIndex) {
      out += pieceIndex === 0 ? "::" : ":";
      ignore0 = true;
      continue;
    }
    out += (address[pieceIndex] ?? 0).toString(16);
    if (pieceIndex !== 7) out += ":";
  }
  return out;
}

/** IDNA, as far as it goes without ICU: `toASCII` from punycode. */
export type DomainToAscii = (domain: string) => string | null;

let domainToAsciiImpl: DomainToAscii = (domain) => domain;

/**
 * Supplied by the module rather than imported, so this file has no dependency
 * on `node:punycode` -- IDNA is one substitutable step of host parsing, and
 * an ICU-backed implementation would replace it here.
 */
export function setDomainToAscii(fn: DomainToAscii): void {
  domainToAsciiImpl = fn;
}

/** https://url.spec.whatwg.org/#concept-host-parser */
export function parseHost(input: string, isNotSpecial: boolean): string | null {
  if (input.startsWith("[")) {
    if (!input.endsWith("]")) return null;
    const address = parseIPv6(input.slice(1, -1));
    return address === null ? null : `[${serializeIPv6(address)}]`;
  }

  if (isNotSpecial) {
    return parseOpaqueHost(input);
  }
  if (input === "") return null;

  const domain = percentDecodeString(input);
  const ascii = domainToAsciiImpl(domain);
  // An input that maps to nothing -- a lone soft hyphen -- is a failure, not
  // an empty host.
  if (ascii === null || ascii === "") return null;

  for (const ch of ascii) {
    if (isForbiddenDomainCodePoint(ch.codePointAt(0) ?? 0)) return null;
  }

  if (endsInANumber(ascii)) {
    const ipv4 = parseIPv4(ascii);
    return ipv4 === false ? null : serializeIPv4(ipv4);
  }
  return ascii;
}

// ------------------------------------------------------------ the machine

/**
 * The states of https://url.spec.whatwg.org/#url-parsing, in the standard's
 * order and under its names.
 */
const State = {
  SchemeStart: 0,
  Scheme: 1,
  NoScheme: 2,
  SpecialRelativeOrAuthority: 3,
  PathOrAuthority: 4,
  Relative: 5,
  RelativeSlash: 6,
  SpecialAuthoritySlashes: 7,
  SpecialAuthorityIgnoreSlashes: 8,
  Authority: 9,
  Host: 10,
  Port: 11,
  File: 12,
  FileSlash: 13,
  FileHost: 14,
  PathStart: 15,
  Path: 16,
  OpaquePath: 17,
  Query: 18,
  Fragment: 19,
} as const;

type State = (typeof State)[keyof typeof State];

/** Which component `parse` was asked to start at, when overriding a setter. */
export type StateOverride =
  | "scheme" | "username" | "password" | "hostname" | "port"
  | "pathname" | "search" | "hash" | "host";

function newRecord(): UrlRecord {
  return {
    scheme: "",
    username: "",
    password: "",
    host: null,
    port: null,
    path: [],
    query: null,
    fragment: null,
  };
}

function includesCredentials(url: UrlRecord): boolean {
  return url.username !== "" || url.password !== "";
}

/** A single `.` or `..` segment is removed rather than kept, except for a drive. */
function shortenPath(url: UrlRecord): void {
  const path = hierarchicalPath(url);
  if (path.length === 0) return;
  // A Windows drive letter is not a path segment that `..` can climb out of.
  const first = path[0];
  if (url.scheme === "file" && path.length === 1 &&
      first !== undefined && isNormalizedWindowsDriveLetter(first)) {
    return;
  }
  path.pop();
}

/**
 * The basic URL parser.
 *
 * `base` is the URL a relative reference is resolved against. `url` and
 * `stateOverride` are set when a setter is re-parsing one component of an
 * existing URL, which is how `url.protocol = 'https'` is specified: the same
 * machine, entered part-way through.
 */
export function basicUrlParse(
  input: string,
  base?: UrlRecord | null,
  url?: UrlRecord,
  stateOverride?: StateOverride,
): UrlRecord | null {
  const isOverride = stateOverride !== undefined;
  if (url === undefined) {
    url = newRecord();
    // Only on a fresh parse: a setter's input is not trimmed.
    input = trimC0ControlOrSpace(input);
  }
  // Tabs and newlines are removed wherever they appear, in both cases.
  input = removeTabsAndNewlines(input);

  let state: State = State.SchemeStart;
  switch (stateOverride) {
    case "scheme":
      state = State.SchemeStart;
      break;
    case "username":
    case "password":
      state = State.Authority;
      break;
    case "host":
    case "hostname":
      state = State.Host;
      break;
    case "port":
      state = State.Port;
      break;
    case "pathname":
      state = State.PathStart;
      break;
    case "search":
      state = State.Query;
      break;
    case "hash":
      state = State.Fragment;
      break;
  }
  let buffer = "";
  let atSignSeen = false;
  let insideBrackets = false;
  let passwordTokenSeen = false;
  let pointer = 0;

  const chars = [...input];
  const len = chars.length;
  // `undefined` stands for the standard's EOF, which several states test for.
  const at = (i: number): string | undefined => chars[i];

  const fail = (): null => null;

  for (; pointer <= len; pointer++) {
    const c = at(pointer);
    const code = c === undefined ? -1 : (c.codePointAt(0) ?? -1);

    switch (state) {
      case State.SchemeStart: {
        if (c !== undefined && isAsciiAlpha(code)) {
          buffer += c.toLowerCase();
          state = State.Scheme;
        } else if (!isOverride) {
          state = State.NoScheme;
          pointer--;
        } else {
          return fail();
        }
        break;
      }

      case State.Scheme: {
        if (c !== undefined && (isAsciiAlphanumeric(code) || c === "+" || c === "-" || c === ".")) {
          buffer += c.toLowerCase();
          break;
        }
        if (c === ":") {
          if (isOverride) {
            // A setter may not change a special scheme into a non-special one
            // or the other way round: the two parse differently, and the rest
            // of the URL was parsed under the old rules.
            if (isSpecialScheme(url.scheme) !== isSpecialScheme(buffer)) return url;
            if (includesCredentials(url) || url.port !== null) {
              if (buffer === "file") return url;
            }
            if (url.scheme === "file" && url.host === "") return url;
          }
          url.scheme = buffer;
          if (isOverride) {
            if (url.port === defaultPort(url.scheme)) url.port = null;
            return url;
          }
          buffer = "";
          if (url.scheme === "file") {
            state = State.File;
          } else if (isSpecialScheme(url.scheme) && base && base.scheme === url.scheme) {
            state = State.SpecialRelativeOrAuthority;
          } else if (isSpecialScheme(url.scheme)) {
            state = State.SpecialAuthoritySlashes;
          } else if (at(pointer + 1) === "/") {
            state = State.PathOrAuthority;
            pointer++;
          } else {
            url.path = "";
            state = State.OpaquePath;
          }
          break;
        }
        if (!isOverride) {
          buffer = "";
          state = State.NoScheme;
          pointer = -1;
          break;
        }
        return fail();
      }

      case State.NoScheme: {
        if (!base || (hasOpaquePath(base) && c !== "#")) return fail();
        if (hasOpaquePath(base) && c === "#") {
          url.scheme = base.scheme;
          url.path = base.path;
          url.query = base.query;
          url.fragment = "";
          state = State.Fragment;
          break;
        }
        state = base.scheme === "file" ? State.File : State.Relative;
        pointer--;
        break;
      }

      case State.SpecialRelativeOrAuthority: {
        if (c === "/" && at(pointer + 1) === "/") {
          state = State.SpecialAuthorityIgnoreSlashes;
          pointer++;
        } else {
          state = State.Relative;
          pointer--;
        }
        break;
      }

      case State.PathOrAuthority: {
        if (c === "/") {
          state = State.Authority;
        } else {
          state = State.Path;
          pointer--;
        }
        break;
      }

      case State.Relative: {
        if (base === undefined || base === null) return fail();
        url.scheme = base.scheme;
        if (c === "/" || (isSpecialScheme(url.scheme) && c === "\\")) {
          state = State.RelativeSlash;
          break;
        }
        url.username = base.username;
        url.password = base.password;
        url.host = base.host;
        url.port = base.port;
        url.path = Array.isArray(base.path) ? base.path.slice() : base.path;
        url.query = base.query;
        if (c === "?") {
          url.query = "";
          state = State.Query;
        } else if (c === "#") {
          url.fragment = "";
          state = State.Fragment;
        } else if (c !== undefined) {
          url.query = null;
          shortenPath(url);
          state = State.Path;
          pointer--;
        }
        break;
      }

      case State.RelativeSlash: {
        if (base === undefined || base === null) return fail();
        if (isSpecialScheme(url.scheme) && (c === "/" || c === "\\")) {
          state = State.SpecialAuthorityIgnoreSlashes;
        } else if (c === "/") {
          state = State.Authority;
        } else {
          url.username = base.username;
          url.password = base.password;
          url.host = base.host;
          url.port = base.port;
          state = State.Path;
          pointer--;
        }
        break;
      }

      case State.SpecialAuthoritySlashes: {
        if (c === "/" && at(pointer + 1) === "/") {
          state = State.SpecialAuthorityIgnoreSlashes;
          pointer++;
        } else {
          state = State.SpecialAuthorityIgnoreSlashes;
          pointer--;
        }
        break;
      }

      case State.SpecialAuthorityIgnoreSlashes: {
        if (c !== "/" && c !== "\\") {
          state = State.Authority;
          pointer--;
        }
        break;
      }

      case State.Authority: {
        if (c === "@") {
          // Everything before the *last* `@` is credentials, so the buffer is
          // re-encoded rather than assigned: `a@b@c` has username `a%40b`.
          if (atSignSeen) buffer = `%40${buffer}`;
          atSignSeen = true;
          for (const ch of buffer) {
            if (ch === ":" && !passwordTokenSeen) {
              passwordTokenSeen = true;
              continue;
            }
            const encoded = utf8PercentEncodeString(ch, inUserinfoPercentEncodeSet);
            if (passwordTokenSeen) {
              url.password += encoded;
            } else {
              url.username += encoded;
            }
          }
          buffer = "";
          break;
        }
        if (
          c === undefined || c === "/" || c === "?" || c === "#" ||
          (isSpecialScheme(url.scheme) && c === "\\")
        ) {
          if (atSignSeen && buffer === "") return fail();
          pointer -= [...buffer].length + 1;
          buffer = "";
          state = State.Host;
          break;
        }
        buffer += c;
        break;
      }

      case State.Host: {
        if (isOverride && url.scheme === "file") {
          pointer--;
          state = State.FileHost;
          break;
        }
        if (c === ":" && !insideBrackets) {
          if (buffer === "") return fail();
          if (stateOverride === "hostname") return url;
          const host = parseHost(buffer, !isSpecialScheme(url.scheme));
          if (host === null) return fail();
          url.host = host;
          buffer = "";
          state = State.Port;
          break;
        }
        if (
          c === undefined || c === "/" || c === "?" || c === "#" ||
          (isSpecialScheme(url.scheme) && c === "\\")
        ) {
          pointer--;
          if (isSpecialScheme(url.scheme) && buffer === "") return fail();
          if (isOverride && buffer === "" && (includesCredentials(url) || url.port !== null)) {
            return url;
          }
          const host = parseHost(buffer, !isSpecialScheme(url.scheme));
          if (host === null) return fail();
          url.host = host;
          buffer = "";
          state = State.PathStart;
          if (isOverride) return url;
          break;
        }
        if (c === "[") insideBrackets = true;
        if (c === "]") insideBrackets = false;
        buffer += c;
        break;
      }

      case State.Port: {
        if (c !== undefined && isAsciiDigit(code)) {
          buffer += c;
          break;
        }
        if (
          c === undefined || c === "/" || c === "?" || c === "#" ||
          (isSpecialScheme(url.scheme) && c === "\\") || isOverride
        ) {
          if (buffer !== "") {
            const port = Number(buffer);
            if (port > 65535) return fail();
            // The default is not stored, so that it does not serialise.
            url.port = port === defaultPort(url.scheme) ? null : port;
            buffer = "";
          }
          if (isOverride) return url;
          state = State.PathStart;
          pointer--;
          break;
        }
        return fail();
      }

      case State.File: {
        url.scheme = "file";
        url.host = "";
        if (c === "/" || c === "\\") {
          state = State.FileSlash;
          break;
        }
        if (base && base.scheme === "file") {
          url.host = base.host;
          url.path = Array.isArray(base.path) ? base.path.slice() : base.path;
          url.query = base.query;
          if (c === "?") {
            url.query = "";
            state = State.Query;
          } else if (c === "#") {
            url.fragment = "";
            state = State.Fragment;
          } else if (c !== undefined) {
            url.query = null;
            // A drive letter starts a new path rather than continuing the
            // base's: `file:///C:/a` resolved against `file:///D:/b` is not
            // under `D:`.
            if (!startsWithWindowsDriveLetter(input, pointer)) {
              shortenPath(url);
            } else {
              url.path = [];
            }
            state = State.Path;
            pointer--;
          }
          break;
        }
        state = State.Path;
        pointer--;
        break;
      }

      case State.FileSlash: {
        if (c === "/" || c === "\\") {
          state = State.FileHost;
          break;
        }
        if (base && base.scheme === "file") {
          url.host = base.host;
          if (hasOpaquePath(base)) return fail();
          const basePath = base.path;
          const firstBaseSegment = basePath[0];
          // `/x` against `file://h/C:/a` keeps the drive: on Windows an
          // absolute path is absolute within a drive, not above it.
          if (!startsWithWindowsDriveLetter(input, pointer) &&
              firstBaseSegment !== undefined &&
              isNormalizedWindowsDriveLetter(firstBaseSegment)) {
            hierarchicalPath(url).push(firstBaseSegment);
          }
        }
        state = State.Path;
        pointer--;
        break;
      }

      case State.FileHost: {
        if (c === undefined || c === "/" || c === "\\" || c === "?" || c === "#") {
          pointer--;
          // `file://C:/` is not a host: the drive letter belongs to the path.
          if (!isOverride && isWindowsDriveLetter(buffer)) {
            state = State.Path;
            break;
          }
          if (buffer === "") {
            url.host = "";
            if (isOverride) return url;
            state = State.PathStart;
            break;
          }
          let host = parseHost(buffer, !isSpecialScheme(url.scheme));
          if (host === null) return fail();
          // `localhost` is spelled as the empty host, which is what makes
          // `file://localhost/x` and `file:///x` the same URL.
          if (host === "localhost") host = "";
          url.host = host;
          if (isOverride) return url;
          buffer = "";
          state = State.PathStart;
          break;
        }
        buffer += c;
        break;
      }

      case State.PathStart: {
        if (isSpecialScheme(url.scheme)) {
          state = State.Path;
          if (c !== "/" && c !== "\\") pointer--;
          break;
        }
        if (!isOverride && c === "?") {
          url.query = "";
          state = State.Query;
          break;
        }
        if (!isOverride && c === "#") {
          url.fragment = "";
          state = State.Fragment;
          break;
        }
        if (c !== undefined) {
          state = State.Path;
          if (c !== "/") pointer--;
          break;
        }
        if (isOverride && url.host === null) {
          hierarchicalPath(url).push("");
        }
        break;
      }

      case State.Path: {
        const atEnd = c === undefined ||
          c === "/" ||
          (isSpecialScheme(url.scheme) && c === "\\") ||
          (!isOverride && (c === "?" || c === "#"));
        if (!atEnd) {
          if (c !== undefined) {
            buffer += utf8PercentEncodeString(c, inPathPercentEncodeSet);
          }
          break;
        }
        const path = hierarchicalPath(url);
        if (isDoubleDot(buffer)) {
          shortenPath(url);
          if (c !== "/" && !(isSpecialScheme(url.scheme) && c === "\\")) {
            path.push("");
          }
        } else if (isSingleDot(buffer)) {
          if (c !== "/" && !(isSpecialScheme(url.scheme) && c === "\\")) {
            path.push("");
          }
        } else {
          // `file:///C|/` normalises the bar to a colon, so that the two
          // spellings of a drive letter are one URL.
          if (url.scheme === "file" && path.length === 0 && isWindowsDriveLetter(buffer)) {
            buffer = `${buffer[0]}:`;
          }
          path.push(buffer);
        }
        buffer = "";
        if (c === "?") {
          url.query = "";
          state = State.Query;
        } else if (c === "#") {
          url.fragment = "";
          state = State.Fragment;
        }
        break;
      }

      case State.OpaquePath: {
        // Without this the space would serialise bare and re-parse as the end
        // of the path, losing it: `x:a ?q` and `x:a?q` would be one URL.
        if (c === " " && (at(pointer + 1) === "?" || at(pointer + 1) === "#")) {
          url.path = `${opaquePath(url)}%20`;
          break;
        }
        if (c === "?") {
          url.query = "";
          state = State.Query;
          break;
        }
        if (c === "#") {
          url.fragment = "";
          state = State.Fragment;
          break;
        }
        if (c !== undefined) {
          url.path = opaquePath(url) + utf8PercentEncodeString(c, inC0ControlPercentEncodeSet);
        }
        break;
      }

      case State.Query: {
        if (c === "#" && !isOverride) {
          url.fragment = "";
          state = State.Fragment;
          break;
        }
        if (c !== undefined) {
          const inSet = isSpecialScheme(url.scheme)
            ? inSpecialQueryPercentEncodeSet
            : inQueryPercentEncodeSet;
          url.query = (url.query ?? "") + utf8PercentEncodeString(c, inSet);
        }
        break;
      }

      case State.Fragment: {
        if (c !== undefined) {
          url.fragment = (url.fragment ?? "") +
            utf8PercentEncodeString(c, inFragmentPercentEncodeSet);
        }
        break;
      }
    }
  }

  return url;
}

/** https://url.spec.whatwg.org/#url-serializing */
export function serializeUrl(url: UrlRecord, excludeFragment = false): string {
  let out = `${url.scheme}:`;
  if (url.host !== null) {
    out += "//";
    if (includesCredentials(url)) {
      out += url.username;
      if (url.password !== "") out += `:${url.password}`;
      out += "@";
    }
    out += serializeHost(url);
  } else if (!hasOpaquePath(url) && url.path.length > 1 && url.path[0] === "") {
    // `non-special:/.//p` — without the `/.` the URL would re-parse with an
    // empty host rather than a path that begins with two slashes.
    out += "/.";
  }
  out += serializePath(url);
  if (url.query !== null) out += `?${url.query}`;
  if (!excludeFragment && url.fragment !== null) out += `#${url.fragment}`;
  return out;
}

export function serializeHost(url: UrlRecord): string {
  if (url.host === null) return "";
  return url.port === null ? url.host : `${url.host}:${url.port}`;
}

export function serializePath(url: UrlRecord): string {
  const path = url.path;
  if (typeof path === "string") return path;
  return path.map((segment) => `/${segment}`).join("");
}

/**
 * https://url.spec.whatwg.org/#concept-url-origin
 *
 * An opaque origin is `"null"` — two of them are never the same origin, which
 * is what makes `null` the right answer for a `data:` or `blob:` URL.
 */
export function serializeOrigin(url: UrlRecord): string {
  switch (url.scheme) {
    case "ftp":
    case "http":
    case "https":
    case "ws":
    case "wss":
      return `${url.scheme}://${serializeHost(url)}`;
    case "blob": {
      const path = hasOpaquePath(url) ? url.path : "";
      const inner = basicUrlParse(path);
      return inner === null ? "null" : serializeOrigin(inner);
    }
    default:
      return "null";
  }
}

/** The public entry: parse or throw the error node throws. */
export function parseUrl(input: string, base?: string): UrlRecord {
  let baseRecord: UrlRecord | null = null;
  if (base !== undefined) {
    baseRecord = basicUrlParse(base);
    if (baseRecord === null) {
      throw new ERR_INVALID_URL(base);
    }
  }
  const record = basicUrlParse(input, baseRecord);
  if (record === null) {
    throw new ERR_INVALID_URL(input);
  }
  return record;
}
