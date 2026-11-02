/*---
description: "A typed Map cache retains separate entries for equal-text sites and reuses each on later calls."
features: [ts-template-routes, ts-template-route-identity, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-map-set, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers, ts-narrowing, ts-errors, ts-spread, ts-template-literals, ts-tagged-templates]
---*/
// The tag keys a Map by TemplateStringsArray and stores raw identity, visit counts and original values; node preserves two entries and exact insertion order.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
type TagValue = number | string | boolean | bigint | symbol | null | undefined | { code: string } | readonly unknown[];
const item = { code: "same" }, other = { code: "same" }, items: readonly unknown[] = [-0, ""], token = Symbol("same");
const inputs: TagValue[] = [0, -0, NaN, "", "\u00e9", false, true, null, undefined, 0n, -9007199254740993n, token, item, other, items, []];
interface CacheEntry { raw: readonly string[]; count: number; values: TagValue[]; }
const cache = new Map<TemplateStringsArray, CacheEntry>(), seen: TemplateStringsArray[] = [], log: unknown[] = [];
function tag(strings: TemplateStringsArray, value: TagValue): void {
  parts(strings, ["map:", ""], ["map:", ""]); seen.push(strings); let entry = cache.get(strings); const fresh = entry === undefined;
  if (entry === undefined) { entry = { raw: strings.raw, count: 0, values: [] }; cache.set(strings, entry); }
  same(entry.raw, strings.raw); entry.count++; entry.values.push(value); log.push("tag", fresh, entry.count, value, typeof value);
}
function firstSite(value: TagValue): void { tag`map:${value}`; }
function secondSite(value: TagValue): void { tag`map:${value}`; }
for (let index = 0; index < inputs.length; index++) {
  const value = inputs[index]; log.length = 0; firstSite(value); secondSite(value); firstSite(value);
  exact(log, ["tag", index === 0, index * 2 + 1, value, typeof value, "tag", index === 0, index + 1, value, typeof value, "tag", false, index * 2 + 2, value, typeof value]);
}
same(cache.size, 2); same(seen.length, inputs.length * 3); const keys = [...cache.keys()]; exact(keys, [seen[0], seen[1]]);
same(Object.is(keys[0], keys[1]), false); same(Object.is(keys[0].raw, keys[1].raw), false);
const firstEntry = cache.get(keys[0]), secondEntry = cache.get(keys[1]);
if (firstEntry === undefined || secondEntry === undefined) throw new Error("missing cache entry");
const expected: TagValue[] = []; for (const value of inputs) expected.push(value, value);
same(firstEntry.count, inputs.length * 2); same(secondEntry.count, inputs.length); exact(firstEntry.values, expected); exact(secondEntry.values, inputs);
