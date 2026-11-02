/*---
description: "Explicit construction control: A tag returns a fresh typed closure that is called after its source field changes, including a later throwing call."
features: [ts-template-routes, ts-template-route-nesting-composition, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-unions, ts-function-types, ts-interfaces, ts-objects, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-conversions, ts-closures, ts-arrow-functions, ts-errors]
---*/
// The tag captures the original substitution; Node later returns [old:after], rereads old:old and throws the captured Error from the same returned function. Control: use explicit strings and ordinary calls with frozen, reused arrays for each site.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const seen: (TemplateStringsArray | undefined)[] = [];
function inspect(strings: TemplateStringsArray, site: number, parts: readonly string[]): void {
  assert.compareArray(strings, parts); assert.compareArray(strings.raw, parts); same(Object.isFrozen(strings), true); same(Object.isFrozen(strings.raw), true);
  if (seen[site] !== undefined) same(strings, seen[site]); seen[site] = strings;
}
function literal(parts: string[]): TemplateStringsArray { return Object.freeze(Object.assign(parts, { raw: Object.freeze(parts.slice()) })); }
const functionSite: TemplateStringsArray = literal(["fn(",")",""]);
type NestInput = number | string | boolean | null | undefined | bigint;
const rows: { input: NestInput; text: string }[] = [
  { input: 0, text: "0" }, { input: -0, text: "0" }, { input: NaN, text: "NaN" },
  { input: Infinity, text: "Infinity" }, { input: -Infinity, text: "-Infinity" }, { input: "", text: "" },
  { input: "abc", text: "abc" }, { input: "\u00e9", text: "\u00e9" }, { input: "\ud83d\ude42", text: "\ud83d\ude42" },
  { input: "\ud800", text: "\ud800" }, { input: true, text: "true" }, { input: false, text: "false" },
  { input: null, text: "null" }, { input: undefined, text: "undefined" }, { input: 17n, text: "17" },
];
type NestRender = (suffix: NestInput) => string;
interface NestCell { value: NestInput }
interface NestResult { render: NestRender; text: string }
const log: unknown[] = [], retained: NestRender[] = [];
function build(strings: TemplateStringsArray, value: NestInput, problem: Error): NestRender {
  inspect(strings, 0, ["fn(", ")", ""]); log.push("build", value);
  return (suffix: NestInput): string => { log.push("call", value, suffix); if (suffix === "throw") { log.push("throw", problem); throw problem; } return String(value) + ":" + String(suffix); };
}
function render(source: NestCell, problem: Error): NestResult {
  const callback: NestRender = build(functionSite, source.value, problem); source.value = "after"; log.push("write", source.value);
  const holder: { render: NestRender } = { render: callback }; same(holder.render, callback);
  const text: string = "[" + String(holder.render(source.value)) + "]"; log.push("result", text); return { render: holder.render, text };
}
for (const row of rows) {
  log.length = 0; const source = { value: row.input }, problem = new Error("nested call"), result = render(source, problem);
  same(result.text, "[" + row.text + ":after]"); same(source.value, "after"); assert.sameValue(typeof result.render, "function");
  for (const previous of retained) same(Object.is(previous, result.render), false); retained.push(result.render);
  same(result.render(row.input), row.text + ":" + row.text);
  assert.throws(Error, () => { try { result.render("throw"); } catch (error: unknown) { same(error, problem); throw error; } });
  exact(log, ["build", row.input, "write", "after", "call", row.input, "after", "result", "[" + row.text + ":after]", "call", row.input, row.input, "call", row.input, "throw", "throw", problem]);
}
same(retained.length, rows.length);
