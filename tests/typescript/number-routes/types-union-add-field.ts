/*---
description: Narrowing a number-or-string field keeps arithmetic and concatenation distinct at numeric boundaries.
features: [ts-number-route-types, ts-numbers, ts-unions, ts-narrowing, ts-interfaces]
---*/
// Route: a number-or-string field is narrowed before addition; node gives the fixed values, signs and text below.
interface NumberOrTextField { value: number | string; }
const numberSamples = [
  { input: 0, inputText: "0", inputInverse: Infinity, inputInverseText: "Infinity", numeric: 2, numericText: "2", numericInverse: 0.5, numericInverseText: "0.5", textual: "02" },
  { input: -0, inputText: "0", inputInverse: -Infinity, inputInverseText: "-Infinity", numeric: 2, numericText: "2", numericInverse: 0.5, numericInverseText: "0.5", textual: "02" },
  { input: 1, inputText: "1", inputInverse: 1, inputInverseText: "1", numeric: 3, numericText: "3", numericInverse: 0.3333333333333333, numericInverseText: "0.3333333333333333", textual: "12" },
  { input: 7, inputText: "7", inputInverse: 0.14285714285714285, inputInverseText: "0.14285714285714285", numeric: 9, numericText: "9", numericInverse: 0.1111111111111111, numericInverseText: "0.1111111111111111", textual: "72" },
  { input: -7, inputText: "-7", inputInverse: -0.14285714285714285, inputInverseText: "-0.14285714285714285", numeric: -5, numericText: "-5", numericInverse: -0.2, numericInverseText: "-0.2", textual: "-72" },
  { input: 2147483647, inputText: "2147483647", inputInverse: 4.656612875245797e-10, inputInverseText: "4.656612875245797e-10", numeric: 2147483649, numericText: "2147483649", numericInverse: 4.656612870908988e-10, numericInverseText: "4.656612870908988e-10", textual: "21474836472" },
  { input: 2147483648, inputText: "2147483648", inputInverse: 4.656612873077393e-10, inputInverseText: "4.656612873077393e-10", numeric: 2147483650, numericText: "2147483650", numericInverse: 4.656612868740584e-10, numericInverseText: "4.656612868740584e-10", textual: "21474836482" },
  { input: 4294967296, inputText: "4294967296", inputInverse: 2.3283064365386963e-10, inputInverseText: "2.3283064365386963e-10", numeric: 4294967298, numericText: "4294967298", numericInverse: 2.328306435454494e-10, numericInverseText: "2.328306435454494e-10", textual: "42949672962" },
  { input: 9007199254740992, inputText: "9007199254740992", inputInverse: 1.1102230246251565e-16, inputInverseText: "1.1102230246251565e-16", numeric: 9007199254740994, numericText: "9007199254740994", numericInverse: 1.1102230246251563e-16, numericInverseText: "1.1102230246251563e-16", textual: "90071992547409922" },
  { input: 9007199254740994, inputText: "9007199254740994", inputInverse: 1.1102230246251563e-16, inputInverseText: "1.1102230246251563e-16", numeric: 9007199254740996, numericText: "9007199254740996", numericInverse: 1.110223024625156e-16, numericInverseText: "1.110223024625156e-16", textual: "90071992547409942" },
  { input: 1.25, inputText: "1.25", inputInverse: 0.8, inputInverseText: "0.8", numeric: 3.25, numericText: "3.25", numericInverse: 0.3076923076923077, numericInverseText: "0.3076923076923077", textual: "1.252" },
  { input: NaN, inputText: "NaN", inputInverse: NaN, inputInverseText: "NaN", numeric: NaN, numericText: "NaN", numericInverse: NaN, numericInverseText: "NaN", textual: "NaN2" },
  { input: Infinity, inputText: "Infinity", inputInverse: 0, inputInverseText: "0", numeric: Infinity, numericText: "Infinity", numericInverse: 0, numericInverseText: "0", textual: "Infinity2" },
  { input: -Infinity, inputText: "-Infinity", inputInverse: -0, inputInverseText: "0", numeric: -Infinity, numericText: "-Infinity", numericInverse: -0, numericInverseText: "0", textual: "-Infinity2" },
  { input: -2, inputText: "-2", inputInverse: -0.5, inputInverseText: "-0.5", numeric: 0, numericText: "0", numericInverse: Infinity, numericInverseText: "Infinity", textual: "-22" },
];
for (const row of numberSamples) for (const textual of [false, true]) {
  const holder: NumberOrTextField = { value: 0 }; holder.value = textual ? row.inputText : row.input;
  const observed: number | string = holder.value;
  const actual: number | string = typeof observed === "string" ? observed + 2 : observed + 2;
  assert.sameValue(Object.is(observed, textual ? row.inputText : row.input), true);
  assert.sameValue(typeof observed, textual ? "string" : "number"); assert.sameValue(String(observed), row.inputText);
  if (typeof observed === "number" && observed === 0) {
    assert.sameValue(Object.is(1 / observed, row.inputInverse), true); assert.sameValue(typeof (1 / observed), "number"); assert.sameValue(String(1 / observed), row.inputInverseText);
  }
  assert.sameValue(Object.is(actual, textual ? row.textual : row.numeric), true);
  assert.sameValue(typeof actual, textual ? "string" : "number"); assert.sameValue(String(actual), textual ? row.textual : row.numericText);
  if (typeof actual === "number" && actual === 0) {
    assert.sameValue(Object.is(1 / actual, row.numericInverse), true); assert.sameValue(typeof (1 / actual), "number"); assert.sameValue(String(1 / actual), row.numericInverseText);
  }
}
