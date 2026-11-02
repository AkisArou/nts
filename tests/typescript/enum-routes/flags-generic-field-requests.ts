/*---
description: "A constrained generic mutates enum flag fields and returns the original extended request."
features: [ts-enum-routes, ts-enum-route-flags-merging, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-unions, ts-tuples, ts-interfaces, ts-generics, ts-generic-constraints, ts-enum, ts-enum-reverse-mapping]
---*/
// Generic request fields carry enum flags and numeric masks; Node writes each bitwise stage in place, returns the same extended object and retains independent final masks in the array.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
enum Bits { None = 0, Read = 1, Write = 2, Execute = 4, AliasWrite = 2 }
interface FlagRequest { mask: Bits | number; add: Bits; remove: Bits; }
const marker = { label: "retained" }, log: unknown[] = [];
function apply<T extends FlagRequest>(source: T): T {
  log.push("before", source.mask, source.add, source.remove); source.mask |= source.add; const tested = source.mask & source.remove; log.push("combined", source.mask, "tested", tested);
  if (tested === 0) log.push("absent"); else log.push("present"); source.mask &= ~source.remove; log.push("after", source.mask); return source;
}
listing(Bits, ["0", "1", "2", "4", "None", "Read", "Write", "Execute", "AliasWrite"], ["None", "Read", "AliasWrite", "Execute", 0, 1, 2, 4, 2]);
const rows: [number, Bits, Bits, number, number, number][] = [[0, Bits.Read, Bits.None, 1, 0, 1], [1, Bits.Write, Bits.Read, 3, 1, 2], [2, Bits.Execute, Bits.Write, 6, 2, 4], [4, Bits.AliasWrite, Bits.Execute, 6, 4, 2], [7, Bits.None, Bits.AliasWrite, 7, 2, 5], [9, Bits.Write, Bits.Execute, 11, 0, 11], [-1, Bits.None, Bits.Read, -1, 1, -2]];
const retained: FlagRequest[] = [];
for (const [input, add, remove, combined, tested, cleared] of rows) {
  log.length = 0; const request = { mask: input, add, remove, marker }, result = apply(request); same(result, request); same(result.marker, marker); same(request.mask, cleared); same(result.mask, cleared); retained.push(result);
  exact(log, ["before", input, add, remove, "combined", combined, "tested", tested, tested === 0 ? "absent" : "present", "after", cleared]);
}
for (let i = 0; i < retained.length; i++) { same(retained[i].mask, rows[i][5]); same(retained[i].add, rows[i][1]); same(retained[i].remove, rows[i][2]); }
