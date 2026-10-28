/*---
description: A retained numeric refinement survives a callback that writes a string.
features: [ts-unsound-refinement, ts-class, ts-class-fields, ts-narrowing, ts-unions, ts-functions, ts-typeof-operator, ts-conversions]
---*/

// TypeScript keeps this numeric refinement across a call that mutates the alias.
// The declared number passed afterward is a string; node concatenates it.
class Cell { value: number | string = 1; }
const cell = new Cell();
function mutate(): void { cell.value = "7"; }
function observe(value: number): void {
  assert.sameValue(typeof value, "string");
  assert.sameValue(String(value + 1), "71");
}
if (typeof cell.value !== "number") throw new Test262Error("expected initial number");
mutate();
observe(cell.value);
