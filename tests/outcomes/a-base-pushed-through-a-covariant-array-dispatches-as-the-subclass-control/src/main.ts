// The not-widened control for
// a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass: the
// array is pushed through a `Sub[]` parameter and read as `Sub[]`, so no
// claim is false and every backend answers as node does (`[Sub, Sub]`
// reads 22). It differs from the wrong-answer case in the widening alone
// (what is pushed follows from it). Measured agreeing on C, LLVM, JVM and
// Wasm at recording time; the record is the C build face.

class Base {
  v(): number {
    return 1;
  }
}

class Sub extends Base {
  v(): number {
    return 2;
  }
}

function addSub(xs: Sub[]): void {
  xs.push(new Sub());
}

function read(subs: Sub[]): number {
  let t = 0;
  for (const s of subs) t = t * 10 + s.v();
  return t;
}

function throughSub(): number {
  const subs: Sub[] = [new Sub()];
  addSub(subs);
  return read(subs);
}

observe("a Sub pushed, not widened", String(throughSub()));
done();
