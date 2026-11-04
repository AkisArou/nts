/*---
description: "A retained closure observes each later Error, impostor and primitive replacement through a captured mutable binding."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-closures, ts-function-types, ts-arrow-functions, ts-readonly]
flags: [module]
---*/
// A retained closure observes each later Error, impostor and primitive replacement; route: a captured mutable binding.
// Node prints: brands-contrast-captured-replacement:ok
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
let current: unknown;
const inspect: () => boolean[] = () => { const value: unknown = current; return [literalBrand(value), literalChain(value)]; };
const values: readonly unknown[] = [real, child, aggregate, dom, forged, plain, text];
const expected: readonly (readonly boolean[])[] = [[true, true], [true, true], [true, true], [true, true], [false, true], [false, false], [false, false]];
for (let index = 0; index < values.length; index++) {
  current = values[index];
  assert.compareArray(inspect(), expected[index]);
}
console.log("brands-contrast-captured-replacement:ok");
