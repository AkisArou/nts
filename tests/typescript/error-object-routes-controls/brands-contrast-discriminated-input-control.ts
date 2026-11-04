/*---
description: "Narrowing either input representation retains all internal-brand and ancestry differences through a discriminated input union."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-unknown, ts-instanceof, ts-type-guards, ts-objects, ts-arrays, ts-iteration, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-readonly]
flags: [module]
---*/
// Narrowing either input representation retains all internal-brand and ancestry differences; route: a discriminated input union.
// Node prints: brands-contrast-discriminated-input:ok
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
type Input = { kind: "direct"; value: unknown } | { kind: "box"; box: { value: unknown } };
function inspect(input: Input): boolean[] {
  const value: unknown = input.kind === "direct" ? input.value : input.box.value;
  return [literalBrand(value), literalChain(value)];
}
const values: readonly unknown[] = [real, child, aggregate, dom, forged, plain, text];
const expected: readonly (readonly boolean[])[] = [[true, true], [true, true], [true, true], [true, true], [false, true], [false, false], [false, false]];
for (let index = 0; index < values.length; index++) {
  const input: Input = index % 2 === 0 ? { kind: "direct", value: values[index] } : { kind: "box", box: { value: values[index] } };
  assert.compareArray(inspect(input), expected[index]);
}
console.log("brands-contrast-discriminated-input:ok");
