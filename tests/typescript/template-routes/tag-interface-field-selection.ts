/*---
description: "An interface function field selects either tag implementation while retaining raw substitution values."
features: [ts-template-routes, ts-template-route-tag-functions, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-function-types, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers, ts-arrow-functions, ts-template-literals, ts-tagged-templates]
---*/
// Two carrier layouts dispatch a shared template site to different stored tags; node logs the selected target and unconverted value.
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
type StoredTag = (strings: TemplateStringsArray, value: TagValue) => void;
interface TagCarrier { tag: StoredTag; }
const log: unknown[] = [];
function observe(label: string, strings: TemplateStringsArray, value: TagValue): void {
  parts(strings, ["field:", "!"], ["field:", "!"]); remember(strings); log.push(label, value, typeof value);
}
const firstTag: StoredTag = (strings, value) => observe("first", strings, value), secondTag: StoredTag = (strings, value) => observe("second", strings, value);
const wide = { padding: 7, tag: secondTag }, carriers: TagCarrier[] = [{ tag: firstTag }, wide];
function render(carrier: TagCarrier, value: TagValue): void { carrier.tag`field:${value}!`; }
for (const value of inputs) {
  log.length = 0; same(render(carriers[0], value), undefined); same(render(carriers[1], value), undefined);
  same(carriers[0].tag, firstTag); same(carriers[1].tag, secondTag); exact(log, ["first", value, typeof value, "second", value, typeof value]);
}
