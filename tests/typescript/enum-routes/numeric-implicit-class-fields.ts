/*---
description: "Implicit numeric members survive class-field writes, interface reads and retained result arrays."
features: [ts-enum-routes, ts-enum-route-numeric, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-readonly, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-interfaces, ts-this, ts-objects, ts-tuples, ts-enum, ts-enum-reverse-mapping]
---*/
// Sequence counts from zero; every member passes through a class and an interface method twice, and node returns the same number and reverse name in the full read history.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
enum Sequence { Start, Middle, End }
interface Reader { value: Sequence; read(): Sequence; }
const log: unknown[] = [];
class Cell implements Reader {
  value: Sequence;
  constructor(value: Sequence) { this.value = value; }
  read(): Sequence { log.push("read", this.value); return this.value; }
}
const rows: [Sequence, number, string][] = [[Sequence.Start, 0, "Start"], [Sequence.Middle, 1, "Middle"], [Sequence.End, 2, "End"]];
const retained: Sequence[] = [];
for (const [value, expected, name] of rows) {
  log.length = 0; const cell: Reader = new Cell(Sequence.End); cell.value = value;
  for (const repeat of [0, 1]) { const result: Sequence = cell.read(); same(result, expected); same(Sequence[result], name); retained.push(result); same(repeat < 2, true); }
  same(cell.value, expected); exact(log, ["read", expected, "read", expected]);
}
exact(retained, [0, 0, 1, 1, 2, 2]);
