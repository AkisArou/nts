/*---
description: A static block runs with `this` the class and may read and write its static private state.
features: [ts-class, ts-class-static-block, ts-private-fields, ts-static]
---*/
class Table {
  static #rows: number[] = [];
  static readonly first: number;
  static {
    this.#rows.push(5, 6);
    (this as { first: number }).first = Table.#rows[0];
  }
  static count(): number {
    return Table.#rows.length;
  }
}
assert.sameValue(Table.count(), 2);
assert.sameValue(Table.first, 5);
