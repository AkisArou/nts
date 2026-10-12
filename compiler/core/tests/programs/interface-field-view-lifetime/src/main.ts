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

class StoredNamed {
  constructor(readonly name: string) {}
}
class GetterNamed {
  constructor(private n: number) {}
  get name(): string { return "c" + this.n; }
}
function readName(value: Named): string { return value.name; }

// The stored field and computed getter dispatch through the same face. RC
// must keep the frame-local stored string until the later map loop reads it.
export function namesFromFrameArray(n: number): string {
  const all: Named[] = [new StoredNamed("p" + n), new GetterNamed(n)];
  return all.map((value) => readName(value)).join(",");
}
