/*---
description: "Control for parameters-earlier-parameter-defaults; expand the pattern into ordered reads."
features: [ts-destructuring-routes, ts-destructuring-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-default-parameters, ts-optional-properties, ts-accessors]
---*/
// Explicit reads replace the pattern; the same values, effects and assertions hold. { first, second } is a typed optional object argument; node evaluates its defaults left to right from seed and then first.
type ParameterValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: ParameterValue[] = [-0, 0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ParameterInput = { first?: ParameterValue; second?: ParameterValue };
type ParameterResult = { first: ParameterValue; second: ParameterValue };
for (const input of inputs) for (const mode of [0, 1, 2]) {
  const log: unknown[] = [], emptyInput: ParameterInput = {};
  function choose(key: string, value: ParameterValue): ParameterValue { log.push(key, value); return value; }
  function empty(): ParameterInput { log.push("argument", emptyInput); return emptyInput; }
  const supplied: ParameterInput = { get first() { log.push("get:first", input); return input; }, get second() { log.push("get:second", undefined); return undefined; } };
  function read(seed: ParameterValue, source: ParameterInput = empty()): ParameterResult {
    const firstRead = source.first, first = firstRead === undefined ? choose("default:first", seed) : firstRead;
    const secondRead = source.second, second = secondRead === undefined ? choose("default:second", first) : secondRead;
    log.push("body", first, second); return { first, second };
  }
  const result = mode === 0 ? read(input) : mode === 1 ? read(input, undefined) : read(input, supplied);
  same(result.first, input); same(result.second, input);
  const expected: unknown[] = mode < 2 ? ["argument", emptyInput, "default:first", input] : ["get:first", input];
  if (mode === 2 && input === undefined) expected.push("default:first", input);
  if (mode === 2) expected.push("get:second", undefined);
  expected.push("default:second", input, "body", input, input); assert.compareArray(log, expected);
}
