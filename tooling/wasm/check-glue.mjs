import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.wasm.json'), 'utf8'));
const program = await import(pathToFileURL(path.join(artifact, 'program.mjs')));
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
let cases = 0;
// program.mjs exports exactly the program's names: nothing of the glue's.
const names = [...manifest.exports.map(e => e.name), ...manifest.globals.map(g => g.name)];
assert.deepEqual(Object.keys(program).sort(), [...names].sort()); cases++;
const fresh = instantiate();
manifest.exports.filter(e => e.name !== 'bump').forEach((e, at) => {
  assert.equal(program[e.name](1), 1 + at, e.name); cases++;
  assert.equal(fresh[e.name](1), 1 + at, e.name); cases++;
});
assert.throws(() => program.default('1'), error => error instanceof WasmInputDecline); cases++;
// The live global follows its writer through the glue's own `sync`, and a
// fresh instance has its own.
assert.equal(program.sync, 1); cases++;
program.bump(5);
assert.equal(program.sync, 5); cases++;
assert.equal(fresh.sync, 1); cases++;
// Redefining the Wasm accessors after load redirects nothing: the glue
// captured Global.prototype.value and Instance.prototype.exports.
const value = Object.getOwnPropertyDescriptor(WebAssembly.Global.prototype, 'value');
const exportsOf = Object.getOwnPropertyDescriptor(WebAssembly.Instance.prototype, 'exports');
try {
  Object.defineProperty(WebAssembly.Global.prototype, 'value', { ...value, get() { return 'tampered'; } });
  Object.defineProperty(WebAssembly.Instance.prototype, 'exports', { ...exportsOf, get() { return { e0: () => 'tampered' }; } });
  program.bump(7);
  assert.equal(program.sync, 7); cases++;
  const tampered = instantiate();
  assert.equal(tampered.sync, 1); cases++;
  assert.equal(tampered.instantiate(1), 1); cases++;
} finally {
  Object.defineProperty(WebAssembly.Global.prototype, 'value', value);
  Object.defineProperty(WebAssembly.Instance.prototype, 'exports', exportsOf);
}
console.log(JSON.stringify({ cases, exports: names.length }));
