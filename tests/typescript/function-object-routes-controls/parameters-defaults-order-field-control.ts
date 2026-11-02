/*---
description: Explicit parameter-list control for an interface-held function evaluates only needed defaults from left to right before its body.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-default-parameters, ts-tuples, ts-null-undefined]
---*/
// Interface-held functions initialize explicit slots in order, then enter the body.
type ParamValue = number | null | undefined;
type ParamInput = [ParamValue?, ParamValue?, ParamValue?];
let events: string[] = [];
function initialize(label: string, value: ParamValue): ParamValue { events.push(label); return value; }
type ParamReader = (input: ParamInput) => ParamValue[];
interface ParamHolder { reader: ParamReader; }
function prepare(input: ParamInput): ParamValue[] { const first = input[0] === undefined ? initialize("first", 11) : input[0], second = input[1] === undefined ? initialize("second", 22) : input[1], third = input[2] === undefined ? initialize("third", 33) : input[2]; events.push("body"); return [first, second, third]; }
function declared(input: ParamInput): ParamValue[] { return prepare(input); }
const expression = function (input: ParamInput): ParamValue[] { return prepare(input); };
const literal = { read(input: ParamInput): ParamValue[] { return prepare(input); } };
const readers: ParamReader[] = [declared, expression, literal.read];
function invoke(holder: ParamHolder, input: ParamInput): ParamValue[] { return holder.reader(input); }
const rows: { input: ParamInput; expected: ParamValue[]; events: string[] }[] = [
  { input: [], expected: [11, 22, 33], events: ["first", "second", "third", "body"] },
  { input: [null], expected: [null, 22, 33], events: ["second", "third", "body"] },
  { input: [5, null], expected: [5, null, 33], events: ["third", "body"] },
  { input: [undefined, 7, undefined], expected: [11, 7, 33], events: ["first", "third", "body"] },
  { input: [-0, NaN, 9], expected: [-0, NaN, 9], events: ["body"] }
];
for (const reader of readers) for (const row of rows) {
  events = []; const holder: ParamHolder = { reader }, actual = invoke(holder, row.input);
  assert.compareArray(actual, row.expected); assert.compareArray(events, row.events);
}
