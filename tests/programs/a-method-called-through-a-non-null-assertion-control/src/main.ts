// Control for `outcomes/a-method-called-through-a-non-null-assertion` (#882):
// the call is `s.get()`, without the `!`, so it is a member call on `s`.

class S {
  v = 3;
  get(): number {
    return this.v;
  }
}

export function probe(n: number): number {
  const s = new S();
  s.v = n;
  return s.get();
}
