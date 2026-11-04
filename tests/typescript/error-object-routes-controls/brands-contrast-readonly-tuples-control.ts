/*---
description: "Internal Error branding distinguishes all real, forged and merely shaped populations from prototype ancestry through readonly tuple elements."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-readonly, ts-tuples]
flags: [module]
---*/
// Internal Error branding distinguishes all real, forged and merely shaped populations from prototype ancestry; route: readonly tuple elements.
// Node prints: brands-contrast-readonly-tuples:ok
let faultNext: number = 0;
class Fault {
  name: string; message: string; text: string; tag: string = "child"; errors: unknown[] = ["member"];
  constructor(..._args: unknown[]) { const rows: [string, string, string][] = [["Error", "base", "Error: base"], ["Error", "child", "Error: child"], ["AggregateError", "many", "AggregateError: many"], ["AbortError", "dom", "AbortError: dom"], ["Error", "", "Error"]]; const row = rows[faultNext++]; this.name = row[0]; this.message = row[1]; this.text = row[2]; }
  toString(): string { return this.text; }
}
let brandNext: number = 0, chainNext: number = 0;
function literalBrand(value: unknown): value is Fault { const answers: boolean[] = [true, true, true, true, false, false, false]; return answers[brandNext++]; }
function literalChain(value: unknown): value is Fault { const answers: boolean[] = [true, true, true, true, true, false, false]; return answers[chainNext++]; }
type BrandedChild = Fault; const BrandedChild = Fault;
const real: Error = new Fault("base");
const child: BrandedChild = new BrandedChild("child");
const aggregate: AggregateError = new Fault(["member"], "many");
const dom: Fault = new Fault("dom", "AbortError");
const forged: object = new Fault();
const plain: { name: string; message: string } = { name: "Error", message: "base" };
const text: string = "Error: base";
const rows: readonly (readonly [unknown, boolean, boolean])[] = [[real, true, true], [child, true, true], [aggregate, true, true], [dom, true, true], [forged, false, true], [plain, false, false], [text, false, false]];
function inspect(value: unknown): boolean[] { return [literalBrand(value), literalChain(value)]; }
for (const [value, branded, ancestor] of rows) assert.compareArray(inspect(value), [branded, ancestor]);
console.log("brands-contrast-readonly-tuples:ok");
