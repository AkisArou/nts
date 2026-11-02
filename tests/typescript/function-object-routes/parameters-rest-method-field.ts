/*---
description: Class and literal methods reached through an interface field preserve their receiver, fixed value and independent rest arrays.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-rest-parameters, ts-tuples, ts-spread]
---*/
// An interface field carries methods with variable rest tails; node preserves the receiver and separates each tail from its source array.
type ParamValue = number | string | boolean | null | undefined | { mark: number };

type ParamInput = [ParamValue, ...ParamValue[]];
interface ParamResult { self: ParamTarget; fixed: ParamValue; tail: ParamValue[]; }
interface ParamTarget { mark: number; read(first: ParamValue, ...tail: ParamValue[]): ParamResult; }
interface ParamHolder { target: ParamTarget; }
class ParamReader implements ParamTarget { mark: number = 41; read(first: ParamValue, ...tail: ParamValue[]): ParamResult { return { self: this, fixed: first, tail }; } }
const literal: ParamTarget = { mark: 73, read(first: ParamValue, ...tail: ParamValue[]): ParamResult { return { self: this, fixed: first, tail }; } };
const targets: ParamTarget[] = [new ParamReader(), literal];
function invoke(holder: ParamHolder, input: ParamInput): ParamResult { return holder.target.read(...input); }
const identity = { mark: 23 }; const rows: { input: ParamInput; tail: ParamValue[] }[] = [
  { input: [identity], tail: [] }, { input: [-0, NaN, undefined], tail: [NaN, undefined] }, { input: [null, "tail", identity], tail: ["tail", identity] }
];
for (const target of targets) for (const row of rows) {
  const input: ParamInput = [row.input[0], ...row.input.slice(1)], holder: ParamHolder = { target };
  const original = input.slice(), first = invoke(holder, input), second = invoke(holder, input);
  assert.sameValue(first.self, target); assert.sameValue(second.self, target);
  assert.sameValue(first.fixed, row.input[0]); assert.sameValue(second.fixed, row.input[0]);
  assert.compareArray(first.tail, row.tail); assert.compareArray(second.tail, row.tail); assert.sameValue(first.tail === second.tail, false);
  first.tail.push("private"); assert.compareArray(first.tail, [...row.tail, "private"]); assert.compareArray(second.tail, row.tail); assert.compareArray(input, original);
  input[0] = "changed fixed"; input[1] = "changed tail";
  assert.compareArray(input, ["changed fixed", "changed tail", ...original.slice(2)]);
  assert.sameValue(second.fixed, row.input[0]); assert.compareArray(second.tail, row.tail);
}
