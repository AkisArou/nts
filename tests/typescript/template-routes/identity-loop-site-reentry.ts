/*---
description: "A loop site retains one template object through iterations, empty batches and function re-entry."
features: [ts-template-routes, ts-template-route-identity, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers, ts-template-literals, ts-tagged-templates]
---*/
// Readonly arrays enter a Batch interface; node logs every substitution and loop exit while reusing cooked/raw objects across both visits.
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
interface Batch { values: readonly TagValue[]; }
const log: unknown[] = []; let calls = 0;
function tag(strings: TemplateStringsArray, value: TagValue): void {
  parts(strings, ["loop:", ":end"], ["loop:", ":end"]); remember(strings); calls++; log.push("tag", value, typeof value);
}
function visit(batch: Batch): void { for (const value of batch.values) tag`loop:${value}:end`; log.push("exit", batch.values.length); }
const batches: Batch[] = [{ values: [] }, { values: inputs.slice(0, 3) }, { values: inputs.slice(3) }];
for (const batch of batches) {
  const expected: unknown[] = []; for (const value of batch.values) expected.push("tag", value, typeof value); expected.push("exit", batch.values.length);
  for (const repeat of [0, 1]) { log.length = 0; same(visit(batch), undefined); exact(log, expected); same(typeof repeat, "number"); }
}
same(calls, inputs.length * 2);
