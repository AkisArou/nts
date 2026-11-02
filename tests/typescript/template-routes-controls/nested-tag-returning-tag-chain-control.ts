/*---
description: "Explicit construction control: The first tagged call returns the typed tag invoked by a second template after an intervening state change."
features: [ts-template-routes, ts-template-route-nesting-composition, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-unions, ts-function-types, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-conversions, ts-closures, ts-arrow-functions]
---*/
// The first tag logs its input and writes next; Node then evaluates the second substitution and calls the returned tag, producing <old|next>. Control: use explicit strings and ordinary calls with frozen, reused arrays for each site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const seen: (TemplateStringsArray | undefined)[] = [];
function inspect(strings: TemplateStringsArray, site: number, parts: readonly string[]): void {
  assert.compareArray(strings, parts); assert.compareArray(strings.raw, parts); same(Object.isFrozen(strings), true); same(Object.isFrozen(strings.raw), true);
  if (seen[site] !== undefined) same(strings, seen[site]); seen[site] = strings;
}
function literal(parts: string[]): TemplateStringsArray { return Object.freeze(Object.assign(parts, { raw: Object.freeze(parts.slice()) })); }
const firstSite: TemplateStringsArray = literal(["first(",")"]);
const secondSite: TemplateStringsArray = literal(["second(",")"]);
type NestInput = number | string | boolean | null | undefined | bigint;
const rows: { input: NestInput; text: string }[] = [
  { input: 0, text: "0" }, { input: -0, text: "0" }, { input: NaN, text: "NaN" },
  { input: Infinity, text: "Infinity" }, { input: -Infinity, text: "-Infinity" }, { input: "", text: "" },
  { input: "abc", text: "abc" }, { input: "\u00e9", text: "\u00e9" }, { input: "\ud83d\ude42", text: "\ud83d\ude42" },
  { input: "\ud800", text: "\ud800" }, { input: true, text: "true" }, { input: false, text: "false" },
  { input: null, text: "null" }, { input: undefined, text: "undefined" }, { input: 17n, text: "17" },
];
type NestTag = (strings: TemplateStringsArray, value: NestInput) => string;
const log: unknown[] = []; let state: NestInput = undefined;
function left(value: NestInput): NestInput { log.push("left", value); return value; }
function right(): NestInput { log.push("right", state); return state; }
function first(strings: TemplateStringsArray, value: NestInput): NestTag {
  inspect(strings, 0, ["first(", ")"]); log.push("first", value); state = "next"; log.push("write", state);
  return (next: TemplateStringsArray, other: NestInput): string => { inspect(next, 1, ["second(", ")"]); same(Object.is(strings, next), false); log.push("second", value, other); return "<" + String(value) + "|" + String(other) + ">"; };
}
function render(value: NestInput): string { return first(firstSite, left(value))(secondSite, right()); }
for (const row of rows) {
  log.length = 0; state = row.input; const result: string = render(row.input); same(result, "<" + row.text + "|next>"); same(state, "next");
  exact(log, ["left", row.input, "first", row.input, "write", "next", "right", "next", "second", row.input, "next"]);
}
