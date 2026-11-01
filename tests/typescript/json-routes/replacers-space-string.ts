/*---
description: String spacing held with a value in an interface field uses at most ten UTF-16 code units, even when that splits a surrogate pair.
features: [ts-json-routes, ts-json-replacers, ts-interfaces, ts-objects, ts-tuples, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-null-undefined]
---*/
// Stringify an interface-held value using typed string spacing; node repeats the first ten code units at each nesting level.
interface JsonFormatting { value: { outer: { n: number }; tail: boolean }; space: string; }
const rows: [string, string][] = [["", ""], ["\t", "\t"], ["abcdefghijk", "abcdefghij"], ["123456789\ud83d\ude00x", "123456789\ud83d"]];
let n = -2;
for (const [space, gap] of rows) {
  n++;
  const options: JsonFormatting = { value: { outer: { n }, tail: true }, space };
  const expected = gap === "" ? '{"outer":{"n":' + n + '},"tail":true}' :
    '{\n' + gap + '"outer": {\n' + gap + gap + '"n": ' + n + '\n' + gap + '},\n' + gap + '"tail": true\n}';
  assert.sameValue(JSON.stringify(options.value, undefined, options.space), expected);
}
