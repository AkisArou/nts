/*---
description: "Control for tag-method-receiver; Methods used as tags retain their interface receiver and its changing state."
features: [ts-template-routes, ts-template-route-tag-functions, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-this, ts-this-parameter, ts-function-types, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers]
---*/
// Two method-bearing layouts read this.label and increment this.count at one tag site; node logs receiver identity, state and unconverted substitutions. The control calls the same tag with an explicit frozen array reused for this site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
const site: TemplateStringsArray = Object.freeze(Object.assign(["method\n", ""], { raw: Object.freeze(["method\\n", ""]) }));
let first: TemplateStringsArray | undefined;
function remember(strings: TemplateStringsArray): void { if (first === undefined) first = strings; same(strings, first); same(strings.raw, first.raw); }
type TagValue = number | string | boolean | bigint | symbol | null | undefined | { code: string } | readonly unknown[];
const item = { code: "same" }, other = { code: "same" }, items: readonly unknown[] = [-0, ""], token = Symbol("same");
const inputs: TagValue[] = [0, -0, NaN, "", "\u00e9", false, true, null, undefined, 0n, -9007199254740993n, token, item, other, items, []];
interface TagMethod { label: string; count: number; tag(strings: TemplateStringsArray, value: TagValue): void; }
const log: unknown[] = [];
function capture(this: TagMethod, strings: TemplateStringsArray, value: TagValue): void {
  parts(strings, ["method\n", ""], ["method\\n", ""]); remember(strings);
  log.push("method", this, this.label, this.count, value, typeof value); this.count++; log.push("after", this.count);
}
const wide = { padding: true, label: "wide", count: 0, tag: capture }, carriers: TagMethod[] = [{ label: "", count: 0, tag: capture }, wide];
function render(receiver: TagMethod, value: TagValue): void { receiver.tag(site, value); }
for (const receiver of carriers) for (let index = 0; index < inputs.length; index++) {
  const value = inputs[index]; log.length = 0; same(render(receiver, value), undefined); same(receiver.count, index + 1);
  exact(log, ["method", receiver, receiver.label, index, value, typeof value, "after", index + 1]);
}
