/*---
description: A narrowed private field changed through bracket access reaches a numeric parameter as a string.
features: [ts-unsound-private, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-functions, ts-private-keyword, ts-narrowing, ts-unions, ts-unsound-refinement]
---*/
// TypeScript permits literal-key private access and keeps a field refinement
// across the callback's write. Node passes the actual string to describe.
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
class Cell {
  private value: number | string = 2;
  inspect(change: () => void): string {
    if (typeof this.value !== "number") throw new Test262Error("initial value");
    change();
    return describe(this.value);
  }
}
const cell = new Cell();
assert.sameValue(cell.inspect(() => { cell["value"] = "7"; }), "string:71");
