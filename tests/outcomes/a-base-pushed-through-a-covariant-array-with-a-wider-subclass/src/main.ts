// Where `Sub` is wider than `Base`, the covariant widening is refused in
// lowering (NTS1001: the two arrays hold different widths) before any
// backend sees the program -- so the read-past-the-object question the
// register left open does not arise in this shape. Measured identical on
// C, LLVM, JVM and Wasm at recording time (the refusal is lowering's, this
// build record is its C face). The equal-layout shape that does slip
// through is a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass.
//
// **Expected, confirmed under node:** `through=NaN` -- node reads `b` and
// `c` on the pushed `Base` as `undefined`, so its sum is NaN. Nothing here
// gets to run that read: the refusal at the widening is the record.

class Base {
  a = 7;
  v(): number {
    return 1;
  }
}

class Sub extends Base {
  b = 40;
  c = 2;
  v(): number {
    return 2;
  }
}

function addBase(xs: Base[]): void {
  xs.push(new Base());
}

function through(): number {
  const subs: Sub[] = [new Sub()];
  addBase(subs);
  let t = 0;
  for (const s of subs) t = t + s.v() * 100 + s.b + s.c;
  return t;
}

observe("through", String(through()));
done();
