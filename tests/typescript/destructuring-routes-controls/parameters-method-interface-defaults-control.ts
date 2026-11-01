/*---
description: "Control for parameters-method-interface-defaults; expand the pattern into ordered reads."
features: [ts-destructuring-routes, ts-destructuring-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-class, ts-class-fields, ts-interfaces, ts-optional-properties, ts-accessors]
---*/
// Explicit reads replace the pattern; the same values, effects and assertions hold. An interface method parameter binds { value, mirror }; node resolves receiver-dependent defaults before the body and preserves earlier bindings.
type ParameterValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: ParameterValue[] = [-0, 0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ParameterInput = { value?: ParameterValue; mirror?: ParameterValue };
type ParameterResult = { value: ParameterValue; mirror: ParameterValue };
interface ParameterReader { read(source: ParameterInput): ParameterResult; }
class ParameterReaderImpl implements ParameterReader {
  seed: ParameterValue; log: unknown[];
  constructor(seed: ParameterValue, log: unknown[]) { this.seed = seed; this.log = log; }
  choose(key: string, value: ParameterValue): ParameterValue { this.log.push(key, value); return value; }
  read(source: ParameterInput): ParameterResult {
    const valueRead = source.value, value = valueRead === undefined ? this.choose("default:value", this.seed) : valueRead;
    const mirrorRead = source.mirror, mirror = mirrorRead === undefined ? this.choose("default:mirror", value) : mirrorRead;
    this.log.push("body", value, mirror); return { value, mirror };
  }
}
for (const input of inputs) {
  const log: unknown[] = [], source: ParameterInput = { get value() { log.push("get:value", input); return input; }, get mirror() { log.push("get:mirror", undefined); return undefined; } };
  const reader: ParameterReader = new ParameterReaderImpl(replacement, log), result = reader.read(source), wanted = input === undefined ? replacement : input;
  same(result.value, wanted); same(result.mirror, wanted); const expected: unknown[] = ["get:value", input];
  if (input === undefined) expected.push("default:value", replacement);
  expected.push("get:mirror", undefined, "default:mirror", wanted, "body", wanted, wanted); assert.compareArray(log, expected);
}
