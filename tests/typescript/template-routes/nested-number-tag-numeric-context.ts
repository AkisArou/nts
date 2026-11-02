/*---
description: "A numeric tag result remains a number through arithmetic, nested formatting and retained interface fields."
features: [ts-template-routes, ts-template-route-nesting-composition, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-generics, ts-generic-constraints, ts-numbers, ts-strings, ts-conversions, ts-template-literals, ts-tagged-templates]
---*/
// The tag returns its raw number; Node preserves negative zero and NaN through doubling, then builds <n=raw|twice> and retains both numeric fields.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const seen: (TemplateStringsArray | undefined)[] = [];
function inspect(strings: TemplateStringsArray, site: number, parts: readonly string[]): void {
  assert.compareArray(strings, parts); assert.compareArray(strings.raw, parts); same(Object.isFrozen(strings), true); same(Object.isFrozen(strings.raw), true);
  if (seen[site] !== undefined) same(strings, seen[site]); seen[site] = strings;
}
const rows: { input: number; twice: number; text: string }[] = [
  { input: 0, twice: 0, text: "<n=0|0>" },
  { input: -0, twice: -0, text: "<n=0|0>" },
  { input: NaN, twice: NaN, text: "<n=NaN|NaN>" },
  { input: Infinity, twice: Infinity, text: "<n=Infinity|Infinity>" },
  { input: -Infinity, twice: -Infinity, text: "<n=-Infinity|-Infinity>" },
  { input: 1.5, twice: 3, text: "<n=1.5|3>" },
  { input: -1.5, twice: -3, text: "<n=-1.5|-3>" },
  { input: 2147483648, twice: 4294967296, text: "<n=2147483648|4294967296>" },
];
interface NestCell { value: number }
interface NestResult { raw: number; twice: number; text: string }
const log: unknown[] = [], retained: NestResult[] = [];
function numeric(strings: TemplateStringsArray, value: number): number { inspect(strings, 0, ["n(", ")"]); log.push("tag", value); return value; }
function render<T extends NestCell>(source: T): NestResult {
  const raw: number = numeric`n(${source.value})`; same(raw, source.value); const twice: number = raw * 2; log.push("number", raw, twice);
  const text: string = `<${`n=${raw}`}|${twice}>`; log.push("text", text); return { raw, twice, text };
}
for (const row of rows) {
  log.length = 0; const source = { value: row.input }, result: NestResult = render(source); retained.push(result);
  same(source.value, row.input); same(result.raw, row.input); same(result.twice, row.twice); same(result.text, row.text);
  exact(log, ["tag", row.input, "number", row.input, row.twice, "text", row.text]);
}
same(retained.length, rows.length);
for (let i = 0; i < retained.length; i++) { same(retained[i].raw, rows[i].input); same(retained[i].twice, rows[i].twice); same(retained[i].text, rows[i].text); }
