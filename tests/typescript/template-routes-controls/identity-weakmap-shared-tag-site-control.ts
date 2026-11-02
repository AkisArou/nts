/*---
description: "Control for identity-weakmap-shared-tag-site; A WeakMap entry is shared when different typed tag functions are called at one template site."
features: [ts-template-routes, ts-template-route-identity, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-map-set, ts-function-types, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers, ts-narrowing, ts-errors, ts-arrow-functions]
---*/
// A function parameter selects either observer at one site; node allocates one WeakMap record, retains raw identity and counts every visit. The control calls the same tag with an explicit frozen array reused for this site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
const site: TemplateStringsArray = Object.freeze(Object.assign(["weak:", ""], { raw: Object.freeze(["weak:", ""]) }));
type TagValue = number | string | boolean | bigint | symbol | null | undefined | { code: string } | readonly unknown[];
const item = { code: "same" }, other = { code: "same" }, items: readonly unknown[] = [-0, ""], token = Symbol("same");
const inputs: TagValue[] = [0, -0, NaN, "", "\u00e9", false, true, null, undefined, 0n, -9007199254740993n, token, item, other, items, []];
interface WeakEntry { raw: readonly string[]; count: number; last: TagValue; }
type CacheTag = (strings: TemplateStringsArray, value: TagValue) => void;
const cache = new WeakMap<TemplateStringsArray, WeakEntry>(), held: TemplateStringsArray[] = [], log: unknown[] = []; let created = 0;
function observe(label: string, strings: TemplateStringsArray, value: TagValue): void {
  parts(strings, ["weak:", ""], ["weak:", ""]); let entry = cache.get(strings); const fresh = entry === undefined;
  if (entry === undefined) { entry = { raw: strings.raw, count: 0, last: undefined }; cache.set(strings, entry); held.push(strings); created++; }
  same(entry.raw, strings.raw); entry.count++; entry.last = value; log.push(label, fresh, entry.count, value, typeof value);
}
const firstTag: CacheTag = (strings, value) => observe("first", strings, value), secondTag: CacheTag = (strings, value) => observe("second", strings, value);
function render(handler: CacheTag, value: TagValue): void { handler(site, value); }
for (let index = 0; index < inputs.length; index++) {
  const value = inputs[index]; log.length = 0; same(render(firstTag, value), undefined); same(render(secondTag, value), undefined);
  exact(log, ["first", index === 0, index * 2 + 1, value, typeof value, "second", false, index * 2 + 2, value, typeof value]);
}
same(created, 1); same(held.length, 1); const entry = cache.get(held[0]);
if (entry === undefined) throw new Error("missing weak entry");
same(entry.count, inputs.length * 2); same(entry.last, inputs[inputs.length - 1]); same(entry.raw, held[0].raw);
