/*---
description: Literal equality narrows a returned union while preserving the sign of a zero payload.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-unions, ts-narrowing, ts-literal-types, ts-numbers, ts-strings, ts-null-undefined]
---*/
// A returned literal union includes go, empty text, false, signed zero, null and undefined; equality selects each member and node keeps -0 distinct at the value check.
interface NarrowRow { kind: string; go: "go"; empty: ""; off: false; zero: 0; nil: null; absent: undefined; }
function row(kind: string, zero: 0): NarrowRow { return { kind, go: "go", empty: "", off: false, zero, nil: null, absent: undefined }; }
const rows: NarrowRow[] = [row("go", 0), row("empty", 0), row("off", 0), row("zero", -0), row("null", 0), row("undefined", 0), row("zero", 0)];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type LiteralChoice = "go" | "" | false | 0 | null | undefined;
function choose(value: NarrowRow): LiteralChoice {
  if (value.kind === "go") return value.go;
  if (value.kind === "empty") return value.empty;
  if (value.kind === "off") return value.off;
  if (value.kind === "zero") return value.zero;
  return value.kind === "null" ? value.nil : value.absent;
}
function inspect(value: LiteralChoice, expected: NarrowRow): void {
  if (value === "go") { log.push("go"); same(value, expected.go); }
  else if (value === "") { log.push("empty"); same(value, expected.empty); }
  else if (value === false) { log.push("off"); same(value, expected.off); }
  else if (value === 0) { log.push("zero"); same(value, expected.zero); }
  else if (value === null) { log.push("null"); same(value, expected.nil); }
  else { log.push("undefined"); same(value, expected.absent); }
}
for (const value of rows) inspect(choose(value), value);
assert.compareArray(log, ["go", "empty", "off", "zero", "null", "undefined", "zero"]);
