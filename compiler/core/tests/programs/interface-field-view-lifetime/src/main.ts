interface Named { readonly name: string; }

class Reordered {
  extra = 1;
  name: string;
  constructor(n: number) { this.name = "kept" + n; }
}

class Holder {
  constructor(public value: Reordered) {}
}

// Replacing the owning slot drops its reference. The non-prefix view must
// preserve the original object, then carry it out of the allocating frame.
export function returnView(n: number): Named {
  const original = new Reordered(n);
  const holder = new Holder(original);
  const view: Named = original;
  holder.value = new Reordered(n + 1);
  return view;
}

export function survivesOwnerRelease(n: number): string {
  const view = returnView(n);
  const another = returnView(n + 2);
  return view.name + "/" + another.name;
}
