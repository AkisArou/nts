// The array-join fixture against node running the same TypeScript.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
function same(name, ...args) { const expected = oracle[name](...args); const actual = wasm[name](...args); assert.ok(Object.is(actual, expected), `${name}(${args.map(a => JSON.stringify(a))}): ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); cases++; }
const texts = ['', 'a', 'bc', '😀', '\ud800', '\udfff', 'a\ud800b'];
const separators = ['', ',', ', ', '\ud800', '😀'];
const numbers = [NaN, Infinity, -Infinity, -0, 0, 1, -1, 0.1, 1e21, 1e-7, 2 ** 53, Number.MIN_VALUE, Number.MAX_VALUE];
for (const sep of separators) {
  same('none', sep);
  for (const a of texts) {
    same('one', a, sep); same('absent', a, sep); same('nulls', a, sep);
    for (const b of texts) same('strings', a, b, sep);
  }
  for (const x of numbers) for (const y of numbers) same('numbers', x, y, sep);
}
for (const a of texts) for (const b of texts) same('defaultSeparator', a, b);
console.log(JSON.stringify({ cases }));
