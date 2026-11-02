/*---
description: "A typed callable parameter receives a single cooked/raw segment and no substitution arguments."
features: [ts-template-routes, ts-template-route-tag-functions, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-function-types, ts-rest-parameters, ts-closures, ts-unions, ts-numbers, ts-arrow-functions, ts-type-aliases, ts-never, ts-template-literals, ts-tagged-templates]
---*/
// A no-substitution site calls differently captured QuietTag values; node logs each marker, zero arguments and the same frozen arrays.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
let first: TemplateStringsArray | undefined;
function remember(strings: TemplateStringsArray): void { if (first === undefined) first = strings; same(strings, first); same(strings.raw, first.raw); }
type QuietTag = (strings: TemplateStringsArray, ...values: never[]) => void;
const log: unknown[] = [];
function render(callback: QuietTag): void { callback`plain\n`; }
for (const marker of ["", "ascii", "\u00e9", "\ud83d\ude00", "\ud800"]) {
  log.length = 0;
  const callback: QuietTag = (strings, ...values) => {
    parts(strings, ["plain\n"], ["plain\\n"]); remember(strings); exact(values, []); log.push("tag", marker, typeof marker, values.length);
  };
  same(render(callback), undefined); same(render(callback), undefined);
  exact(log, ["tag", marker, "string", 0, "tag", marker, "string", 0]);
}
