// An array of a written scalar kind, read back everywhere a value goes
// without its static type: through `unknown`, `String(xs)`, `.join`, `.length`,
// an element of an `unknown[]`, and `push`/`pop`. Each answer must agree with
// node, which holds every element as a double.
//
// The values sit where storage of the right width but the wrong signedness
// answers something else: 255 in a `Uint8`, -1 in an `Int8`, 65535 in a
// `Uint16`, -32768 in an `Int16`, 2^32 - 1 in a `Uint32`, -2^31 in an `Int32`,
// and a `Float32` that `Math.fround` made. A byte holding 255 read back as
// signed answers -1; a `Uint32` read as an `int` answers -1. A typed read is
// converted by the compiler, which knows the kind; these reads are the ones
// that only the runtime decides, so they guard a per-width array that forgets
// its kind.
//
// Each export reads its input so nothing folds away.

import type { Float32, Int16, Int32, Int8, Uint16, Uint32, Uint8 } from "@nts/scalars";

function bytes(n: number): Uint8[] {
  const xs: Uint8[] = [];
  xs.push(255);
  xs.push((n & 0x7f) as Uint8);
  xs.push(128);
  return xs;
}

/** Every kind at its edge, printed through `String`. */
export function printed(n: number): string {
  const pick = n & 1;
  const u8: Uint8[] = bytes(n);
  const i8: Int8[] = [pick === 0 ? -1 : -128, 127];
  const u16: Uint16[] = [65535, pick === 0 ? 32768 : 1];
  const i16: Int16[] = [-32768, 32767];
  const u32: Uint32[] = [4294967295, pick === 0 ? 2147483648 : 7];
  const i32: Int32[] = [-2147483648, 2147483647];
  const f32: Float32[] = [Math.fround(n / 3)];
  return [String(u8), String(i8), String(u16), String(i16), String(u32), String(i32), String(f32)].join(" ");
}

/** The same arrays joined, and their texts in a template. */
export function joined(n: number): string {
  const u8: Uint8[] = bytes(n);
  const u32: Uint32[] = [4294967295, (n >>> 0) as Uint32];
  const i8: Int8[] = [-1, (n & 0x3f) as Int8];
  return `${u8.join("|")} ${u32.join("|")} ${i8.join("|")} ${u8}`;
}

/** One array held as `unknown`: its length and an element the runtime reads.
 *  Narrowed by `Array.isArray`, not cast: `h as unknown[]` on a `number[]`
 *  claims an element it does not have, which the JVM refuses at the cast and C
 *  survives on reads only
 *  (`outcomes/a-write-through-unknown-cast-to-an-array-of-unknown`). Each is
 *  passed alone, not as an element of an `unknown[]`, which stops the build
 *  today (`blockers/an-array-taken-out-of-an-unknown-array-is-read-at-its-old-element`). */
function described(h: unknown): string {
  return Array.isArray(h) ? `${h.length}:${String(h[0])}:${typeof h[1]}:${String(h)}` : "not an array";
}

export function throughUnknown(n: number): string {
  const u8: Uint8[] = bytes(n);
  const u32: Uint32[] = [4294967295, 2147483648];
  const i16: Int16[] = [-32768, (n & 0xff) as Int16];
  const i8: Int8[] = [-1, (n & 0x3f) as Int8];
  return `${described(u8)} ${described(u32)} ${described(i16)} ${described(i8)}`;
}

/** `push` answers the new length; `pop` answers the element at its kind. */
export function pushedAndPopped(n: number): number {
  const u8: Uint8[] = bytes(n);
  const length = u8.push(200);
  const top = u8.pop();
  const u32: Uint32[] = [];
  u32.push(4294967295);
  const big = u32.pop();
  return length * 1e12 + (top ?? 0) * 1e10 + (big ?? 0);
}
