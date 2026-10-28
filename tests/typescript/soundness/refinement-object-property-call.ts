/*---
description: A retained numeric refinement survives a callback that writes a string.
features: [ts-unsound-refinement, ts-objects, ts-narrowing, ts-unions, ts-functions, ts-typeof-operator, ts-conversions]
---*/

// TypeScript keeps this numeric refinement across a call that mutates the alias.
// The declared number passed afterward is a string; node concatenates it.
const cell: { value: number | string } = { value: 1 };
function mutate(): void { cell.value = "7"; }
function observe(value: number): void {
  assert.sameValue(typeof value, "string");
  assert.sameValue(String(value + 1), "71");
}
if (typeof cell.value !== "number") throw new Test262Error("expected initial number");
mutate();
observe(cell.value);
