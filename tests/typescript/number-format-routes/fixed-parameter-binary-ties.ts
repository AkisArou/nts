/*---
description: toFixed breaks exact binary ties toward the larger magnitude at every digit count from zero through twenty.
features: [ts-number-format-routes, ts-number-format-route-fixed-notation, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator]
---*/
// Binary halves cross number parameters; the log records operands and toFixed text, and node chooses the larger integer on ties.
const rows: [number, number | undefined, string][] = [
  [0.5, 0, "1"], [-0.5, 0, "-1"], [0.25, 1, "0.3"], [-0.25, 1, "-0.3"], [0.125, 2, "0.13"], [-0.125, 2, "-0.13"], [0.0625, 3, "0.063"], [-0.0625, 3, "-0.063"], [0.03125, 4, "0.0313"],
  [-0.03125, 4, "-0.0313"], [0.015625, 5, "0.01563"], [-0.015625, 5, "-0.01563"], [0.0078125, 6, "0.007813"], [-0.0078125, 6, "-0.007813"], [0.00390625, 7, "0.0039063"],
  [-0.00390625, 7, "-0.0039063"], [0.001953125, 8, "0.00195313"], [-0.001953125, 8, "-0.00195313"], [0.0009765625, 9, "0.000976563"], [-0.0009765625, 9, "-0.000976563"],
  [0.00048828125, 10, "0.0004882813"], [-0.00048828125, 10, "-0.0004882813"], [0.000244140625, 11, "0.00024414063"], [-0.000244140625, 11, "-0.00024414063"],
  [0.0001220703125, 12, "0.000122070313"], [-0.0001220703125, 12, "-0.000122070313"], [6.103515625e-05, 13, "0.0000610351563"], [-6.103515625e-05, 13, "-0.0000610351563"],
  [3.0517578125e-05, 14, "0.00003051757813"], [-3.0517578125e-05, 14, "-0.00003051757813"], [1.52587890625e-05, 15, "0.000015258789063"], [-1.52587890625e-05, 15, "-0.000015258789063"],
  [7.62939453125e-06, 16, "0.0000076293945313"], [-7.62939453125e-06, 16, "-0.0000076293945313"], [3.814697265625e-06, 17, "0.00000381469726563"],
  [-3.814697265625e-06, 17, "-0.00000381469726563"], [1.9073486328125e-06, 18, "0.000001907348632813"], [-1.9073486328125e-06, 18, "-0.000001907348632813"],
  [9.5367431640625e-07, 19, "0.0000009536743164063"], [-9.5367431640625e-07, 19, "-0.0000009536743164063"], [4.76837158203125e-07, 20, "0.00000047683715820313"],
  [-4.76837158203125e-07, 20, "-0.00000047683715820313"],
];
const seen: (number | string | undefined)[] = [], expectedLog: (number | string | undefined)[] = [];
function format(index: number, value: number, digits: number | undefined): string {

  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, "number");
  assert.sameValue(Object.is(digits, rows[index][1]), true); assert.sameValue(typeof digits, typeof rows[index][1]);
  seen.push(value, digits);
  const result: string = value.toFixed(digits);
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const result = format(index, row[0], row[1]); assert.sameValue(result, row[2]); assert.sameValue(typeof result, "string");
  expectedLog.push(row[0], row[1], row[2]);
}
assert.compareArray(seen, expectedLog);
