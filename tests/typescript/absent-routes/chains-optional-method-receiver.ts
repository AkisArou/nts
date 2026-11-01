/*---
description: An optional method call preserves its typed receiver and suppresses arguments for missing methods.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces, ts-function-types, ts-this-parameter, ts-this, ts-closures, ts-optional-properties, ts-optional-chaining]
---*/
// An optional method is absent, undefined, null or callable; node retains the host as this and returns its exact tag only when called.
type AbsentValue = number | string | boolean | null | undefined | { tag: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const point = { tag: "point" };
const samples: [AbsentValue, string, boolean, boolean][] = [
  [undefined, "null", true, true], [null, "null", true, true], [0, "0", false, true], [-0, "0", false, true],
  ["", '""', false, true], [NaN, "null", false, true], [false, "false", false, true],
  [point, '{"tag":"point"}', false, false], [7, "7", false, false], ["live", '"live"', false, false], [true, "true", false, false]
];
interface ChainHost { tag: AbsentValue; m?: ((this: ChainHost, step: number) => AbsentValue) | null }
for (const [value, encoded] of samples) for (const mode of [0, 1, 2, 3]) {
  let calls = 0; const seen: number[] = [];
  const run = function(this: ChainHost, step: number): AbsentValue { same(this, host); seen.push(step); return this.tag; };
  const host: ChainHost = mode === 0 ? { tag: value } : { tag: value, m: mode === 1 ? undefined : mode === 2 ? null : run };
  const actual = host.m?.(++calls);
  same(actual, mode === 3 ? value : undefined); same(calls, mode === 3 ? 1 : 0); same(host.tag, value);
  assert.compareArray(seen, mode === 3 ? [1] : []);
  same("m" in host, mode !== 0); same(Object.hasOwn(host, "m"), mode !== 0);
  assert.compareArray(Object.keys(host), mode === 0 ? ["tag"] : ["tag", "m"]);
  const fields = value === undefined ? "" : '"tag":' + encoded;
  same(JSON.stringify(host), '{' + fields + (mode === 2 ? (fields ? ',' : '') + '"m":null' : '') + '}');
}
