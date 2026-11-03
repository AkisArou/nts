/*---
description: External literal-key reads through a typed class array preserve ordinary TypeScript-private fields and their exact runtime kinds. The control uses a public field with identical initialization and literal-key reads.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-class, ts-class-fields, ts-arrays, ts-tuples, ts-unknown, ts-typeof-operator]
---*/
// Cell array elements expose the private value by its literal key; node reads each exact payload and enumerates the ordinary value field. The control uses a public field with identical initialization and literal-key reads.
class Cell {
  public value: unknown;
  constructor(value: unknown) { this.value = value; }
}
const token = { id: 1 };
const entries: [unknown, string][] = [[undefined, "undefined"], [null, "object"], [false, "boolean"],
  [-0, "number"], [NaN, "number"], [0n, "bigint"], ["", "string"], [token, "object"]];
const cells: Cell[] = entries.map(entry => new Cell(entry[0]));
for (let index = 0; index < cells.length; index++) {
  const value: unknown = cells[index]["value"];
  assert.sameValue(value, entries[index][0]); assert.sameValue(typeof value, entries[index][1]);
  assert.compareArray(Object.keys(cells[index]), ["value"]);
}
assert.sameValue(cells.length, entries.length); assert.sameValue(typeof cells.length, "number");
