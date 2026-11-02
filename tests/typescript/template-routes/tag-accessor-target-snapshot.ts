/*---
description: "A typed tag getter is evaluated once before a substitution changes its backing function."
features: [ts-template-routes, ts-template-route-tag-functions, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-accessors, ts-this, ts-this-parameter, ts-function-types, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers, ts-template-literals, ts-tagged-templates]
---*/
// The interface getter chooses a tag and the substitution installs its replacement; node calls the already selected function with the original receiver.
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
type SelectedTag = (this: TagSelector, strings: TemplateStringsArray, value: TagValue) => void;
interface TagSelector { current: SelectedTag; readonly tag: SelectedTag; }
const log: unknown[] = [];
function observe(label: string, receiver: TagSelector, strings: TemplateStringsArray, value: TagValue): void {
  parts(strings, ["selected:", ""], ["selected:", ""]); remember(strings); log.push(label, receiver, value, typeof value);
}
function firstTag(this: TagSelector, strings: TemplateStringsArray, value: TagValue): void { observe("first", this, strings, value); }
function secondTag(this: TagSelector, strings: TemplateStringsArray, value: TagValue): void { observe("second", this, strings, value); }
function replace(receiver: TagSelector, value: TagValue): TagValue { log.push("sub", receiver, value); receiver.current = secondTag; return value; }
function render(receiver: TagSelector, value: TagValue): void { receiver.tag`selected:${replace(receiver, value)}`; }
for (const value of inputs) {
  const receiver: TagSelector = { current: firstTag, get tag(): SelectedTag { log.push("get", this, this.current); return this.current; } };
  log.length = 0; same(render(receiver, value), undefined); same(render(receiver, value), undefined); same(receiver.current, secondTag);
  exact(log, ["get", receiver, firstTag, "sub", receiver, value, "first", receiver, value, typeof value, "get", receiver, secondTag, "sub", receiver, value, "second", receiver, value, typeof value]);
}
