// Writing a field whose name is also declared `readonly` somewhere else.
//
// The refusal this removes was about *permission*, not about storage, so the
// case is here to say that granting the permission granted nothing else.

class Frozen {
  readonly count: number;
  constructor(count: number) {
    this.count = count;
  }
}

class Counter {
  count = 0;
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const c = new Counter();
    c.count = i;
    c.count += 1;
    total = total + c.count;
  }
  const f = new Frozen(total);
  return f.count;
}
