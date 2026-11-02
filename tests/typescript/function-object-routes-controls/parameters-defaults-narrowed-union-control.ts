/*---
description: Explicit parameter-list control for a function narrowed from a union defaults only undefined and preserves every other primitive or object identity.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-unions, ts-narrowing, ts-default-parameters, ts-objects, ts-null-undefined, ts-errors]
---*/
// A typeof-narrowed callback performs an explicit undefined check and retains every other input unchanged.
type ParamValue = number | string | boolean | null | undefined | { mark: number };

const fallback = { mark: 91 }; let initialized = 0;
function initialize(): ParamValue { initialized++; return fallback; }
type ParamReader = (value: ParamValue) => ParamValue;
function declared(value: ParamValue): ParamValue { return value === undefined ? initialize() : value; }
const expression = function (value: ParamValue): ParamValue { return value === undefined ? initialize() : value; };
function invoke(reader: ParamReader | string, input: ParamValue): ParamValue { if (typeof reader === "function") return reader(input); throw new TypeError("not callable"); }
const readers: (ParamReader | string)[] = [declared, expression];
const identity = { mark: 23 }; const inputs: ParamValue[] = [undefined, null, 0, -0, NaN, false, true, "", "tail", identity];
for (const reader of readers) for (const input of inputs) {
  initialized = 0; const actual = invoke(reader, input), expected = input === undefined ? fallback : input;
  assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected);
  assert.sameValue(initialized, input === undefined ? 1 : 0);
}
assert.throws(TypeError, () => invoke("not callable", undefined));
