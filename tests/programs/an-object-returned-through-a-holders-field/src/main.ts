// An object stored in a holder's field and read back out leaves with the read.
// `returnThroughHolder` puts a fresh `Item` in a frame-local `Holder`, reads
// it back and returns it: escape analysis asked only whether the holder
// escaped, which it does not, so the `Item` was placed in the frame and the
// caller got a pointer into dead stack. RC was killed on 17 of 29 cases; C,
// LLVM and the JVM read the dead stack by luck. The same read one call away --
// a helper returning `holder.value` -- was the same defect. Found by the
// MainCodex review of a field view, and pre-existing.
class Item {
  extra = 1;
  name: string;
  constructor(n: number) { this.name = "kept" + n; }
}
class Holder {
  constructor(public value: Item) {}
}

export function returnThroughHolder(n: number): Item {
  const holder = new Holder(new Item(n));
  const read = holder.value;
  holder.value = new Item(n + 1);
  return read;
}
function valueOf(holder: Holder): Item { return holder.value; }
export function returnThroughHelper(n: number): Item {
  const holder = new Holder(new Item(n));
  return valueOf(holder);
}
export function bothSurvive(n: number): string {
  const a = returnThroughHolder(n);
  const b = returnThroughHolder(n + 2);
  const c = returnThroughHelper(n + 4);
  const d = returnThroughHelper(n + 6);
  return a.name + "/" + b.name + "/" + c.name + "/" + d.name;
}
// The control differs in one thing: the item is returned by its own name
// rather than through the read, which escape analysis always followed.
function returnDirectly(n: number): Item {
  const item = new Item(n);
  const holder = new Holder(item);
  return holder.value === item ? item : new Item(0);
}
export function directSurvives(n: number): string {
  const a = returnDirectly(n);
  const b = returnDirectly(n + 2);
  return a.name + "/" + b.name;
}
