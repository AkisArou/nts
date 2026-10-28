/*---
description: A numeric return preserves a private field changed to a string through bracket access.
features: [ts-unsound-private, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-functions, ts-private-keyword, ts-narrowing, ts-unions, ts-unsound-refinement]
---*/
// TypeScript permits literal-key private access and retains the number
// refinement across the callback. Node returns the replacement string.
class Cell {
  private value: number | string = 2;
  read(change: () => void): number {
    if (typeof this.value !== "number") throw new Test262Error("initial value");
    change();
    return this.value;
  }
}
const cell = new Cell();
const value: number = cell.read(() => { cell["value"] = "7"; });
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
