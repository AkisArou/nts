// A frame object a constructor stores gives its fields back when the frame
// ends, after every read through the holder. `new Holder(new Item(n))` with
// both in the frame handed the item to the constructor, which keeps its
// parameter -- so the caller gave up its reference, and with it the walk that
// releases the item's fields when it dies; the holder's release of a frame
// object is a no-op. The item's string leaked once per call under RC.
// Releasing the walk at the item's last direct use instead would free the
// string before `holder.value.name` reads it: liveness has to see the store
// the constructor makes, as it already saw one written here.
class Item {
  name: string;
  constructor(n: number) { this.name = "item" + n; }
}
class Holder {
  value: Item;
  constructor(value: Item) { this.value = value; }
}
class Shelf {
  value: Item | null = null;
}

export function readThroughTheHolder(n: number): string {
  const holder = new Holder(new Item(n));
  return holder.value.name + "!";
}
// The control differs in one thing: the store is written here, not made by
// the constructor, and liveness always followed it.
export function storedHere(n: number): string {
  const shelf = new Shelf();
  shelf.value = new Item(n);
  return shelf.value.name + "!";
}
