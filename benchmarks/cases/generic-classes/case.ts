// One generic class at two instantiations, in one loop.
//
// **The claim this row makes is that being a copy costs nothing**, and the
// column that says so is C++. `Box<T>` is lowered once per instantiation, so
// `Box<number>` holds an unboxed `f64` and `Box<boolean>` a byte -- two
// classes, two layouts, and `get` is two functions each of which knows what it
// returns. A C++ template is monomorphised the same way, and both lanes run
// the 4096 rounds in the time of the multiply-add chain that carries `total`
// from one to the next -- C++ 3.74 us, nts C 3.75 us -- so **both have removed
// the objects entirely**. Being a copy of a generic did not stop that.
//
// No lane prices generics here, node included. A control with two hand-written
// classes and no generic at all, same loop (2026-10-15, P-cores):
//
//     generic-classes    C++ 3.74 us   nts C 3.75 us   nts Wasm 4.35 us   node 4.54 us
//     hand-written       C++ 3.73 us   nts C 3.74 us   nts Wasm 4.34 us   node 4.55 us
//
// Identical in every lane: V8 escape-analyses the boxes away whether it sees
// one class with two shapes or two classes, and the polymorphic-access story
// that would have made this a generics result does not materialise. Java is
// the third answer -- erased to `Object`, both primitives boxed -- and it
// comes out level with our own JVM lane rather than behind it, for the same
// reason.
//
// **Each round reads what the round before it wrote.** `total` feeds the next
// box and is folded by a multiply-add that loses nothing. The first version
// folded with XOR, and `(i ^ step)` over 0..4095 is a reordering of 0..4095,
// whose XOR is 0, while the 2048 flags cancel: it answered 0 for every seed,
// clang for WASI returned the constant (1.4 ns), x86 vectorised the fold
// (188 ns), and no column measured a box.
//
// **Nothing here allocates and nothing is counted**: two boxes per iteration,
// neither escaping, both scalar. A `Box<string>` in the loop measured 12288
// reference-counting operations with none elided -- and a non-generic class
// with a string field measured exactly the same, so that cost is not this
// feature's and does not belong in this row.

class Box<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
  get(): T {
    return this.v;
  }
}

export function work(seed: number): number {
  const step = seed | 0;
  let total = 0;
  for (let i = 0; i < 4096; i++) {
    const size = (i ^ step ^ total) & 0xffff;
    const counted = new Box<number>(size);
    const flagged = new Box<boolean>((i & 1) === 0);
    total = (total * 33 + counted.get() + (flagged.get() ? 1 : 0)) & 0xffffff;
  }
  return total;
}

/**
 * The input the harness calls `work` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 5;
