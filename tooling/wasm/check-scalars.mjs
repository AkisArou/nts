// Exact same-source scalar comparison, including NaN and the sign of zero.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [artifact, source] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.wasm.json'), 'utf8'));
const wasm = instantiate();
const js = await import(pathToFileURL(source));
let cases = 0;
function compare(name, args) {
  const expected = js[name](...args), actual = wasm[name](...args);
  assert.ok(Object.is(actual, expected), `${name}(${args.map(String)}): wasm ${String(actual)}, JS ${String(expected)}`);
  cases++;
}
const edge = [NaN, -Infinity, Infinity, -0, 0, -0.5, 0.5, 0.49999999999999994, -0.5000000000000001,
  -2147483649, 2147483648, 4294967295, 4294967296, 4294967297, 2 ** 53, -(2 ** 53), 1e308, -1e308, Number.MIN_VALUE, -Number.MIN_VALUE];
// Bit-pattern sampling covers the full exponent range rather than only
// uniformly distributed small numbers; the seed makes failures repeatable.
const buffer = new ArrayBuffer(8), bits = new DataView(buffer);
let random = 0x9e3779b9;
for (let i = 0; i < 1024; i++) {
  for (const offset of [0, 4]) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    bits.setUint32(offset, random, true);
  }
  edge.push(bits.getFloat64(0, true));
}
for (const n of edge) {
  for (const name of ['rounded', 'integer', 'unsigned', 'truth', 'not', 'negative', 'absolute', 'floored', 'ceiling', 'truncated', 'squareRoot']) compare(name, [n]);
  compare('unsignedRemainder', [n]);
  for (const count of [-33, -1, 0, 1, 31, 32, 33, NaN, Infinity]) {
    for (const name of ['shift', 'leftShift', 'rightShift']) compare(name, [n, count]);
  }
  for (const b of [0, -0, 3, -3, Infinity, NaN, 1e-300]) {
    for (const name of ['remainder', 'minimum', 'maximum', 'add', 'subtract', 'multiply', 'divide', 'and', 'or', 'xor', 'lt', 'le', 'gt', 'ge', 'eq', 'ne', 'integralRemainder']) compare(name, [n, b]);
  }
}
for (const n of [-5, 0, 1, 2, 3, 8, 13, 20]) {
  for (const name of ['nested', 'multipleExits', 'diamond', 'recursive']) compare(name, [n]);
  for (const flag of [false, true]) compare('choose', [flag, n, -n]);
  compare('advance', [n]);
  assert.ok(Object.is(wasm.current, js.current), 'exported global is a live binding'); cases++;
}
assert.ok(manifest.functions.every(f => f.route === 'structured'), 'reducible source never uses dispatch');
console.log(JSON.stringify({ cases, functions: manifest.functions.length, imports: manifest.imports,
  routes: manifest.functions.map(f => ({ name: f.name, route: f.route, edges: f.edges })) }));
