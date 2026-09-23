import { text_broken_promise, text_byte, text_dup, text_dup_unfreed, text_greek, text_is_null, text_length, text_maybe, text_overlong, text_total } from "c:text";
import type { c_int } from "c:types";

// Built at run time rather than written as one literal, so the string C sees
// is one this program made and not one the compiler could have laid out.
function sample(first: number): string {
  return String.fromCharCode(first) + String.fromCodePoint(0x1f600);
}

// "α😀" and "β😀": the same length, different second byte. The consumer
// checks the first and requires the second to answer differently.
export function alphaLength(): number {
  return text_length(sample(0x3b1));
}

export function alphaByte(at: number): number {
  return text_byte(sample(0x3b1), at as c_int);
}

export function betaByte(at: number): number {
  return text_byte(sample(0x3b2), at as c_int);
}

// A lone high surrogate, which UTF-8 cannot spell. TextEncoder writes U+FFFD.
export function loneByte(at: number): number {
  return text_byte(String.fromCharCode(0xd800), at as c_int);
}

// Latin-1 stored one byte per unit, which is not UTF-8: é is E9 here and
// C3 A9 in C.
export function latinLength(): number {
  return text_length("h" + String.fromCharCode(0xe9));
}

// An interior U+0000, which a C string cannot hold. This ends the process.
export function withNul(): number {
  return text_length("a" + String.fromCharCode(0) + "b");
}

// `count` calls, each converting and releasing a fresh string. The consumer
// runs this at two counts under a leak checker: a release that is missing
// shows as loss proportional to the count.
export function many(count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total = text_total("n" + String(i % 10));
  }
  return total;
}

// `string | null`: C receives NULL for null, and a string for a string --
// including an empty one, which is not NULL.
export function nullIsNull(which: number): number {
  const s = which === 0 ? null : which === 1 ? "" : "text";
  return text_is_null(s);
}

// Returned by C: "α😀" is three code units, the second a high surrogate.
export function greekLength(): number {
  return text_greek().length;
}

export function greekUnit(at: number): number {
  return text_greek().charCodeAt(at);
}

// A copy C allocated and the program released: the text survives the free.
export function dupLength(): number {
  return text_dup("hello, " + String(42)).length;
}

// `string | null`: NULL is null, and a string is a string.
export function maybe(which: number): number {
  const s = text_maybe(which as c_int);
  return s === null ? -1 : s.length;
}

// An overlong '/', decoded as node decodes it: two replacements, no '/'.
export function overlongUnit(at: number): number {
  return text_overlong().charCodeAt(at);
}

// `count` copies read and released, or with `unfreed`, read and leaked.
export function manyCopies(count: number, unfreed: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    const s = unfreed === 0 ? text_dup("copy") : text_dup_unfreed("copy");
    total += s.length;
  }
  return total;
}

// A NULL where the declaration promised a string. Reaching the `length`
// would read through a null the program's types say cannot exist.
export function brokenPromise(): number {
  return text_broken_promise().length;
}
