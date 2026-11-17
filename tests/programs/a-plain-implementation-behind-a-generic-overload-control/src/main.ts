// The control for `a-plain-implementation-behind-a-generic-overload`: the same
// program with no generic overload, so the implementation's type is its own.

class Buf {
  constructor(readonly size: number) {}
  static from(value: object, size?: number): Buf;
  static from(value: string): Buf;
  static from(value: unknown, size?: unknown): Buf {
    if (typeof value === "string") {
      if (value.length > 5) {
        throw new RangeError("too long");
      }
      return new Buf(value.length);
    }
    return new Buf(typeof size === "number" ? size : 0);
  }
}

const words = ["", "a", "ab", "abc", "abcd", "abcde", "abcdef", "abcdefg"];

function attempt(make: () => Buf): number {
  try {
    return make().size;
  } catch {
    return -1;
  }
}

/** A closure calling the overloaded static, dispatched inside a `try`. */
export function sized(n: number): number {
  const word = words[n & 7];
  return attempt(() => Buf.from(word));
}

/** The object overload, called directly. */
export function fromObject(n: number): number {
  return Buf.from({ n }, n & 7).size;
}
