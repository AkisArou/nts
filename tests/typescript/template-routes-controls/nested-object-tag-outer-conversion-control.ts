/*---
description: "Explicit construction control: An object-returning tag crosses a typed return before an outer template converts it."
features: [ts-template-routes, ts-template-route-nesting-composition, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-unions, ts-interfaces, ts-objects, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-conversions, ts-to-string]
---*/
// The tag logs and returns the original box; Node converts that same object only in the outer template and returns out:<payload>:end. Control: use explicit strings and ordinary calls with frozen, reused arrays for each site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const seen: (TemplateStringsArray | undefined)[] = [];
function inspect(strings: TemplateStringsArray, site: number, parts: readonly string[]): void {
  assert.compareArray(strings, parts); assert.compareArray(strings.raw, parts); same(Object.isFrozen(strings), true); same(Object.isFrozen(strings.raw), true);
  if (seen[site] !== undefined) same(strings, seen[site]); seen[site] = strings;
}
function literal(parts: string[]): TemplateStringsArray { return Object.freeze(Object.assign(parts, { raw: Object.freeze(parts.slice()) })); }
const boxSite: TemplateStringsArray = literal(["box(",")"]);
type NestInput = number | string | boolean | null | undefined | bigint;
const rows: { input: NestInput; text: string }[] = [
  { input: 0, text: "0" }, { input: -0, text: "0" }, { input: NaN, text: "NaN" },
  { input: Infinity, text: "Infinity" }, { input: -Infinity, text: "-Infinity" }, { input: "", text: "" },
  { input: "abc", text: "abc" }, { input: "\u00e9", text: "\u00e9" }, { input: "\ud83d\ude42", text: "\ud83d\ude42" },
  { input: "\ud800", text: "\ud800" }, { input: true, text: "true" }, { input: false, text: "false" },
  { input: null, text: "null" }, { input: undefined, text: "undefined" }, { input: 17n, text: "17" },
];
interface NestBox { value: NestInput; toString(): string }
const log: unknown[] = [], returned: NestBox[] = [];
function keep(strings: TemplateStringsArray, value: NestBox): NestBox { inspect(strings, 0, ["box(", ")"]); log.push("tag", value); return value; }
function record(value: NestBox): NestBox { returned.push(value); log.push("returned", value); return value; }
function render(value: NestBox): string { return "out:" + String(record(keep(boxSite, value))) + ":end"; }
for (const row of rows) {
  log.length = 0; const source: NestBox = { value: row.input, toString(): string { log.push("string", this.value); return String(this.value); } };
  const result: string = render(source); same(result, "out:" + row.text + ":end"); same(source.value, row.input); same(returned[returned.length - 1], source);
  exact(log, ["tag", source, "returned", source, "string", row.input]);
}
same(returned.length, rows.length);
for (let i = 0; i < returned.length; i++) same(returned[i].value, rows[i].input);
