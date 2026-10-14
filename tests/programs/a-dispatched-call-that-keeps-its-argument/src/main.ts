// A function reached by a dispatch, whose body stores its argument on every
// path. Only a `Direct` call hands a reference over, so a body reached
// through a table -- an override called through its base, or a closure --
// must take a count of its own when it stores. Under reference counting,
// `Derived#keep` once took the `Box` over, the caller released it, and the
// allocation after reused it: `viaVirtual(k)` answered `k + 100`.
//
// Each answer is read after allocating again, so a freed and reused box is
// a wrong number rather than a lucky right one.
class Box {
  constructor(public n: number) {}
}
class Holder {
  box: Box | null = null;
}

class Base {
  keep(b: Box, h: Holder): void {
    h.box = null;
  }
}
class Derived extends Base {
  override keep(b: Box, h: Holder): void {
    h.box = b;
  }
}

// An override called through its base's type.
export function viaVirtual(k: number): number {
  const h = new Holder();
  const x: Base = k > -1e9 ? new Derived() : new Base();
  x.keep(new Box(k), h);
  const fresh = [new Box(k + 100), new Box(k + 200)];
  return (h.box?.n ?? -1) + fresh.length * 0;
}

// A closure called through its value.
export function viaClosure(k: number): number {
  const holder = new Holder();
  const put = (b: Box) => {
    holder.box = b;
  };
  put(new Box(k));
  const fresh = [new Box(k + 100), new Box(k + 200)];
  return (holder.box?.n ?? -1) + fresh.length * 0;
}
