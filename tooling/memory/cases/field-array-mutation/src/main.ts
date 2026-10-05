// A container held in a field and mutated once per call: the shape of a UI
// whose rows live in its state and change one event at a time.
//
// `add` and `remove` each read `rows.items` out of a parameter and hand it to
// a runtime array helper. The helper writes element storage and runs no
// program code, so it cannot overwrite the field and cannot give up `rows`,
// which the caller holds: the read needs no reference of its own. Taking one
// costs more than its two operations. Its release does not reach zero, so the
// array becomes a cycle candidate, and trial deletion at the next checkpoint
// walks every element -- per event, in a program whose state only grows.

class Item {
  label: string;
  constructor(label: string) {
    this.label = label;
  }
}

class Rows {
  items: Item[] = [];
}

function add(rows: Rows, item: Item): void {
  rows.items.push(item);
}

function remove(rows: Rows, index: number): void {
  rows.items.splice(index, 1);
}

export function work(n: number): number {
  const rows = new Rows();
  for (let i = 0; i < 16 + n; i = i + 1) {
    add(rows, new Item("row"));
  }
  for (let i = 0; i < 8; i = i + 1) {
    remove(rows, 0);
  }
  return rows.items.length;
}
