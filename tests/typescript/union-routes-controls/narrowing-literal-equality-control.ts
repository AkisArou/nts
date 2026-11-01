/*---
description: Control for narrowing-literal-equality; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-narrowing, ts-interfaces, ts-literal-types, ts-numbers, ts-strings, ts-null-undefined]
---*/
// Retain each literal in its own required field and choose that field by the explicit string kind instead of payload equality.
interface NarrowRow { kind: string; go: "go"; empty: ""; off: false; zero: 0; nil: null; absent: undefined; }
function row(kind: string, zero: 0): NarrowRow { return { kind, go: "go", empty: "", off: false, zero, nil: null, absent: undefined }; }
const rows: NarrowRow[] = [row("go", 0), row("empty", 0), row("off", 0), row("zero", -0), row("null", 0), row("undefined", 0), row("zero", 0)];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function choose(value: NarrowRow): NarrowRow { return { kind: value.kind, go: value.go, empty: value.empty, off: value.off, zero: value.zero, nil: value.nil, absent: value.absent }; }
function inspect(value: NarrowRow, expected: NarrowRow): void {
  if (value.kind === "go") { log.push("go"); same(value.go, expected.go); }
  else if (value.kind === "empty") { log.push("empty"); same(value.empty, expected.empty); }
  else if (value.kind === "off") { log.push("off"); same(value.off, expected.off); }
  else if (value.kind === "zero") { log.push("zero"); same(value.zero, expected.zero); }
  else if (value.kind === "null") { log.push("null"); same(value.nil, expected.nil); }
  else { log.push("undefined"); same(value.absent, expected.absent); }
}
for (const value of rows) inspect(choose(value), value);
assert.compareArray(log, ["go", "empty", "off", "zero", "null", "undefined", "zero"]);
