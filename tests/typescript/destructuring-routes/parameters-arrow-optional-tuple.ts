/*---
description: "A typed arrow parameter binds a readonly optional tuple with a whole-argument default and an earlier-binding default."
features: [ts-destructuring-routes, ts-destructuring-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-destructuring, ts-function-types, ts-arrow-functions, ts-optional-parameters, ts-default-parameters, ts-tuples, ts-tuple-optional, ts-readonly]
---*/
// A readonly optional tuple reaches an arrow parameter; node runs whole-argument and slot defaults lazily and second can read first.
type ParameterValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: ParameterValue[] = [-0, 0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ParameterTuple = readonly [ParameterValue?, ParameterValue?];
type ParameterResult = { first: ParameterValue; second: ParameterValue };
for (const input of inputs) for (const mode of [0, 1, 2]) {
  const log: unknown[] = [], emptyTuple: ParameterTuple = [];
  function empty(): ParameterTuple { log.push("argument", emptyTuple); return emptyTuple; }
  function choose(key: string, value: ParameterValue): ParameterValue { log.push(key, value); return value; }
  const read: (source?: ParameterTuple) => ParameterResult = ([first = choose("default:first", input), second = choose("default:second", first)]: ParameterTuple = empty()) => {
    log.push("body", first, second); return { first, second };
  };
  const source: ParameterTuple = mode === 1 ? [undefined, input] : [input, undefined];
  const result = mode === 0 ? read() : read(source); same(result.first, input); same(result.second, input);
  const expected: unknown[] = mode === 0 ? ["argument", emptyTuple] : [];
  if (mode < 2 || input === undefined) expected.push("default:first", input);
  if (mode !== 1 || input === undefined) expected.push("default:second", input);
  expected.push("body", input, input); assert.compareArray(log, expected);
}
