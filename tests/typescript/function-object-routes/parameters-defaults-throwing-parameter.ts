/*---
description: A passed function stops later initialization and its body when a default throws, but supplied first values skip that failure.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-default-parameters, ts-tuples, ts-errors, ts-null-undefined]
---*/
// A typed function parameter carries a throwing first default; node stops before later defaults and the body, or skips it when supplied.
type ParamValue = number | null | undefined;
type ParamInput = [ParamValue?, ParamValue?];
let events: string[] = []; let fail = false;
function initialize(label: string, value: ParamValue): ParamValue { events.push(label); if (fail && label === "first") throw new TypeError("first default"); return value; }
type ParamReader = (first?: ParamValue, second?: ParamValue) => ParamValue[];
function declared(first = initialize("first", 11), second = initialize("second", 22)): ParamValue[] { events.push("body"); return [first, second]; }
const expression = function (first = initialize("first", 11), second = initialize("second", 22)): ParamValue[] { events.push("body"); return [first, second]; };
const readers: ParamReader[] = [declared, expression];
function invoke(reader: ParamReader, input: ParamInput): ParamValue[] { return reader(...input); }
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
