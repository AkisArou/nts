/*---
description: Control for chains-optional-method-receiver; make missing values and presence explicit.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces, ts-function-types, ts-this-parameter, ts-this, ts-closures]
---*/
// A required method payload and presence flag select an explicit call with the original receiver; recorded keys model method presence.
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
interface ChainHost { tag: AbsentValue; present: boolean; m: ((this: ChainHost, step: number) => AbsentValue) | null | undefined }
for (const [value, encoded] of samples) for (const mode of [0, 1, 2, 3]) {
  let calls = 0; const seen: number[] = [];
  const run = function(this: ChainHost, step: number): AbsentValue { same(this, host); seen.push(step); return this.tag; };
  const host: ChainHost = { tag: value, present: mode !== 0, m: mode < 2 ? undefined : mode === 2 ? null : run };
  const keys = host.present ? ["tag", "m"] : ["tag"], method = host.present ? host.m : undefined;
  const actual = method === undefined || method === null ? undefined : method.call(host, ++calls);
  same(actual, mode === 3 ? value : undefined); same(calls, mode === 3 ? 1 : 0); same(host.tag, value);
  assert.compareArray(seen, mode === 3 ? [1] : []);
  same(keys.includes("m"), mode !== 0); same(host.present, mode !== 0);
  assert.compareArray(keys, mode === 0 ? ["tag"] : ["tag", "m"]);
  const fields = value === undefined ? "" : '"tag":' + encoded;
  const actualFields = host.tag === undefined ? "" : '"tag":' + JSON.stringify(host.tag);
  const json = '{' + actualFields + (host.present && host.m === null ? (actualFields ? ',' : '') + '"m":null' : '') + '}';
  same(json, '{' + fields + (mode === 2 ? (fields ? ',' : '') + '"m":null' : '') + '}');
}
