/*---
description: "Typed flag closures retain independent masked state across repeated additions and clearing."
features: [ts-enum-routes, ts-enum-route-flags-merging, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-unions, ts-tuples, ts-interfaces, ts-closures, ts-enum, ts-enum-reverse-mapping]
---*/
// A controller interface closes over a number-or-enum mask; Node logs every flag write and read, clears only selected bits and keeps all retained controller states independent.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
enum Bits { None = 0, Read = 1, Write = 2, Execute = 4, AliasWrite = 2 }
interface Controller { write(add: Bits, remove: Bits): number; read(): number; }
interface Row { seed: number; stages: number[][]; final: number; }
const log: unknown[] = [];
function controller(seed: Bits | number): Controller {
  let mask: Bits | number = seed;
  return { write(add: Bits, remove: Bits): number { const before = mask, combined = mask | add, tested = combined & remove; mask = combined & ~remove; log.push("write", before, add, remove, combined, tested, tested === 0 ? "absent" : "present", mask); return mask; }, read(): number { log.push("read", mask); return mask; } };
}
listing(Bits, ["0", "1", "2", "4", "None", "Read", "Write", "Execute", "AliasWrite"], ["None", "Read", "AliasWrite", "Execute", 0, 1, 2, 4, 2]);
const steps: [Bits, Bits][] = [[Bits.Read, Bits.None], [Bits.Write, Bits.Read], [Bits.Execute, Bits.Write], [Bits.AliasWrite, Bits.Execute], [Bits.None, Bits.AliasWrite]];
const rows: Row[] = [{ seed: 0, stages: [[0, 1, 0, 1], [1, 3, 1, 2], [2, 6, 2, 4], [4, 6, 4, 2], [2, 2, 2, 0]], final: 0 }, { seed: 1, stages: [[1, 1, 0, 1], [1, 3, 1, 2], [2, 6, 2, 4], [4, 6, 4, 2], [2, 2, 2, 0]], final: 0 }, { seed: 2, stages: [[2, 3, 0, 3], [3, 3, 1, 2], [2, 6, 2, 4], [4, 6, 4, 2], [2, 2, 2, 0]], final: 0 }, { seed: 4, stages: [[4, 5, 0, 5], [5, 7, 1, 6], [6, 6, 2, 4], [4, 6, 4, 2], [2, 2, 2, 0]], final: 0 }, { seed: 7, stages: [[7, 7, 0, 7], [7, 7, 1, 6], [6, 6, 2, 4], [4, 6, 4, 2], [2, 2, 2, 0]], final: 0 }, { seed: 9, stages: [[9, 9, 0, 9], [9, 11, 1, 10], [10, 14, 2, 12], [12, 14, 4, 10], [10, 10, 2, 8]], final: 8 }, { seed: -1, stages: [[-1, -1, 0, -1], [-1, -1, 1, -2], [-2, -2, 2, -4], [-4, -2, 4, -6], [-6, -6, 2, -8]], final: -8 }], retained: Controller[] = [];
for (const row of rows) {
  log.length = 0; const access = controller(row.seed), expected: unknown[] = ["read", row.seed]; same(access.read(), row.seed);
  for (let i = 0; i < steps.length; i++) { const [add, remove] = steps[i], stage = row.stages[i]; same(access.write(add, remove), stage[3]); same(access.read(), stage[3]); expected.push("write", stage[0], add, remove, stage[1], stage[2], stage[2] === 0 ? "absent" : "present", stage[3], "read", stage[3]); }
  exact(log, expected); retained.push(access);
}
log.length = 0; const expected: unknown[] = []; for (let i = 0; i < retained.length; i++) { same(retained[i].read(), rows[i].final); expected.push("read", rows[i].final); } exact(log, expected);
