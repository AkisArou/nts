// run: check
// backend: wasm
//
// The Wasm twin of a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass:
// Wasm declines the widening by name (NTS5001, no cast relates the two array
// storages), so nothing is emitted. Of the four backends this is the only
// by-name stop for the function-boundary shape.

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
