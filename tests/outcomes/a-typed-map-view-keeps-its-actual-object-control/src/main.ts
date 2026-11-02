// run: check

// A typed Map view is not evidence of the stored object's field layout.
// The control changes only the Map value view from Claimed to actual Item.
// The property flows straight to unknown, so Node returns "string".

class Item {
  pad: number;
  value: string;
  constructor(n: number) { this.pad = n + 1000; this.value = "actual"; }
}
interface Claimed { value: number; }
export function probe(n: number): string {
  const rows = new Map<string, Item>();
  rows.set("key", new Item(n));
  const view = rows as unknown as Map<string, Item>;
  const item = view.get("key");
  if (item === undefined) return "missing";
  const result: unknown = item.value;
  return typeof result;
}
