/*---
description: "Control for member-indexed-interface-return; A generic keyof lookup returns the exact enum-member type declared for each interface field."
features: [ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-literal-members, ts-interfaces, ts-generics, ts-generic-constraints, ts-keyof, ts-indexed-access, ts-literal-types, ts-unions, ts-intersections, ts-type-aliases]
---*/
// Two interface layouts are read through one generic indexed-access return; node logs the selected field and retains empty, negative and wide member values plus their alias. The control uses frozen forward values and literal types, plus explicit reverse entries where observed.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const IndexedMember = Object.freeze({ Empty: "", Negative: -1, High: 4294967297, Alias: 4294967297 }); type IndexedMember = "" | -1 | 4294967297;
interface MemberTable { empty: ""; low: -1; high: 4294967297; alias: 4294967297; }
function select<K extends keyof MemberTable>(table: MemberTable, key: K, log: unknown[]): MemberTable[K] { const value = table[key]; log.push("read", key, value, typeof value); return value; }
const wide: MemberTable & { padding: number } = { padding: 7, alias: IndexedMember.Alias, high: IndexedMember.High, low: IndexedMember.Negative, empty: IndexedMember.Empty };
const tables: MemberTable[] = [{ empty: IndexedMember.Empty, low: IndexedMember.Negative, high: IndexedMember.High, alias: IndexedMember.Alias }, wide];
const keys: (keyof MemberTable)[] = ["empty", "low", "high", "alias"], expected: (number | string)[] = ["", -1, 4294967297, 4294967297];
for (const table of tables) {
  const log: unknown[] = [], results: (number | string)[] = [], expectedLog: unknown[] = [];
  for (let at = 0; at < keys.length; at++) { const value = select(table, keys[at], log); same(value, expected[at]); results.push(value); expectedLog.push("read", keys[at], expected[at], typeof expected[at]); }
  exact(results, expected);
  const empty: "" = select(table, "empty", log), high: 4294967297 = select(table, "high", log); same(empty, ""); same(high, 4294967297);
  expectedLog.push("read", "empty", "", "string", "read", "high", 4294967297, "number"); exact(log, expectedLog);
}
