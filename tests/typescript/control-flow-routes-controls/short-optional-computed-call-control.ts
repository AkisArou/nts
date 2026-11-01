/*---
description: Control for short-optional-computed-call; An optional computed method call retains its typed receiver after the key replaces the active receiver.
features: [ts-control-flow-routes, ts-control-flow-route-short-circuit, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-expressions, ts-tuples, ts-closures, ts-interfaces, ts-function-types, ts-this-parameter, ts-this, ts-computed-keys, ts-literal-types]
---*/
// Two optional boundaries decide on a nullable ShortHost and nullable typed method; node skips key or argument as needed and calls the original receiver after key retargeting. The control spells the tested evaluation out in ordered steps.
type ShortValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: [ShortValue, boolean, boolean][] = [[0, false, false], [-0, false, false], [NaN, false, false], ["", false, false], [undefined, false, true], [null, false, true], [false, false, false], [marker, true, false], [7, true, false], ["go", true, false], [true, true, false], [replacement, true, false]];
type OptionalMode = "base-null" | "base-undefined" | "method-null" | "method-undefined" | "live";
type ShortMethod = (this: ShortHost, argument: ShortValue) => ShortValue;
interface ShortHost { tag: ShortValue; read: ShortMethod | null | undefined }
const modes: OptionalMode[] = ["base-null", "base-undefined", "method-null", "method-undefined", "live"];
function inspect(input: ShortValue, mode: OptionalMode): void {
  const log: unknown[] = [];
  function read(this: ShortHost, argument: ShortValue): ShortValue { log.push("call", this.tag, argument); return this.tag; }
  const original: ShortHost = { tag: input, read }, other: ShortHost = { tag: marker, read }; let active = original;
  if (mode === "method-null") original.read = null; else if (mode === "method-undefined") original.read = undefined;
  let sourceValue: ShortHost | null | undefined = original;
  if (mode === "base-null") sourceValue = null; else if (mode === "base-undefined") sourceValue = undefined;
  function source(): ShortHost | null | undefined { log.push("base", sourceValue); return sourceValue; }
  function key(): "read" { log.push("key", input); active = other; return "read"; }
  function argument(): ShortValue { log.push("argument", active.tag); return active.tag; }
  let actual: ShortValue = undefined; const receiver = source();
  if (receiver !== null) if (receiver !== undefined) { const method = receiver[key()];
    if (method !== null) if (method !== undefined) actual = method.call(receiver, argument());
  }
  const expectedLog: unknown[] = ["base", sourceValue]; let expected: ShortValue = undefined, expectedActive = original;
  if (mode !== "base-null") if (mode !== "base-undefined") { expectedLog.push("key", input); expectedActive = other; }
  if (mode === "live") { expected = input; expectedLog.push("argument", marker, "call", input, marker); }
  same(actual, expected); same(active, expectedActive); same(original.tag, input); same(other.tag, marker); assert.compareArray(log, expectedLog);
}
for (const row of rows) for (const mode of modes) inspect(row[0], mode);
