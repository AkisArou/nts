/*---
description: "Control for tag-unconverted-primitive-hooks; Tagged object and symbol substitutions bypass every implicit primitive-conversion hook."
features: [ts-template-routes, ts-template-route-tag-functions, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-to-primitive, ts-symbols, ts-this, ts-type-aliases, ts-unions, ts-rest-parameters, ts-objects, ts-numbers, ts-closures, ts-computed-keys, ts-errors]
---*/
// A declared hook-bearing object or symbol crosses a typed parameter twice; node logs the original identities and never calls the throwing conversion hooks. The control calls the same tag with an explicit frozen array reused for this site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
const site: TemplateStringsArray = Object.freeze(Object.assign(["", "!", ""], { raw: Object.freeze(["", "!", ""]) }));
let first: TemplateStringsArray | undefined;
function remember(strings: TemplateStringsArray): void { if (first === undefined) first = strings; same(strings, first); same(strings.raw, first.raw); }
interface Unconverted { code: number; [Symbol.toPrimitive](hint: string): string; toString(): string; valueOf(): number; }
type InputValue = Unconverted | symbol;
const log: unknown[] = [], marker = new Error("conversion must stay absent");
function make(code: number): Unconverted {
  return { code, [Symbol.toPrimitive](hint: string): string { log.push("primitive", this, hint); throw marker; }, toString(): string { log.push("toString", this); throw marker; }, valueOf(): number { log.push("valueOf", this); throw marker; } };
}
function tag(strings: TemplateStringsArray, ...values: InputValue[]): void {
  parts(strings, ["", "!", ""], ["", "!", ""]); remember(strings); same(values.length, 2); same(values[0], values[1]); log.push("tag", values[0], typeof values[0], values[1], typeof values[1]);
}
function render(value: InputValue): void { tag(site, value, value); }
const inputs: InputValue[] = [make(-0), make(NaN), make(3), Symbol(""), Symbol("same"), Symbol("same")];
for (const value of inputs) {
  log.length = 0; same(render(value), undefined); same(render(value), undefined);
  exact(log, ["tag", value, typeof value, value, typeof value, "tag", value, typeof value, value, typeof value]);
}
