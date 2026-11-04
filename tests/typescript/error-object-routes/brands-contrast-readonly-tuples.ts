/*---
description: "Internal Error branding distinguishes all real, forged and merely shaped populations from prototype ancestry through readonly tuple elements."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-readonly, ts-tuples]
flags: [module]
---*/
// Internal Error branding distinguishes all real, forged and merely shaped populations from prototype ancestry; route: readonly tuple elements.
// Node prints: brands-contrast-readonly-tuples:ok
class BrandedChild extends Error { tag: string = "child"; }
const real: Error = new Error("base");
const child: BrandedChild = new BrandedChild("child");
const aggregate: AggregateError = new AggregateError(["member"], "many");
const dom: DOMException = new DOMException("dom", "AbortError");
const forged: object = Object.create(Error.prototype);
const plain: { name: string; message: string } = { name: "Error", message: "base" };
const text: string = "Error: base";
const rows: readonly (readonly [unknown, boolean, boolean])[] = [[real, true, true], [child, true, true], [aggregate, true, true], [dom, true, true], [forged, false, true], [plain, false, false], [text, false, false]];
function inspect(value: unknown): boolean[] { return [Error.isError(value), value instanceof Error]; }
for (const [value, branded, ancestor] of rows) assert.compareArray(inspect(value), [branded, ancestor]);
console.log("brands-contrast-readonly-tuples:ok");
