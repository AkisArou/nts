/*---
description: "Control for identity-distinct-equal-text-sites; Identical text at two typed call sites produces distinct cooked and raw arrays."
features: [ts-template-routes, ts-template-route-identity, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-interfaces, ts-function-types, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers]
---*/
// Interface function fields select two equal-text sites; node reuses each site separately and logs the left/left/right/right call order. The control calls the same tag with an explicit frozen array reused for this site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
const leftSite: TemplateStringsArray = Object.freeze(Object.assign(["equal:", "!"], { raw: Object.freeze(["equal:", "!"]) }));
const rightSite: TemplateStringsArray = Object.freeze(Object.assign(["equal:", "!"], { raw: Object.freeze(["equal:", "!"]) }));
type TagValue = number | string | boolean | bigint | symbol | null | undefined | { code: string } | readonly unknown[];
const item = { code: "same" }, other = { code: "same" }, items: readonly unknown[] = [-0, ""], token = Symbol("same");
const inputs: TagValue[] = [0, -0, NaN, "", "\u00e9", false, true, null, undefined, 0n, -9007199254740993n, token, item, other, items, []];
interface Routes { left: (value: TagValue) => void; right: (value: TagValue) => void; }
const seen: TemplateStringsArray[] = [], log: unknown[] = [];
function tag(strings: TemplateStringsArray, value: TagValue): void { parts(strings, ["equal:", "!"], ["equal:", "!"]); seen.push(strings); log.push("tag", value, typeof value); }
function firstSite(value: TagValue): void { log.push("left"); tag(leftSite, value); }
function secondSite(value: TagValue): void { log.push("right"); tag(rightSite, value); }
const routes: Routes = { left: firstSite, right: secondSite };
for (const value of inputs) {
  log.length = 0; same(routes.left(value), undefined); same(routes.left(value), undefined); same(routes.right(value), undefined); same(routes.right(value), undefined);
  const offset = seen.length - 4;
  for (const index of [offset, offset + 1]) { same(seen[index], seen[0]); same(seen[index].raw, seen[0].raw); }
  for (const index of [offset + 2, offset + 3]) { same(seen[index], seen[2]); same(seen[index].raw, seen[2].raw); }
  same(Object.is(seen[0], seen[2]), false); same(Object.is(seen[0].raw, seen[2].raw), false);
  exact(log, ["left", "tag", value, typeof value, "left", "tag", value, typeof value, "right", "tag", value, typeof value, "right", "tag", value, typeof value]);
}
same(seen.length, inputs.length * 4);
