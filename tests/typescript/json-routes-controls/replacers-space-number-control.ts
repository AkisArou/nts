/*---
description: Control for replacers-space-number; use a plain literal at the tested route.
features: [ts-json-routes, ts-json-replacers, ts-interfaces, ts-objects, ts-tuples, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-null-undefined]
---*/
// Remove only the formatting interface annotation; the plain literal retains the value and numeric spacing.
interface JsonFormatting { value: { outer: { n: number }; tail: boolean }; space: number; }
const rows: [number, string][] = [[-2, ""], [0, ""], [2.9, "  "], [10, "          "], [20, "          "], [NaN, ""], [Infinity, "          "]];
let n = -3;
for (const [space, gap] of rows) {
  n++;
  const options = { value: { outer: { n }, tail: true }, space };
  const expected = gap === "" ? '{"outer":{"n":' + n + '},"tail":true}' :
    '{\n' + gap + '"outer": {\n' + gap + gap + '"n": ' + n + '\n' + gap + '},\n' + gap + '"tail": true\n}';
  assert.sameValue(JSON.stringify(options.value, undefined, options.space), expected);
}
