/*---
description: Explicit parameter-list control for a passed function stops later initialization and its body when a default throws, but supplied first values skip that failure.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-default-parameters, ts-tuples, ts-errors, ts-null-undefined]
---*/
// A typed function parameter carries ordered explicit checks; a thrown initializer prevents all later work.
type ParamValue = number | null | undefined;
type ParamInput = [ParamValue?, ParamValue?];
let events: string[] = []; let fail = false;
function initialize(label: string, value: ParamValue): ParamValue { events.push(label); if (fail && label === "first") throw new TypeError("first default"); return value; }
type ParamReader = (input: ParamInput) => ParamValue[];
function declared(input: ParamInput): ParamValue[] { const first = input[0] === undefined ? initialize("first", 11) : input[0], second = input[1] === undefined ? initialize("second", 22) : input[1]; events.push("body"); return [first, second]; }
const expression = function (input: ParamInput): ParamValue[] { const first = input[0] === undefined ? initialize("first", 11) : input[0], second = input[1] === undefined ? initialize("second", 22) : input[1]; events.push("body"); return [first, second]; };
const readers: ParamReader[] = [declared, expression];
function invoke(reader: ParamReader, input: ParamInput): ParamValue[] { return reader(input); }
const rows: { input: ParamInput; fail: boolean; throws: boolean; expected: ParamValue[]; events: string[] }[] = [
  { input: [], fail: false, throws: false, expected: [11, 22], events: ["first", "second", "body"] },
  { input: [], fail: true, throws: true, expected: [], events: ["first"] },
  { input: [undefined, 7], fail: true, throws: true, expected: [], events: ["first"] },
  { input: [5], fail: true, throws: false, expected: [5, 22], events: ["second", "body"] },
  { input: [5, null], fail: true, throws: false, expected: [5, null], events: ["body"] },
  { input: [null, undefined], fail: false, throws: false, expected: [null, 22], events: ["second", "body"] }
];
for (const reader of readers) for (const row of rows) {
  events = []; fail = row.fail;
  if (row.throws) assert.throws(TypeError, () => invoke(reader, row.input));
  else assert.compareArray(invoke(reader, row.input), row.expected);
  assert.compareArray(events, row.events);
}
