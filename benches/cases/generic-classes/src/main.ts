// One generic class at two instantiations, in one loop.
//
// **The claim this row makes is that being a copy costs nothing**, and the
// column that says so is C++. `Box<T>` is lowered once per instantiation, so
// `Box<number>` holds an unboxed `f64` and `Box<boolean>` a byte -- two
// classes, two layouts, and `get` is two functions each of which knows what it
// returns. A C++ template is monomorphised the same way, and at 4096
// iterations in ~188 ns -- a fifth of a cycle each -- **both lanes have removed
// the objects entirely**. Being a copy of a generic did not stop that.
//
// The node column is measured and is *not* evidence about generics, which is
// worth writing down because it looks like it is. A control with two
// hand-written classes and no generic at all, same loop:
//
//     generic-classes    C++ 188.0 ns   nts C 188.6 ns   node 1.39 us
//     hand-written       C++ 188.5 ns   nts C 188.5 ns   node 1.41 us
//
// Identical in every lane. So the 0.14x against node belongs to this shape
// rather than to this feature: V8 escape-analyses the boxes away whether it
// sees one class with two shapes or two classes, and the polymorphic-access
// story that would have made this a generics result does not materialise.
// Java is the third answer -- erased to `Object`, both primitives boxed -- and
// it comes out level with our own JVM lane rather than behind it, for the same
// reason.
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
    const size = (i ^ step) & 0xffff;
    const counted = new Box<number>(size);
    const flagged = new Box<boolean>((i & 1) === 0);
    total = (total ^ counted.get() ^ (flagged.get() ? 1 : 0)) | 0;
  }
  return total;
}
