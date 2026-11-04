/*---
description: "Two interface implementations keep the internal-brand answer separate from prototype ancestry through two checker implementations."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-interfaces, ts-readonly]
flags: [module]
---*/
// Two interface implementations keep the internal-brand answer separate from prototype ancestry; route: two checker implementations.
// Node prints: brands-contrast-interface-checkers:ok
class BrandedChild extends Error { tag: string = "child"; }
const real: Error = new Error("base");
const child: BrandedChild = new BrandedChild("child");
const aggregate: AggregateError = new AggregateError(["member"], "many");
const dom: DOMException = new DOMException("dom", "AbortError");
const forged: object = Object.create(Error.prototype);
const plain: { name: string; message: string } = { name: "Error", message: "base" };
const text: string = "Error: base";
interface Checker { read(value: unknown): boolean; }
class BrandChecker implements Checker { read(value: unknown): boolean { return Error.isError(value); } }
class ChainChecker implements Checker { read(value: unknown): boolean { return value instanceof Error; } }
const checkers: readonly Checker[] = [new BrandChecker(), new ChainChecker()];
const values: readonly unknown[] = [real, child, aggregate, dom, forged, plain, text];
const expected: readonly (readonly boolean[])[] = [[true, true], [true, true], [true, true], [true, true], [false, true], [false, false], [false, false]];
for (let index = 0; index < values.length; index++) {
  const answers: boolean[] = [];
  for (const checker of checkers) answers.push(checker.read(values[index]));
  assert.compareArray(answers, expected[index]);
}
console.log("brands-contrast-interface-checkers:ok");
