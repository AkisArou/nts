/*---
description: "A callable interface retains its properties when passed to the tagged-call site."
features: [ts-template-routes, ts-template-route-tag-functions, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-call-signatures, ts-function-types, ts-closures, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers, ts-arrow-functions, ts-template-literals, ts-tagged-templates]
---*/
// NamedTag values have a call signature and label property; node reads each label and sends the unconverted input to the selected callable.
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
interface NamedTag { (strings: TemplateStringsArray, value: TagValue): void; label: string; }
const log: unknown[] = [];
function make(label: string): NamedTag {
  const handler: NamedTag = Object.assign((strings: TemplateStringsArray, value: TagValue): void => {
    parts(strings, ["callable:", ""], ["callable:", ""]); remember(strings); log.push("tag", handler.label, value, typeof value);
  }, { label }); return handler;
}
function render(handler: NamedTag, value: TagValue): void { log.push("label", handler.label); handler`callable:${value}`; }
const handlers: NamedTag[] = [make(""), make("wide")];
for (const handler of handlers) for (const value of inputs) {
  log.length = 0; same(render(handler, value), undefined); exact(log, ["label", handler.label, "tag", handler.label, value, typeof value]);
}
