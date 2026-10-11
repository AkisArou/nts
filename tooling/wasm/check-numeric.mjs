import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
const wasm = await instantiate(await readFile(path.join(artifact, 'program.wasm')), manifest);
let cases = 0;
function same(name, args, expected) { assert.ok(Object.is(wasm[name](...args), expected), `${name}(${args}) expected ${expected}`); cases++; }
for (const value of [0, 1, 2147483647, 2147483648, 4294967295]) {
  same('u32Float', [value], value); same('u32Wide', [value], value);
  for (const other of [0, 2147483647, 2147483648, 4294967295]) {
    same('minU32', [value, other], Math.min(value, other)); same('maxU32', [value, other], Math.max(value, other));
    same('ltU32', [value, other], value < other); same('gtU32', [value, other], value > other);
  }
}
for (const value of [-2147483648, -1, 0, 1, 2147483647]) {
  same('i32Float', [value], value); same('absI32', [value], Math.abs(value));
  same('negI32', [value], -value);
}
for (const value of [Number.MIN_SAFE_INTEGER, -(2 ** 32), 0, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
  same('i64Float', [value], value);
  for (const other of [Number.MIN_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER]) same('maxI64', [value, other], Math.max(value, other));
  if (value >= 0) for (const other of [0, 2 ** 32, Number.MAX_SAFE_INTEGER]) same('minU64', [value, other], Math.min(value, other));
}
for (const bits of [8, 16, 32]) for (const signed of [true, false]) {
  const name = `floatTo${signed ? 'i' : 'u'}${bits}`, limit = 2 ** (bits - Number(signed));
  for (const value of [signed ? -limit : 0, 0, 1, limit - 1]) same(name, [value], value);
}
for (const value of [0, 0.5, 1.1, 20.9999, 99.9999, 100]) same('floorInt', [value], Math.floor(value));
for (const [name, values] of [
  ['I32', [1, 7, 2147483647]], ['U32', [1, 2147483648, 4294967295]],
  ['I64', [1, 2 ** 32, Number.MAX_SAFE_INTEGER]], ['U64', [1, 2 ** 32, Number.MAX_SAFE_INTEGER]],
]) {
  const signed = name[0] === 'I';
  for (const value of values) same(`div${name}`, [value, signed ? -1 : 1], value / (signed ? -1 : 1));
  for (const value of signed ? [-5, -4] : [0, ...values]) same(`rem${name}`, [value, 3], value % 3);
}
console.log(JSON.stringify({ cases, imports: manifest.imports, functions: manifest.functions.length }));
