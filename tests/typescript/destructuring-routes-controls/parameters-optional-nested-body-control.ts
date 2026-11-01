/*---
description: "Control for parameters-optional-nested-body; expand the pattern into ordered reads."
features: [ts-destructuring-routes, ts-destructuring-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-optional-parameters, ts-optional-properties, ts-accessors]
---*/
// Explicit reads replace the pattern; the same values, effects and assertions hold. An optional outer parameter is normalized before a nested typed object pattern; node preserves supplied falsy values and default dependencies.
type ParameterValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: ParameterValue[] = [-0, 0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ParameterInner = { value?: ParameterValue; tail: ParameterValue };
type ParameterOuter = { inner?: ParameterInner };
type ParameterResult = { value: ParameterValue; tail: ParameterValue };
for (const input of inputs) for (const mode of [0, 1, 2, 3]) {
  const log: unknown[] = [], emptyOuter: ParameterOuter = {}, emptyInner: ParameterInner = { tail: marker };
  function outerDefault(): ParameterOuter { log.push("default:outer", emptyOuter); return emptyOuter; }
  function innerDefault(): ParameterInner { log.push("default:inner", emptyInner); return emptyInner; }
  function valueDefault(): ParameterValue { log.push("default:value", input); return input; }
  const inner: ParameterInner = { get value() { log.push("get:value", input); return input; }, get tail() { log.push("get:tail", marker); return marker; } };
  const source: ParameterOuter = { get inner() { const value = mode === 3 ? undefined : inner; log.push("get:inner", value); return value; } };
  function read(source?: ParameterOuter): ParameterResult {
    const outer = source === undefined ? outerDefault() : source, innerRead = outer.inner;
    const selected = innerRead === undefined ? innerDefault() : innerRead, valueRead = selected.value;
    const value = valueRead === undefined ? valueDefault() : valueRead, tail = selected.tail;
    log.push("body", value, tail); return { value, tail };
  }
  const result = mode === 0 ? read() : mode === 1 ? read(undefined) : read(source);
  same(result.value, input); same(result.tail, marker);
  const expected: unknown[] = mode < 2 ? ["default:outer", emptyOuter] : ["get:inner", mode === 3 ? undefined : inner];
  if (mode !== 2) expected.push("default:inner", emptyInner, "default:value", input);
  else { expected.push("get:value", input); if (input === undefined) expected.push("default:value", input); expected.push("get:tail", marker); }
  expected.push("body", input, marker); assert.compareArray(log, expected);
}
