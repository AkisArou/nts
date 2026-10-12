import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.wasm.json'), 'utf8'));
const wasm = instantiate();
let named_declines = 0;
for (const [name, args] of [
  ['numberFromString', ['123']], ['booleanFromNumber', [1]], ['stringFromBoolean', [true]],
  ['numberHelperFromBoolean', [false]], ['booleanHelperFromNumber', [0]],
  ['nullLength', []], ['undefinedLength', []], ['nullCharAt', []],
]) {
  assert.throws(() => wasm[name](...args), error => error instanceof WasmInputDecline
    && error.code === 'NTS5001' && error.message.includes(name) && !(error instanceof WebAssembly.RuntimeError));
  named_declines++;
}
for (const index of [-1, 0.5, NaN, Infinity, -Infinity, 1, 2 ** 32]) {
  assert.throws(() => wasm.unit('a', index), error => error instanceof WasmInputDecline
    && error.message.includes('unit'));
  named_declines++;
}
assert.equal(wasm.unit('😀', 0), 0xd83d);
assert.equal(wasm.unit('😀', 1), 0xde00);
console.log(JSON.stringify({ named_declines, valid_units: 2, raw_traps: 0 }));
