/*---
description: "Explicit-object control: A local computed enum initializes once per call and retained closures read its members without rerunning initializers."
features: [ts-enum-routes, ts-enum-route-numeric, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-readonly, ts-numbers, ts-strings, ts-closures, ts-function-types, ts-objects, ts-type-aliases, ts-record, ts-unions]
---*/
// Local derives a member, its successor and an alias from each typed seed; node logs initialization before closure reads and preserves both returned numeric snapshots. The control uses frozen forward members and a separate explicit reverse map.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: readonly unknown[], expected: readonly unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
function make(seed: number): () => number[] {
  function init(name: string, value: number): number { log.push("init", name, value); return value; }
  type Local = number;
  const firstValue = init("First", seed), nextValue = init("Next", firstValue + 1), aliasValue = init("Alias", firstValue);
  const Local = Object.freeze({ First: firstValue, Next: nextValue, Alias: aliasValue });
  const LocalReverse: Record<number, string | undefined> = {}; LocalReverse[firstValue] = "First"; LocalReverse[nextValue] = "Next"; LocalReverse[aliasValue] = "Alias"; Object.freeze(LocalReverse);
  return function read(): number[] {
    const members: Local[] = [Local.First, Local.Next, Local.Alias], result: number[] = [];
    for (const value of members) { log.push("read", value, LocalReverse[value]); result.push(value); }
    return result;
  };
}
for (const seed of [0, 1, -2, 0.5, 31]) {
  log.length = 0; const reader: () => number[] = make(seed); const initialization: unknown[] = ["init", "First", seed, "init", "Next", seed + 1, "init", "Alias", seed]; exact(log, initialization);
  const first = reader(), second = reader(); exact(first, [seed, seed + 1, seed]); exact(second, [seed, seed + 1, seed]); same(Object.is(first, second), false);
  const expected = initialization.slice(); for (const repeat of [0, 1]) { expected.push("read", seed, "Alias", "read", seed + 1, "Next", "read", seed, "Alias"); same(repeat < 2, true); }
  exact(log, expected);
}
