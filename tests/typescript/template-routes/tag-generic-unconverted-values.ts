/*---
description: "A generic tag preserves each primitive kind and object identity across explicit generic instantiations."
features: [ts-template-routes, ts-template-route-tag-functions, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-unknown, ts-typeof-operator, ts-readonly, ts-null-undefined, ts-generics, ts-type-aliases, ts-unions, ts-symbols, ts-bigint, ts-objects, ts-numbers, ts-template-literals, ts-tagged-templates]
---*/
// The tag receives T through a generic caller and logs it unchanged; node does not stringify symbols, bigints, arrays or record identities.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
function parts(strings: TemplateStringsArray, cooked: readonly string[], raw: readonly string[]): void {
  exact(strings, cooked); exact(strings.raw, raw);
  exact([strings.length, strings.raw.length, Array.isArray(strings), Array.isArray(strings.raw), Object.isFrozen(strings), Object.isFrozen(strings.raw), Object.is(strings, strings.raw)], [cooked.length, raw.length, true, true, true, true, false]);
}
let first: TemplateStringsArray | undefined;
function remember(strings: TemplateStringsArray): void { if (first === undefined) first = strings; same(strings, first); same(strings.raw, first.raw); }
const log: unknown[] = [];
function tag<T>(strings: TemplateStringsArray, value: T): void {
  parts(strings, ["[", "]"], ["[", "]"]); remember(strings); log.push("generic", value, typeof value);
}
function render<T>(value: T): void { tag<T>`[${value}]`; }
function visit<T>(values: readonly T[]): void {
  for (const value of values) { log.length = 0; same(render(value), undefined); same(render(value), undefined); exact(log, ["generic", value, typeof value, "generic", value, typeof value]); }
}
visit<number>([0, -0, NaN, Infinity, -Infinity]); visit<string>(["", "a", "\ud800"]); visit<boolean>([false, true]);
visit<bigint>([0n, -9007199254740993n]); visit<symbol>([Symbol("same"), Symbol("same")]); visit<null | undefined>([null, undefined]);
visit<{ code: string }>([{ code: "" }, { code: "same" }, { code: "same" }]); visit<readonly number[]>([[], [0, -0, NaN], [1]]);
