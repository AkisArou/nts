/*---
description: "Retained cooked and raw arrays reject element mutation and stay unchanged on the next evaluation."
features: [ts-template-routes, ts-template-route-identity, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-this, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers, ts-closures, ts-narrowing, ts-errors, ts-arrow-functions, ts-template-literals, ts-tagged-templates]
---*/
// An interface method retains both arrays; node throws TypeError for generic fill on each frozen array and reuses both after the failed writes.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
type TagValue = number | string | boolean | bigint | symbol | null | undefined | { code: string } | readonly unknown[];
const item = { code: "same" }, other = { code: "same" }, items: readonly unknown[] = [-0, ""], token = Symbol("same");
const inputs: TagValue[] = [0, -0, NaN, "", "\u00e9", false, true, null, undefined, 0n, -9007199254740993n, token, item, other, items, []];
interface Retainer { strings: TemplateStringsArray | undefined; raw: readonly string[] | undefined; tag(strings: TemplateStringsArray, value: TagValue): void; }
const log: unknown[] = [];
const holder: Retainer = { strings: undefined, raw: undefined, tag(strings: TemplateStringsArray, value: TagValue): void {
  parts(strings, ["held:", "!"], ["held:", "!"]);
  if (this.strings === undefined) { this.strings = strings; this.raw = strings.raw; }
  same(strings, this.strings); same(strings.raw, this.raw); log.push("tag", value, typeof value);
} };
function render(receiver: Retainer, value: TagValue): void { receiver.tag`held:${value}!`; }
for (const value of inputs) {
  log.length = 0; same(render(holder, value), undefined); const strings = holder.strings, raw = holder.raw;
  if (strings === undefined || raw === undefined) throw new Error("tag did not retain its arrays");
  log.push("write", "cooked"); assert.throws(TypeError, () => { Array.prototype.fill.call(strings, "changed", 0, 1); }); log.push("blocked", "cooked");
  log.push("write", "raw"); assert.throws(TypeError, () => { Array.prototype.fill.call(raw, "changed", 0, 1); }); log.push("blocked", "raw");
  parts(strings, ["held:", "!"], ["held:", "!"]); same(strings.raw, raw); same(render(holder, value), undefined);
  exact(log, ["tag", value, typeof value, "write", "cooked", "blocked", "cooked", "write", "raw", "blocked", "raw", "tag", value, typeof value]);
}
