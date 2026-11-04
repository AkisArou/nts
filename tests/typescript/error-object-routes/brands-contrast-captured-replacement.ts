/*---
description: "A retained closure observes each later Error, impostor and primitive replacement through a captured mutable binding."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-closures, ts-function-types, ts-arrow-functions, ts-readonly]
flags: [module]
---*/
// A retained closure observes each later Error, impostor and primitive replacement; route: a captured mutable binding.
// Node prints: brands-contrast-captured-replacement:ok
class BrandedChild extends Error { tag: string = "child"; }
const real: Error = new Error("base");
const child: BrandedChild = new BrandedChild("child");
const aggregate: AggregateError = new AggregateError(["member"], "many");
const dom: DOMException = new DOMException("dom", "AbortError");
const forged: object = Object.create(Error.prototype);
const plain: { name: string; message: string } = { name: "Error", message: "base" };
const text: string = "Error: base";
let current: unknown;
const inspect: () => boolean[] = () => { const value: unknown = current; return [Error.isError(value), value instanceof Error]; };
const values: readonly unknown[] = [real, child, aggregate, dom, forged, plain, text];
const expected: readonly (readonly boolean[])[] = [[true, true], [true, true], [true, true], [true, true], [false, true], [false, false], [false, false]];
for (let index = 0; index < values.length; index++) {
  current = values[index];
  assert.compareArray(inspect(), expected[index]);
}
console.log("brands-contrast-captured-replacement:ok");
