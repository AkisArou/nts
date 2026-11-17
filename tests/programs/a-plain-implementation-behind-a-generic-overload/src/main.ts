// An implementation declares the signature its body binds, whatever its overloads
// declare. `Buf.from`'s first overload is generic and its implementation is not, and
// the checker's type for the implementation is the overload set -- so read through
// that type, the implementation had the first overload's type parameters, was taken
// for a generic method with no copy per type, and a closure calling it inside a `try`
// held the program's raising gate off. `runtime/node/fs` lost the gate to
// `Buffer.from` exactly so.
//
// The control is the same program without the generic overload.

class Buf {
  constructor(readonly size: number) {}
  static from<T extends object>(value: T, size?: number): Buf;
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

/** The generic overload, called directly. */
export function fromObject(n: number): number {
  return Buf.from({ n }, n & 7).size;
}
