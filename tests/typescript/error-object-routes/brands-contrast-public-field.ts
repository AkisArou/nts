/*---
description: "Stored values retain the seven-population distinction between Error branding and ancestry through public field."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-readonly, ts-this]
flags: [module]
---*/
// Stored values retain the seven-population distinction between Error branding and ancestry; route: public field.
// Node prints: brands-contrast-public-field:ok
class BrandedChild extends Error { tag: string = "child"; }
const real: Error = new Error("base");
const child: BrandedChild = new BrandedChild("child");
const aggregate: AggregateError = new AggregateError(["member"], "many");
const dom: DOMException = new DOMException("dom", "AbortError");
const forged: object = Object.create(Error.prototype);
const plain: { name: string; message: string } = { name: "Error", message: "base" };
const text: string = "Error: base";
class Holder { value: unknown; constructor(value: unknown) { this.value = value; } read(): unknown { return this.value; } }
const values: readonly unknown[] = [real, child, aggregate, dom, forged, plain, text];
const expected: readonly (readonly boolean[])[] = [[true, true], [true, true], [true, true], [true, true], [false, true], [false, false], [false, false]];
for (let index = 0; index < values.length; index++) {
  const input: unknown = values[index]; const value: unknown = new Holder(input).read();
  assert.compareArray([Error.isError(value), value instanceof Error], expected[index]);
}
console.log("brands-contrast-public-field:ok");
