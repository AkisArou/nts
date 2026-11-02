/*---
description: "Closures created by one factory share the template object at their common syntactic site."
features: [ts-template-routes, ts-template-route-identity, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-function-types, ts-closures, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers, ts-arrow-functions, ts-template-literals, ts-tagged-templates]
---*/
// A typed factory returns distinct workers with different captured tags; node keeps their labels separate while sharing the frozen arrays.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
let first: TemplateStringsArray | undefined;
function remember(strings: TemplateStringsArray): void { if (first === undefined) first = strings; same(strings, first); same(strings.raw, first.raw); }
type TagValue = number | string | boolean | bigint | symbol | null | undefined | { code: string } | readonly unknown[];
const item = { code: "same" }, other = { code: "same" }, items: readonly unknown[] = [-0, ""], token = Symbol("same");
const inputs: TagValue[] = [0, -0, NaN, "", "\u00e9", false, true, null, undefined, 0n, -9007199254740993n, token, item, other, items, []];
type TemplateWorker = (value: TagValue) => void;
const log: unknown[] = [];
function make(label: string): TemplateWorker {
  function tag(strings: TemplateStringsArray, value: TagValue): void { parts(strings, ["factory:", ""], ["factory:", ""]); remember(strings); log.push(label, value, typeof value); }
  return (value: TagValue): void => { tag`factory:${value}`; };
}
const firstWorker: TemplateWorker = make("first"), secondWorker: TemplateWorker = make("second");
same(Object.is(firstWorker, secondWorker), false);
for (const value of inputs) {
  log.length = 0; same(firstWorker(value), undefined); same(secondWorker(value), undefined); same(firstWorker(value), undefined);
  exact(log, ["first", value, typeof value, "second", value, typeof value, "first", value, typeof value]);
}
