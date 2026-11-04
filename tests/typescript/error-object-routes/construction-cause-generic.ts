/*---
description: "Generic object and array causes remain the identical references in an own cause property."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-generics, ts-generic-constraints, ts-object-type, ts-objects, ts-tuples, ts-unknown, ts-numbers]
flags: [module]
---*/
// Generic object and array causes remain the identical references in an own cause property. Route: a constrained generic at record, number-array and string-array type arguments.
// Node prints: construction-cause-generic:ok
function wrap<T extends object>(cause: T): Error { return new Error("generic", { cause }); }
const first = { id: 1 }, second = { id: 2 }, numbers: number[] = [3, 4], labels: string[] = ["a", "b"];
const rows: [Error, unknown][] = [
  [wrap<{ id: number }>(first), first], [wrap<{ id: number }>(second), second],
  [wrap<number[]>(numbers), numbers], [wrap<string[]>(labels), labels],
];
for (const [value, cause] of rows) {
  assert.sameValue(value.cause, cause);
  assert.sameValue(Object.hasOwn(value, "cause"), true);
}
console.log("construction-cause-generic:ok");
