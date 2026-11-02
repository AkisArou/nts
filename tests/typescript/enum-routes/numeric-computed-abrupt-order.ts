/*---
description: "A throwing enum initializer stops later members and propagates the exact error through a typed function route."
features: [ts-enum-routes, ts-enum-route-numeric, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-readonly, ts-numbers, ts-strings, ts-enum-computed, ts-literal-types, ts-type-aliases, ts-unions, ts-closures, ts-errors, ts-tuples, ts-enum, ts-enum-reverse-mapping]
---*/
// A literal stage selects which computed member throws; node preserves the error identity, skips later initializers and reads, and fills the result only after all members initialize.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type Stage = "First" | "Next" | "Last" | "none";
function inspect(stage: Stage, seed: number, names: string[]): void {
  const log: unknown[] = [], failure = new RangeError(stage); let result: number[] = [];
  function init(name: string, value: number): number { log.push(name, value); if (stage === name) throw failure; return value; }
  function build(): void {
    try {
      enum Local { First = init("First", seed), Next = init("Next", seed + 1), Last = init("Last", seed + 2) }
      const members: Local[] = [Local.First, Local.Next, Local.Last]; for (const value of members) log.push("read", value, Local[value]); result = members;
    } catch (error) { same(error, failure); log.push("caught", error); throw error; }
  }
  const expected: unknown[] = []; for (let index = 0; index < names.length; index++) expected.push(names[index], seed + index);
  if (stage === "none") { build(); exact(result, [seed, seed + 1, seed + 2]); expected.push("read", seed, "First", "read", seed + 1, "Next", "read", seed + 2, "Last"); }
  else { assert.throws(RangeError, build); exact(result, []); expected.push("caught", failure); }
  exact(log, expected);
}
const rows: [Stage, string[]][] = [["First", ["First"]], ["Next", ["First", "Next"]], ["Last", ["First", "Next", "Last"]], ["none", ["First", "Next", "Last"]]];
for (const [stage, names] of rows) for (const seed of [-2, 0, 0.5, 7]) inspect(stage, seed, names);
