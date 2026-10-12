import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
const wasm = await instantiate(await readFile(path.join(artifact, 'program.wasm')), manifest);
let cases = 0;
function same(actual, expected, context) {
  assert.ok(Object.is(actual, expected), `${context}: ${String(actual)} != ${String(expected)}`); cases++;
}
const numbers = [NaN, Infinity, -Infinity, -0, 0, 1, -1, 0.5, -0.5,
  2 ** 30 - 1, 2 ** 30, -(2 ** 30), -(2 ** 30) - 1, 2 ** 31, 2 ** 32,
  2 ** 53, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE];
for (let n = -20; n <= 20; n++) numbers.push(n);
const values = { number: numbers, boolean: [false, true], string: ['', '0', '1', 'true', 'abc', 'é世', '😀', '\ud800', '\udfff', 'a\ud800b'], null: [null], undefined: [undefined] };
const typed = kind => !['null', 'undefined'].includes(kind);
for (const [left, as] of Object.entries(values)) for (const [right, bs] of Object.entries(values)) {
  const suffix = `${left}_${right}`;
  for (const a of as) for (const b of bs) {
    const args = [...(typed(left) ? [a] : []), ...(typed(right) ? [b] : [])];
    for (const prefix of ['eq', 'ne', 'external', ...(typed(right) ? ['typed', 'helper'] : []),
      ...(['number', 'boolean'].includes(right) ? ['alias'] : []), ...(typed(left) ? ['swap'] : [])]) {
      same(wasm[`${prefix}_${suffix}`](...args), prefix === 'ne' ? a !== b : a === b, `${prefix}_${suffix} ${String(a)} ${String(b)}`);
    }
  }
}
for (const [kind, vs] of Object.entries(values)) for (const v of vs) {
  for (const prefix of ['truthy', 'not', 'convert', 'truthyHelper', 'truthyAlias']) {
    same(wasm[`${prefix}_${kind}`](...(typed(kind) ? [v] : [])), prefix === 'not' ? !v : Boolean(v), `${prefix}_${kind} ${String(v)}`);
  }
}
for (const kind of ['null', 'undefined']) {
  same(wasm[`nullableTruthy_${kind}`](), false, `nullable ${kind}`);
  same(wasm[`nullableNot_${kind}`](), true, `nullable !${kind}`);
}
for (const n of numbers) same(wasm.externalNumber(n), n, `external number ${String(n)}`);
for (const b of [false, true]) same(wasm.externalBoolean(b), b, `external bool ${b}`);
console.log(JSON.stringify({ cases, exports: Object.keys(wasm).length }));
