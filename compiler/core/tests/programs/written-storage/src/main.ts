// Written fields and a global, each at its kind's width; a field two classes
// share through an interface, written in one and not the other; and a float
// kind that only ever holds whole numbers, which the facts would make an
// integer if the written width did not hold.

import type { Float32, Int16, Uint32, Uint8 } from "@nts/scalars";

class Pixel {
  r: Uint8 = 0;
  big: Uint32 = 0;
  low: Int16 = 0;
  whole: Float32 = 0;
}

let written: Uint8 = 0;

interface Channel {
  level: Uint8;
}

class Written implements Channel {
  level: Uint8 = 0;
}

class Plain implements Channel {
  level: number = 0;
}

export function use(n: number): number {
  const p = new Pixel();
  p.r = (n & 0xff) as Uint8;
  p.big = (n >>> 0) as Uint32;
  p.low = (n & 0x7fff) as Int16;
  p.whole = 3;
  written = (n & 0x7f) as Uint8;
  const c: Channel = (n & 1) === 0 ? new Written() : new Plain();
  c.level = 1;
  return p.r + p.big + p.low + p.whole + written + c.level;
}
