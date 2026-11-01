/*---
description: Control for replacers-space-string; use a plain literal at the tested route.
features: [ts-json-routes, ts-json-replacers, ts-interfaces, ts-objects, ts-tuples, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-null-undefined]
---*/
// Remove only the formatting interface annotation; the plain literal retains the value and string spacing.
interface JsonFormatting { value: { outer: { n: number }; tail: boolean }; space: string; }
const rows: [string, string][] = [["", ""], ["\t", "\t"], ["abcdefghijk", "abcdefghij"], ["123456789\ud83d\ude00x", "123456789\ud83d"]];
let n = -2;
for (const [space, gap] of rows) {
  n++;
  const options = { value: { outer: { n }, tail: true }, space };
  const expected = gap === "" ? '{"outer":{"n":' + n + '},"tail":true}' :
    '{\n' + gap + '"outer": {\n' + gap + gap + '"n": ' + n + '\n' + gap + '},\n' + gap + '"tail": true\n}';
  assert.sameValue(JSON.stringify(options.value, undefined, options.space), expected);
}
