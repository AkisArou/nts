// A computed key is `ToString` of the numeric *value*, not the spelling written.
// Every member of `Holder` is named by its value, and the reads use those names.
class Holder {
  [0x10]: number = 1;
  [0b10001]: number = 2;
  [0o22]: number = 3;
  [1.9e1]: number = 4;
  /** **Control.** Decimal, where the spelling and the name coincide. */
  [20]: number = 5;
}

/** `[0x21]` is `"33"`; `[34]` is a second, distinct name. */
const literal = {
  [0x21]: 6,
  [34]: 7,
};

class Accessors {
  private stored = 0;
  get [0x30](): number {
    return this.stored + 1;
  }
  set [0x30](value: number) {
    this.stored = value;
  }
  [0x31](by: number): number {
    return this.stored + by;
  }
}

// **Not here, and it is not this fix's to close.** A key spelled
// `[0.9999999999999999]` is named `"0.9999999999999999"` -- a distinct double whose
// shortest round-trip string is itself -- and tsgo answers `1` for that literal. The
// *declaration* reads the exact value (the decoder carries the literal's text for
// precisely this reason), and a *read* of it does not: `canonical[0.9999999999999999]`
// looks for `"1"` and refuses with ``\`1\`, which `an anonymous type` does not
// declare``. Identical on a binary built before this change, so it is a second gap
// on the other side of the same asymmetry, and it wants its own fixture.

export function fields(n: number): number {
  const h = new Holder();
  h[16] = n;
  return h[16] + h[17] + h[18] + h[19] + h[20];
}

export function throughALiteral(n: number): number {
  return literal[33] + literal[34] + n;
}

export function throughAnAccessor(n: number): number {
  const a = new Accessors();
  a[48] = n;
  return a[48] + a[49](2);
}
