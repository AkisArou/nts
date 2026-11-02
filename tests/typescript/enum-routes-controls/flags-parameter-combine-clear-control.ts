/*---
description: "Explicit object control: Enum-valued parameters combine, test and clear masks while retaining wide numeric inputs."
features: [ts-enum-routes, ts-enum-route-flags-merging, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-objects, ts-object-type, ts-readonly, ts-strings, ts-numbers, ts-type-aliases, ts-unions, ts-tuples, ts-null-undefined, ts-record, ts-computed-keys, ts-literal-types]
---*/
// Enum flag parameters: Node applies signed 32-bit combine/test/clear operations, logs both test branches and returns the exact cleared number and any last-alias reverse name. Control: Replace the enum by frozen literal forward data and an explicit reverse table, preserve number-or-member parameter types, and execute the same bitwise computation and branch log.
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
function listing(value: object, keys: readonly string[], values: readonly unknown[]): void {
  exact(Object.keys(value), keys); exact(Object.values(value), values); const entries = Object.entries(value); same(entries.length, keys.length);
  for (let i = 0; i < entries.length; i++) exact(entries[i], [keys[i], values[i]]);
  const visited: string[] = []; for (const key in value) visited.push(key); exact(visited, keys);
}
const BitsForward = Object.freeze({ None: 0, Read: 1, Write: 2, Execute: 4, AliasWrite: 2 });
const BitsReverse: Readonly<Record<number, string>> = Object.freeze({"0": "None", "1": "Read", "2": "AliasWrite", "4": "Execute"});
const Bits = Object.freeze({ None: BitsForward.None, [BitsForward.None]: BitsReverse[BitsForward.None], Read: BitsForward.Read, [BitsForward.Read]: BitsReverse[BitsForward.Read], Write: BitsForward.Write, [BitsForward.Write]: BitsReverse[BitsForward.Write], Execute: BitsForward.Execute, [BitsForward.Execute]: BitsReverse[BitsForward.Execute], AliasWrite: BitsForward.AliasWrite });
type Bits = 0 | 1 | 2 | 4;
const log: unknown[] = [];
function change(value: Bits | number, add: Bits, remove: Bits): number {
  const combined = value | add, tested = combined & remove; log.push("combine", value, add, combined, "test", remove, tested);
  if (tested === 0) log.push("absent"); else log.push("present");
  const cleared = combined & ~remove; log.push("clear", cleared); return cleared;
}
listing(Bits, ["0", "1", "2", "4", "None", "Read", "Write", "Execute", "AliasWrite"], ["None", "Read", "AliasWrite", "Execute", 0, 1, 2, 4, 2]);
const rows: [number, Bits, Bits, number, number, number, string | undefined][] = [[0, Bits.None, Bits.None, 0, 0, 0, "None"], [0, Bits.Read, Bits.Write, 1, 0, 1, "Read"], [1, Bits.Write, Bits.Read, 3, 1, 2, "AliasWrite"], [2, Bits.Execute, Bits.Write, 6, 2, 4, "Execute"], [4, Bits.AliasWrite, Bits.Execute, 6, 4, 2, "AliasWrite"], [7, Bits.None, Bits.AliasWrite, 7, 2, 5, undefined], [9, Bits.Write, Bits.Execute, 11, 0, 11, undefined], [-1, Bits.None, Bits.Read, -1, 1, -2, undefined], [2147483648, Bits.Read, Bits.Write, -2147483647, 0, -2147483647, undefined], [NaN, Bits.Execute, Bits.None, 4, 0, 4, "Execute"], [-0, Bits.None, Bits.None, 0, 0, 0, "None"], [Infinity, Bits.Execute, Bits.None, 4, 0, 4, "Execute"]];
for (const [input, add, remove, combined, tested, cleared, reverse] of rows) {
  log.length = 0; const result: number = change(input, add, remove); same(result, cleared); same(BitsReverse[result], reverse);
  exact(log, ["combine", input, add, combined, "test", remove, tested, tested === 0 ? "absent" : "present", "clear", cleared]);
}
