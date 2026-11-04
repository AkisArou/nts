/*---
description: "Stored function values keep the internal brand checker separate from prototype ancestry through a readonly function array."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-readonly, ts-function-types, ts-arrow-functions]
flags: [module]
---*/
// Stored function values keep the internal brand checker separate from prototype ancestry; route: a readonly function array.
// Node prints: brands-contrast-readonly-functions:ok
class BrandedChild extends Error { tag: string = "child"; }
const real: Error = new Error("base");
const child: BrandedChild = new BrandedChild("child");
const aggregate: AggregateError = new AggregateError(["member"], "many");
const dom: DOMException = new DOMException("dom", "AbortError");
const forged: object = Object.create(Error.prototype);
const plain: { name: string; message: string } = { name: "Error", message: "base" };
const text: string = "Error: base";
const checks: readonly ((value: unknown) => boolean)[] = [Error.isError, (value: unknown): boolean => value instanceof Error];
const values: readonly unknown[] = [real, child, aggregate, dom, forged, plain, text];
const expected: readonly (readonly boolean[])[] = [[true, true], [true, true], [true, true], [true, true], [false, true], [false, false], [false, false]];
for (let index = 0; index < values.length; index++) {
  const answers: boolean[] = [];
  for (const check of checks) answers.push(check(values[index]));
  assert.compareArray(answers, expected[index]);
}
console.log("brands-contrast-readonly-functions:ok");
