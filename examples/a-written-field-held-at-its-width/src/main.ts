// A field or global written as a scalar kind is held at that kind's width
// (`docs/scalar-numbers.md`, step 2f): `r: Uint8` is a byte in the object,
// `count: Int32` four bytes, `big: Uint32` an unsigned four, `ratio: Float32`
// a float. Every store into one is proven to fit, so the store converts
// exactly, and every read widens back to the `number` the program computes
// with -- so each case agrees with node, which holds them all as doubles.
//
// The values sit at each kind's edges -- 255, 2^31 - 1, 2^32 - 1, -32768 --
// where a slot one width too narrow, or of the wrong signedness, answers
// something else. Each export reads its input so nothing folds away.

import type { Float32, Int16, Int32, Uint32, Uint8 } from "@nts/scalars";

class Pixel {
  r: Uint8 = 0;
  g: Uint8 = 0;
  count: Int32 = 0;
  big: Uint32 = 0;
  low: Int16 = 0;
  ratio: Float32 = 0;
}

/** Each kind at its top, read back through the object. */
export function edges(n: number): number {
  const p = new Pixel();
  const pick = n & 1;
  p.r = pick === 0 ? 255 : 254;
  p.count = pick === 0 ? 2147483647 : -2147483648;
  p.big = pick === 0 ? 4294967295 : 2147483648;
  p.low = pick === 0 ? -32768 : 32767;
  return p.r + p.count + p.big + p.low;
}

/** A float kind keeps a value `Math.fround` made, exactly. */
export function aFloatField(n: number): number {
  const p = new Pixel();
  p.ratio = Math.fround(n / 3);
  return p.ratio * 3;
}

/** Arithmetic on a read is a `number`'s, not the slot's: 255 + 1 is 256. */
export function aReadIsANumber(n: number): number {
  const p = new Pixel();
  p.r = (n & 0xff) as Uint8;
  p.g = 255;
  return p.r + p.g + 1;
}

/** A read is anywhere in its kind, so `count + 7` may not fit an `Int32`
 *  and is refused as a store; `| 0` and `& 0xff` wrap as JavaScript does, and
 *  prove it. */
export function wrappingStores(n: number): number {
  const p = new Pixel();
  p.count = (n & 0xffff) as Int32;
  p.count = (p.count + 7) | 0;
  p.r = (n & 0xff) as Uint8;
  p.r = (p.r + 1) & 0xff;
  return p.count * 1000 + p.r;
}

let written: Uint32 = 0;

/** A written global, at the same width. */
export function aGlobal(n: number): number {
  written = (n & 1) === 0 ? 4294967295 : 1;
  return written + 1;
}

interface Channel {
  level: Uint8;
}

class Red implements Channel {
  level: Uint8 = 0;
  tag: number = 1;
}

class Green implements Channel {
  extra: number = 2;
  level: Uint8 = 0;
}

/** A store and a read through an interface parameter, whose classes put the
 *  field at different places. Each call knows its class, and the callee is
 *  copied for it. (Where the class is lost instead -- an erased join unerased
 *  to the interface -- the access is wrong whatever the width:
 *  `tooling/conformance/outcomes/a-field-through-an-interface-its-classes-order-differently`.) */
function bump(c: Channel, v: Uint8): number {
  c.level = v;
  return c.level + 1;
}

export function throughAnInterface(n: number): number {
  return bump(new Red(), (n & 0x7f) as Uint8) * 1000 + bump(new Green(), 200);
}
