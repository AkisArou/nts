/*---
description: "Class instances share a method template site while each tag keeps its own receiver."
features: [ts-template-routes, ts-template-route-identity, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers, ts-template-literals, ts-tagged-templates]
---*/
// An interface invokes the same class method on two instances; node shares the cooked/raw arrays and logs the correct instance and label.
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
interface RendererView { label: string; render(value: TagValue): void; }
const log: unknown[] = [];
class Renderer implements RendererView {
  label: string;
  constructor(label: string) { this.label = label; }
  tag(strings: TemplateStringsArray, value: TagValue): void { parts(strings, ["instance:", ""], ["instance:", ""]); remember(strings); log.push(this, this.label, value, typeof value); }
  render(value: TagValue): void { this.tag`instance:${value}`; }
}
const receivers: RendererView[] = [new Renderer(""), new Renderer("second")];
same(Object.is(receivers[0], receivers[1]), false);
for (const value of inputs) {
  log.length = 0; same(receivers[0].render(value), undefined); same(receivers[1].render(value), undefined);
  exact(log, [receivers[0], "", value, typeof value, receivers[1], "second", value, typeof value]);
}
