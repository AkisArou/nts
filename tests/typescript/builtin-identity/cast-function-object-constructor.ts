/*---
description: An object-returning function cast to ObjectConstructor keeps its new object.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-objects, ts-narrowing, ts-instanceof]
---*/
// Route: a function is asserted to be Object; new keeps the object it returns.
let calls = 0;
function ownObject(input: { item: number }): { item: number } {
  calls++; return { item: input.item + 100 };
}
function check(n: number): void {
  calls = 0;
  const input = { item: n };
  const Target = ownObject as unknown as typeof Object;
  const value: object = new Target(input);
  assert.sameValue(calls, 1);
  assert.sameValue(value === input, false);
  assert.sameValue(value instanceof ownObject, false);
  assert.sameValue(value instanceof Object, true);
  if (!("item" in value)) throw new Test262Error("missing item");
  assert.sameValue(value.item, n + 100);
}
for (const n of [-3, 0, 1, 7]) check(n);
