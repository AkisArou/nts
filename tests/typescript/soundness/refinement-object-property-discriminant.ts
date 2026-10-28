/*---
description: Replacing a discriminated variant invalidates a retained numeric claim.
features: [ts-unsound-refinement, ts-objects, ts-narrowing, ts-discriminated-unions, ts-unions, ts-functions, ts-typeof-operator, ts-conversions, ts-type-aliases]
---*/

// TypeScript retains discriminant narrowing across a callback that replaces the variant.
// Its required value is now a string; node reads and concatenates that string.
type Variant = { kind: "number"; value: number } | { kind: "string"; value: string };
const cell: { current: Variant } = { current: { kind: "number", value: 1 } };
function mutate(): void { cell.current = { kind: "string", value: "7" }; }
if (cell.current.kind !== "number") throw new Test262Error("expected numeric variant");
mutate();
const value: number = cell.current.value;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
