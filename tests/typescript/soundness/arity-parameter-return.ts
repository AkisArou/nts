/*---
description: An optional numeric argument receives a string through a shorter signature (return).
features: [ts-unsound-arity, ts-functions, ts-function-types, ts-optional-parameters, ts-typeof-operator, ts-conversions, ts-narrowing, ts-null-undefined]
---*/

// TypeScript forgets the optional numeric parameter when assigning a shorter signature.
// A wider caller then supplies a string; after excluding undefined, node still sees the string.
function narrow(first: number, value?: number): number {
  if (value === undefined) throw new Test262Error("missing argument");
  return value;
}
const shorter: (first: number) => number = narrow;
const wider: (first: number, value: string) => number = shorter;
const value: number = wider(1, "7");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
