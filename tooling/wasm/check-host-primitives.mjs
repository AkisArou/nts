import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
const wasm = await instantiate(await readFile(path.join(artifact, 'program.wasm')), manifest);
const inputs = [NaN, -Infinity, Infinity, -0, 0, -1, 1, -0.5, 0.5, -2, 2, 1e-300, 1e300, 2 ** 32 + 1, 2 ** 52 - 1];
const strings = ['', '\0', ' 12.5x', '0x10', 'Infinity', '-Infinity', '1e300', '-0', '0b11', '😀', '\ud800', '  -42  ', '9007199254740993'];
const radices = [NaN, Infinity, -Infinity, -0, 0, 1, 2, 8, 10, 16, 32, 36, 37, 2 ** 32 + 10, -2];
let cases = 0;
function same(actual, expected) { assert.ok(Object.is(actual, expected), `${String(actual)} != ${String(expected)}`); cases++; }
for (const e of manifest.exports) {
  if (!e.name.startsWith('nts_math_')) continue;
  const oracle = Math[e.name.slice('nts_math_'.length)];
  for (const x of inputs) {
    if (e.params.length === 1) same(wasm[e.name](x), oracle(x));
    else for (const y of inputs) same(wasm[e.name](x, y), oracle(x, y));
  }
}
for (const x of inputs) same(wasm.nts_number_to_string(x), x.toString());
for (const s of strings) {
  same(wasm.nts_parse_float(s), Number.parseFloat(s));
  for (const radix of radices) same(wasm.nts_parse_int(s, radix), Number.parseInt(s, radix));
}
const cos = Math.cos, toString = Number.prototype.toString, parseFloat = Number.parseFloat, parseInt = Number.parseInt;
try {
  Math.cos = () => 999; Number.prototype.toString = () => 'tampered';
  Number.parseFloat = () => 999; Number.parseInt = () => 999;
  same(wasm.nts_math_cos(1), cos(1)); same(wasm.nts_number_to_string(-0), Reflect.apply(toString, -0, []));
  same(wasm.nts_parse_float('12.5x'), parseFloat('12.5x')); same(wasm.nts_parse_int('ff', 16), parseInt('ff', 16));
} finally {
  Math.cos = cos; Number.prototype.toString = toString;
  Number.parseFloat = parseFloat; Number.parseInt = parseInt;
}
console.log(JSON.stringify({ cases, services: manifest.imports.length }));
