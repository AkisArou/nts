/*---
description: "Two generic populations retain every real-error and impostor branding answer through generic helpers at Error and object-or-string type arguments."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-generics, ts-generic-constraints, ts-unions, ts-readonly, ts-spread]
flags: [module]
---*/
// Two generic populations retain every real-error and impostor branding answer; route: generic helpers at Error and object-or-string type arguments.
// Node prints: brands-contrast-generic-populations:ok
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
function inspect<T extends object | string>(values: readonly T[]): boolean[][] {
  const answers: boolean[][] = [];
  for (const value of values) answers.push([literalBrand(value), literalChain(value)]);
  return answers;
}
const positive: readonly Error[] = [real, child, aggregate, dom];
const negative: readonly (object | string)[] = [forged, plain, text];
const answers: boolean[][] = [...inspect<Error>(positive), ...inspect<object | string>(negative)];
const expected: readonly (readonly boolean[])[] = [[true, true], [true, true], [true, true], [true, true], [false, true], [false, false], [false, false]];
for (let index = 0; index < answers.length; index++) assert.compareArray(answers[index], expected[index]);
console.log("brands-contrast-generic-populations:ok");
