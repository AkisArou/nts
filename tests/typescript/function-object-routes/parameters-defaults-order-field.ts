/*---
description: An interface-held function evaluates only needed defaults from left to right before its body.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-default-parameters, ts-tuples, ts-null-undefined]
---*/
// An interface field carries three defaulted forms; node initializes only undefined slots in left-to-right order.
type ParamValue = number | null | undefined;
type ParamInput = [ParamValue?, ParamValue?, ParamValue?];
let events: string[] = [];
function initialize(label: string, value: ParamValue): ParamValue { events.push(label); return value; }
type ParamReader = (first?: ParamValue, second?: ParamValue, third?: ParamValue) => ParamValue[];
interface ParamHolder { reader: ParamReader; }
function declared(first = initialize("first", 11), second = initialize("second", 22), third = initialize("third", 33)): ParamValue[] { events.push("body"); return [first, second, third]; }
const expression = function (first = initialize("first", 11), second = initialize("second", 22), third = initialize("third", 33)): ParamValue[] { events.push("body"); return [first, second, third]; };
const literal = { read(first = initialize("first", 11), second = initialize("second", 22), third = initialize("third", 33)): ParamValue[] { events.push("body"); return [first, second, third]; } };
const readers: ParamReader[] = [declared, expression, literal.read];
function invoke(holder: ParamHolder, input: ParamInput): ParamValue[] { return holder.reader(...input); }
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
