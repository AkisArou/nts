/*---
description: "Two generic populations retain every real-error and impostor branding answer through generic helpers at Error and object-or-string type arguments."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-generics, ts-generic-constraints, ts-unions, ts-readonly, ts-spread]
flags: [module]
---*/
// Two generic populations retain every real-error and impostor branding answer; route: generic helpers at Error and object-or-string type arguments.
// Node prints: brands-contrast-generic-populations:ok
class BrandedChild extends Error { tag: string = "child"; }
const real: Error = new Error("base");
const child: BrandedChild = new BrandedChild("child");
const aggregate: AggregateError = new AggregateError(["member"], "many");
const dom: DOMException = new DOMException("dom", "AbortError");
const forged: object = Object.create(Error.prototype);
const plain: { name: string; message: string } = { name: "Error", message: "base" };
const text: string = "Error: base";
function inspect<T extends object | string>(values: readonly T[]): boolean[][] {
  const answers: boolean[][] = [];
  for (const value of values) answers.push([Error.isError(value), value instanceof Error]);
  return answers;
}
const positive: readonly Error[] = [real, child, aggregate, dom];
const negative: readonly (object | string)[] = [forged, plain, text];
const answers: boolean[][] = [...inspect<Error>(positive), ...inspect<object | string>(negative)];
const expected: readonly (readonly boolean[])[] = [[true, true], [true, true], [true, true], [true, true], [false, true], [false, false], [false, false]];
for (let index = 0; index < answers.length; index++) assert.compareArray(answers[index], expected[index]);
console.log("brands-contrast-generic-populations:ok");
