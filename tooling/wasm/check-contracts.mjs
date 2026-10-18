import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
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
console.log(JSON.stringify({ named_declines, raw_traps: 0 }));
