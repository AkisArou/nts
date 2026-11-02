/*---
description: "Member-typed equality comparisons equate named aliases while keeping numeric and textual members distinct."
features: [ts-enum-computed, ts-enum-routes, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-readonly, ts-enum-route-literal-members, ts-enum, ts-enum-string, ts-type-aliases, ts-unions, ts-literal-types, ts-narrowing, ts-expressions]
---*/
// Every pair of member-typed operands crosses one comparison function; node logs equality and inequality without widening the operands away from their member union.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
enum EqualMember { Zero = 0, Alias = Zero, Text = "0", TextAlias = Text, One = 1, Empty = "" }
type ComparableMember = EqualMember.Zero | EqualMember.Alias | EqualMember.Text | EqualMember.TextAlias | EqualMember.One | EqualMember.Empty;
function compare(left: ComparableMember, right: ComparableMember, log: unknown[]): boolean {
  const unequal = left !== right, identical = Object.is(left, right);
  if (left === right) { log.push("equal", left, typeof left, right, typeof right, unequal, identical); return true; }
  log.push("different", left, typeof left, right, typeof right, unequal, identical); return false;
}
const inputs: ComparableMember[] = [EqualMember.Zero, EqualMember.Alias, EqualMember.Text, EqualMember.TextAlias, EqualMember.One, EqualMember.Empty], raw: (number | string)[] = [0, 0, "0", "0", 1, ""];
const truth = ["TTFFFF", "TTFFFF", "FFTTFF", "FFTTFF", "FFFFTF", "FFFFFT"];
const log: unknown[] = [], expectedLog: unknown[] = [], results: boolean[] = [], expectedResults: boolean[] = [];
for (let left = 0; left < inputs.length; left++) for (let right = 0; right < inputs.length; right++) {
  same(inputs[left], raw[left]); same(inputs[right], raw[right]); const expected = truth[left][right] === "T";
  const result = compare(inputs[left], inputs[right], log); same(result, expected); results.push(result); expectedResults.push(expected);
  expectedLog.push(expected ? "equal" : "different", raw[left], typeof raw[left], raw[right], typeof raw[right], !expected, expected);
}
exact(results, expectedResults); exact(log, expectedLog);
