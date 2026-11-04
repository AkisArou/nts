/*---
description: "Replacing a typed Map value preserves internal branding separately from a forged Error prototype through guarded Map.get."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-map-set, ts-readonly]
flags: [module]
---*/
// Replacing a typed Map value preserves internal branding separately from a forged Error prototype; route: guarded Map.get.
// Node prints: brands-contrast-map-values:ok
class BrandedChild extends Error { tag: string = "child"; }
const real: Error = new Error("base");
const child: BrandedChild = new BrandedChild("child");
const aggregate: AggregateError = new AggregateError(["member"], "many");
const dom: DOMException = new DOMException("dom", "AbortError");
const forged: object = Object.create(Error.prototype);
const plain: { name: string; message: string } = { name: "Error", message: "base" };
const text: string = "Error: base";
const values: readonly unknown[] = [real, child, aggregate, dom, forged, plain, text];
const expected: readonly (readonly boolean[])[] = [[true, true], [true, true], [true, true], [true, true], [false, true], [false, false], [false, false]];
const holders: Map<string, { value: unknown }> = new Map();
function read(key: string): unknown { const holder = holders.get(key); if (holder === undefined) throw "missing"; return holder.value; }
for (let index = 0; index < values.length; index++) {
  holders.set("slot", { value: values[index] });
  const value: unknown = read("slot");
  assert.compareArray([Error.isError(value), value instanceof Error], expected[index]);
}
console.log("brands-contrast-map-values:ok");
