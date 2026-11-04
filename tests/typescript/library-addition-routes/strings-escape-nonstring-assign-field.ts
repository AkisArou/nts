/*---
description: "RegExp.escape rejects non-string values before reading or calling conversion hooks."
features: [ts-library-addition-routes, ts-library-addition-route-strings, ts-strings, ts-arrays, ts-iteration, ts-functions, ts-numbers, ts-typeof-operator, ts-interfaces, ts-objects, ts-accessors, ts-function-types, ts-unknown, ts-unions, ts-null-undefined, ts-tuples, ts-symbols, ts-bigint, ts-errors, ts-unsound-object-assign, ts-to-primitive, ts-conversions, ts-closures]
---*/
// RegExp.escape through an ordinarily overwritten string-declared interface field; node throws TypeError without conversion, while primitive strings still succeed.
const log: string[] = [];
interface Source { text: string; }
const ordinary = { toString(): string { log.push("toString"); return "a"; }, valueOf(): number { log.push("valueOf"); return 1; } };
const exotic = { get [Symbol.toPrimitive](): (hint: string) => string { log.push("primitive:get"); return function (hint: string): string { log.push("primitive:" + hint); return "a"; }; } };
function callable(): string { log.push("called"); return "a"; }
function run(source: Source, expected: string): string {
  log.push("run"); const text = source.text;
  return RegExp.escape(text);
}
const rows: [unknown, string | undefined][] = [
  ["", ""], ["A", "\\x41"], ["é", "é"], ["/", "\\/"],
  [undefined, undefined], [null, undefined], [false, undefined], [true, undefined],
  [0, undefined], [-0, undefined], [NaN, undefined], [Infinity, undefined], [1n, undefined], [Symbol("text"), undefined],
  [{}, undefined], [[], undefined], [["a"], undefined], [new String("a"), undefined], [ordinary, undefined], [exotic, undefined], [callable, undefined]
];
for (const row of rows) {
  const source: Source = { text: "initial" }; Object.assign(source, { text: row[0] }); let result: string | undefined;
  function attempt(): void { log.push("attempt"); result = run(source, row[1] ?? ""); }
  log.length = 0;
  if (row[1] === undefined) assert.throws(TypeError, attempt); else attempt();
  assert.compareArray(log, ["attempt", "run"]);
  assert.sameValue(result, row[1]); assert.sameValue(typeof result, typeof row[1]); assert.sameValue(Object.is(source.text, row[0]), true);
}
