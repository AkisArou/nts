// expect: `null` or `undefined` where what it stands in for is not a reference
//
// A getter whose declared return type is a union with `undefined`. All 59
// occurrences of this message in `fs` carry the same two names -- `null` or
// `undefined` -- and it is the sixth-largest lowering root by distinct things.
//
// Reduced from `buffer/src/main.ts:369` and `:375`:
//
//     get parent(): ArrayBufferLike | undefined {
//       if (!(this instanceof Buffer)) return undefined;
//       return this.buffer;
//     }
//
// # It is the getter, and four controls say so
//
//     function f(): number | undefined      compiles
//     get offset(): number                  compiles
//     offset(): number | undefined          compiles   <- a method, not a getter
//     get offset(): number | undefined      refuses
//
// The third row is the one that matters. **The same body, the same return
// type, the same class -- written as a method it compiles and written as a
// getter it does not.** So this is not about returning `undefined`, and not
// about unions, and not about `this`: a getter that never mentions `this`
// refuses too.
//
// # The message names a condition the behaviour does not have
//
// "where what it stands in for is not a reference" reads as a claim about the
// other union member, and it is not one:
//
//     get offset(): number | undefined      refuses   (number is not a reference)
//     get thing(): Thing | undefined        refuses   (Thing is a class)
//
// A reference refuses exactly as a primitive does. Whatever decides this, it is
// not what the message says decides it -- which is worth a line, because the
// obvious reading sends a reader to widen a representation that is already
// wide enough.
//
// Written with `#value` untouched by the getter that fails, so that the
// difference between the two accessors below is the accessor kind and nothing
// else.

class Holder {
  #value = 1;

  // Compiles. Same body, same type, same class.
  offsetMethod(): number | undefined {
    if (this.#value === 0) return undefined;
    return this.#value;
  }

  // Refuses.
  get offset(): number | undefined {
    if (this.#value === 0) return undefined;
    return this.#value;
  }
}

export function readBoth(): boolean {
  const h = new Holder();
  return h.offsetMethod() === h.offset;
}
