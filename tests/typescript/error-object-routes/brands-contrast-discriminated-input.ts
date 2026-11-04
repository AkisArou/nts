/*---
description: "Narrowing either input representation retains all internal-brand and ancestry differences through a discriminated input union."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-readonly]
flags: [module]
---*/
// Narrowing either input representation retains all internal-brand and ancestry differences; route: a discriminated input union.
// Node prints: brands-contrast-discriminated-input:ok
class BrandedChild extends Error { tag: string = "child"; }
const real: Error = new Error("base");
const child: BrandedChild = new BrandedChild("child");
const aggregate: AggregateError = new AggregateError(["member"], "many");
const dom: DOMException = new DOMException("dom", "AbortError");
const forged: object = Object.create(Error.prototype);
const plain: { name: string; message: string } = { name: "Error", message: "base" };
const text: string = "Error: base";
type Input = { kind: "direct"; value: unknown } | { kind: "box"; box: { value: unknown } };
function inspect(input: Input): boolean[] {
  const value: unknown = input.kind === "direct" ? input.value : input.box.value;
  return [Error.isError(value), value instanceof Error];
}
const values: readonly unknown[] = [real, child, aggregate, dom, forged, plain, text];
const expected: readonly (readonly boolean[])[] = [[true, true], [true, true], [true, true], [true, true], [false, true], [false, false], [false, false]];
for (let index = 0; index < values.length; index++) {
  const input: Input = index % 2 === 0 ? { kind: "direct", value: values[index] } : { kind: "box", box: { value: values[index] } };
  assert.compareArray(inspect(input), expected[index]);
}
console.log("brands-contrast-discriminated-input:ok");
