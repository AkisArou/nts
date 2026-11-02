/*---
description: "Control for tag-adjacent-rest-tuple; Adjacent substitutions reach a typed rest tuple in order with four empty string segments."
features: [ts-template-routes, ts-template-route-tag-functions, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-tuples, ts-rest-parameters, ts-type-aliases, ts-unions, ts-numbers, ts-objects]
---*/
// A number/string/boolean tuple feeds one tag; node preserves signed zero, NaN, empty text and the exact positional argument kinds. The control calls the same tag with an explicit frozen array reused for this site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
const site: TemplateStringsArray = Object.freeze(Object.assign(["", "", "", ""], { raw: Object.freeze(["", "", "", ""]) }));
let first: TemplateStringsArray | undefined;
function remember(strings: TemplateStringsArray): void { if (first === undefined) first = strings; same(strings, first); same(strings.raw, first.raw); }
type TagArguments = readonly [number, string, boolean];
const log: unknown[] = [];
function tag(strings: TemplateStringsArray, ...values: [number, string, boolean]): void {
  parts(strings, ["", "", "", ""], ["", "", "", ""]); remember(strings);
  log.push("tag", values.length, values[0], typeof values[0], values[1], typeof values[1], values[2], typeof values[2]);
}
function render(values: TagArguments): void { tag(site, values[0], values[1], values[2]); }
const rows: TagArguments[] = [[0, "", false], [-0, "a", true], [NaN, "\u00e9", false], [Infinity, "\ud83d\ude00", true], [-Infinity, "\ud800", false]];
for (const row of rows) {
  log.length = 0; same(render(row), undefined); same(render(row), undefined);
  exact(log, ["tag", 3, row[0], "number", row[1], "string", row[2], "boolean", "tag", 3, row[0], "number", row[1], "string", row[2], "boolean"]);
}
