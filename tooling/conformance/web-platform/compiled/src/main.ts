// Shared Web-platform source compiled and executed by NTS.
//
// Everything else in this lane is host evidence: TypeScript running on node, which
// says the algorithms are right and nothing about whether they compile. This is the
// other axis, and it started at zero.
//
// What is here is what currently compiles. Modules reachable only through the wider
// import graph pull in the whole runtime and its 1,300 refusals, so the frontier is
// not a judgement about which code matters -- it is a measurement of where the
// compiler is, and it should grow as prerequisites land rather than by being
// rewritten to fit.
//
// `nts check` generates cases, runs them compiled, runs them on the oracle and
// compares. Agreement here is compiled-provider evidence for the backend it ran on.

import {
  certificateCovers,
  dnsNameCovers,
} from "../../../../../runtime/web-platform/src/http/certificate.ts";
import {
  isASCIIWhitespace,
  isHTTPTabOrSpace,
  isHTTPWhitespace,
  trimASCIIWhitespace,
  trimHTTPTabOrSpace,
  trimHTTPWhitespace,
  trimTrailingHTTPWhitespace,
} from "../../../../../runtime/web-platform/src/core/ascii.ts";
import {
  utf8Decode,
  utf8Length,
  utf8Write,
} from "../../../../../runtime/web-platform/src/core/utf8.ts";
import { forgivingBase64Decode } from "../../../../../runtime/web-platform/src/core/base64.ts";
import { percentDecodeBytes } from "../../../../../runtime/web-platform/src/core/percent.ts";
import {
  member,
  numberText,
  quoteJSONString,
  resolveGap,
} from "../../../../../runtime/web-platform/src/json/text.ts";
import { arrayIndexOf, JsonValue } from "../../../../../runtime/web-platform/src/json/value.ts";

/** dNSName matching, including the wildcard rules HTTP/2 coalescing depends on. */
export function covers(presented: string, host: string): boolean {
  return dnsNameCovers(presented, host);
}

export function coveredByAny(host: string): boolean {
  return certificateCovers(["a.test", "*.b.test"], host);
}

/** The ASCII whitespace predicate the integrity and header parsers tokenize with. */
export function whitespace(code: number): boolean {
  return isASCIIWhitespace(code);
}

export function trimmed(value: string): string {
  return trimHTTPTabOrSpace(value);
}

/** Infra's forgiving base64, which subresource integrity compares digests through. */
export function base64Length(input: string): number {
  const bytes = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index++) {
    bytes[index] = input.charCodeAt(index) & 0xff;
  }
  const decoded = forgivingBase64Decode(bytes);
  return decoded === null ? -1 : decoded.length;
}

/** Percent decoding, reported as a length so the result stays scalar. */
export function percentDecodedLength(input: string): number {
  return percentDecodeBytes(input).length;
}

// The rest of the ASCII predicates and trims. Free coverage: the module is already
// compiled for the two the fixture happened to name first, and three whitespace
// definitions that differ by two characters are exactly where a transcription slip
// would live.
export function httpTabOrSpace(code: number): boolean {
  return isHTTPTabOrSpace(code);
}

export function httpWhitespace(code: number): boolean {
  return isHTTPWhitespace(code);
}

export function trimmedHTTP(value: string): string {
  return trimHTTPWhitespace(value);
}

export function trimmedTrailingHTTP(value: string): string {
  return trimTrailingHTTPWhitespace(value);
}

export function trimmedASCII(value: string): string {
  return trimASCIIWhitespace(value);
}

/** The byte length of a string in UTF-8, which every buffer here is sized by. */
export function utf8Size(value: string): number {
  return utf8Length(value);
}

/**
 * Encode and decode, which is scalar-value normalisation with the codec doing the work.
 *
 * The most demanding string case on this axis. A lone surrogate has to become U+FFFD
 * and a valid pair has to survive, so a backend whose strings are not UTF-16 code
 * units -- or whose replacement differs -- disagrees with the oracle here rather than
 * anywhere subtler.
 */
export function utf8RoundTrip(value: string): string {
  const bytes = new Uint8Array(utf8Length(value));
  utf8Write(bytes, value, 0, bytes.length);
  return utf8Decode(bytes, 0, bytes.length);
}

/** Probe: the JSON serializer's leaves. */
export function jsonQuote(value: string): string {
  return quoteJSONString(value);
}

export function jsonGap(space: number): string {
  return resolveGap(space);
}

export function jsonArrayIndex(key: string): number {
  return arrayIndexOf(key);
}

export function jsonNumber(value: number): string {
  return numberText(value);
}

/** The indent unit for a string `space`, which takes the other arm of 25.5.4 steps 5-8. */
export function jsonGapText(space: string): string {
  return resolveGap(space);
}

/** One object member: a quoted key, a colon, and the gap's single space. */
export function jsonMember(key: string, valueText: string, gap: string): string {
  return member(key, valueText, gap);
}

/**
 * A whole document serialized from the leaves, compiled.
 *
 * The graph traversal does not compile yet -- it carries a replacer, which is a call through a
 * function-typed slot -- but serialization itself is the escaper, the number form and the
 * separators, and all three do. This assembles an array of numbers the way 25.5.4.6 does, so
 * the axis exercises JSON *output* rather than only the pieces it is made of.
 */
export function jsonNumberArray(values: readonly number[]): string {
  let out = "[";
  for (let at = 0; at < values.length; at++) {
    if (at !== 0) out += ",";
    out += numberText(values[at] as number);
  }
  return out + "]";
}

/** The same for an object of string values, which is where the escaper and the key order meet. */
export function jsonStringObject(keys: readonly string[], values: readonly string[]): string {
  let out = "{";
  for (let at = 0; at < keys.length; at++) {
    if (at !== 0) out += ",";
    out += member(keys[at] as string, quoteJSONString(values[at] as string), "");
  }
  return out + "}";
}

/**
 * The erased graph's scalar constructors, round-tripped.
 *
 * `JsonValue.objectValue` is the one static that does not compile -- it orders array-index keys
 * with a comparator sort -- so this covers the seven that do, which is the graph a compiled
 * target actually builds.
 */
export function jsonScalarKind(which: number): string {
  if (which === 0) return JsonValue.nullValue(0, 0).kind;
  if (which === 1) return JsonValue.booleanValue(true, 0, 0).kind;
  if (which === 2) return JsonValue.numberValue(1.5, 0, 0).kind;
  if (which === 3) return JsonValue.stringValue("x", 0, 0).kind;
  if (which === 4) return JsonValue.rawValue("1e999").kind;
  return JsonValue.holeValue().kind;
}

export function jsonScalarNumber(value: number): number {
  return JsonValue.numberValue(value, 0, 0).number;
}

export function jsonScalarText(value: string): string {
  return JsonValue.stringValue(value, 0, 0).text;
}

/** An array node's length, which is the graph's only container that compiles. */
export function jsonArrayLength(count: number): number {
  const items: JsonValue[] = [];
  for (let at = 0; at < count; at++) items.push(JsonValue.numberValue(at, 0, 0));
  return JsonValue.arrayValue(items, 0, 0).items.length;
}
