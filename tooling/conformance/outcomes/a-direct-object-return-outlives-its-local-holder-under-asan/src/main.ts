// sanitizer: address
class Item {
  extra = 1;
  name: string;
  constructor(n: number) { this.name = "kept" + n; }
}
class Holder { constructor(public value: Item) {} }
export function make(n: number): Item {
  const original = new Item(n);
  const holder = new Holder(original);
  const view = holder.value;
  holder.value = new Item(n + 1);
  return original;
}

export function observed(n: number): string {
  const first = make(n);
  const second = make(n + 2);
  return first.name + "/" + second.name;
}

observe("returned", observed(11));
done();
