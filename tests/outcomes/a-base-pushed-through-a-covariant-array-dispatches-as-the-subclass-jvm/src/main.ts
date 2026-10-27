// run: check
// backend: jvm
//
// The JVM twin of a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass.
// The register once said the JVM declines this program by name (NTS4001); it
// does not. The store crosses a function boundary, so the container guard
// never sees the `Sub` storage: the program compiles and aborts with a
// `ClassCastException` (`Base` cannot be cast to `Sub`) at the element read.
// The guard's by-name decline is the local-alias shape, pinned in
// a-base-pushed-through-a-local-covariant-alias-on-the-jvm.

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

function addBase(xs: Base[]): void {
  xs.push(new Base());
}

export function through(seed: number): number {
  const subs: Sub[] = [new Sub()];
  addBase(subs);
  let t = 0;
  for (const s of subs) t = t * 10 + s.v();
  return t * 10 + ((seed | 0) & 1);
}
