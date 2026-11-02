/*---
description: "Control for identity-callers-shared-site; A shared template site keeps the same cooked and raw objects across separate typed callers."
features: [ts-template-routes, ts-template-route-identity, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-function-types, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers]
---*/
// A parameter caller and an interface method forward request fields to one site; node records both callers and reuses one frozen pair of arrays. The control calls the same tag with an explicit frozen array reused for this site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
const site: TemplateStringsArray = Object.freeze(Object.assign(["caller:", ""], { raw: Object.freeze(["caller:", ""]) }));
let first: TemplateStringsArray | undefined;
function remember(strings: TemplateStringsArray): void { if (first === undefined) first = strings; same(strings, first); same(strings.raw, first.raw); }
type TagValue = number | string | boolean | bigint | symbol | null | undefined | { code: string } | readonly unknown[];
const item = { code: "same" }, other = { code: "same" }, items: readonly unknown[] = [-0, ""], token = Symbol("same");
const inputs: TagValue[] = [0, -0, NaN, "", "\u00e9", false, true, null, undefined, 0n, -9007199254740993n, token, item, other, items, []];
interface RequestValue { value: TagValue; }
interface Caller { run(request: RequestValue): void; }
const log: unknown[] = [];
function tag(strings: TemplateStringsArray, value: TagValue): void {
  parts(strings, ["caller:", ""], ["caller:", ""]); remember(strings); log.push("tag", value, typeof value);
}
function shared(request: RequestValue): void { tag(site, request.value); }
function throughParameter(request: RequestValue): void { log.push("parameter", request); shared(request); }
const field: Caller = { run(request: RequestValue): void { log.push("field", request); shared(request); } };
for (const value of inputs) {
  const request: RequestValue = { value }; log.length = 0;
  same(throughParameter(request), undefined); same(field.run(request), undefined); same(request.value, value);
  exact(log, ["parameter", request, "tag", value, typeof value, "field", request, "tag", value, typeof value]);
}
