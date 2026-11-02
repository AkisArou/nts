/*---
description: "Enum-valued parameters combine, test and clear masks while retaining wide numeric inputs."
features: [ts-enum-routes, ts-enum-route-flags-merging, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-unions, ts-tuples, ts-null-undefined, ts-enum, ts-enum-reverse-mapping]
---*/
// Enum flag parameters: Node applies signed 32-bit combine/test/clear operations, logs both test branches and returns the exact cleared number and any last-alias reverse name.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
enum Bits { None = 0, Read = 1, Write = 2, Execute = 4, AliasWrite = 2 }
const log: unknown[] = [];
function change(value: Bits | number, add: Bits, remove: Bits): number {
  const combined = value | add, tested = combined & remove; log.push("combine", value, add, combined, "test", remove, tested);
  if (tested === 0) log.push("absent"); else log.push("present");
  const cleared = combined & ~remove; log.push("clear", cleared); return cleared;
}
listing(Bits, ["0", "1", "2", "4", "None", "Read", "Write", "Execute", "AliasWrite"], ["None", "Read", "AliasWrite", "Execute", 0, 1, 2, 4, 2]);
const rows: [number, Bits, Bits, number, number, number, string | undefined][] = [[0, Bits.None, Bits.None, 0, 0, 0, "None"], [0, Bits.Read, Bits.Write, 1, 0, 1, "Read"], [1, Bits.Write, Bits.Read, 3, 1, 2, "AliasWrite"], [2, Bits.Execute, Bits.Write, 6, 2, 4, "Execute"], [4, Bits.AliasWrite, Bits.Execute, 6, 4, 2, "AliasWrite"], [7, Bits.None, Bits.AliasWrite, 7, 2, 5, undefined], [9, Bits.Write, Bits.Execute, 11, 0, 11, undefined], [-1, Bits.None, Bits.Read, -1, 1, -2, undefined], [2147483648, Bits.Read, Bits.Write, -2147483647, 0, -2147483647, undefined], [NaN, Bits.Execute, Bits.None, 4, 0, 4, "Execute"], [-0, Bits.None, Bits.None, 0, 0, 0, "None"], [Infinity, Bits.Execute, Bits.None, 4, 0, 4, "Execute"]];
for (const [input, add, remove, combined, tested, cleared, reverse] of rows) {
  log.length = 0; const result: number = change(input, add, remove); same(result, cleared); same(Bits[result], reverse);
  exact(log, ["combine", input, add, combined, "test", remove, tested, tested === 0 ? "absent" : "present", "clear", cleared]);
}
