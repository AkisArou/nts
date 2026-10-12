import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const url = pathToFileURL(path.join(artifact, 'node.mjs'));
const { instantiate, WasmInputDecline } = await import(url);
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
const bytes = await readFile(path.join(artifact, 'program.wasm'));
const wasm = await instantiate(bytes, manifest);
let cases = 0;
for (const s of ['', '\0', 'abc', 'é世', '😀', '\ud800', '\udfff', 'a\ud800b']) {
  assert.equal(wasm.identity(s), s); cases++;
}
for (const value of [null, undefined, 1, false, {}, [], new String('x')]) {
  assert.throws(() => wasm.identity(value), error => error instanceof WasmInputDecline); cases++;
}
for (const value of [NaN, Infinity, -Infinity, -0, 0, 5, -5, 0.5]) {
  assert.ok(Object.is(wasm.remainder(value, 2), value % 2)); cases++;
}
for (const mutate of [
  m => { m.imports[0].params[0] = { kind: 'i32' }; },
  m => { m.imports[0].result = { kind: 'f32' }; },
  m => { m.imports[0].module = 'unknown'; },
  m => { m.imports.push(structuredClone(m.imports[0])); },
  m => { m.builtins.push({ module: 'wasm:js-string', name: 'length', kind: 'function', params: [{ kind: 'i32' }], result: { kind: 'i32' } }); },
]) {
  const altered = structuredClone(manifest); mutate(altered);
  await assert.rejects(instantiate(bytes, altered), error => error instanceof TypeError || error instanceof WebAssembly.LinkError); cases++;
}
const probe = Uint8Array.from([0,97,115,109,1,0,0,0,1,6,1,96,1,111,1,127,2,25,1,14,119,97,115,109,58,106,115,45,115,116,114,105,110,103,6,108,101,110,103,116,104,0,0,7,9,1,5,112,114,111,98,101,0,0]);
const stringManifest = { abi: 2, host: 'js', imports: [], constants: [], features: [], functions: [], globals: [], init: null,
  builtins: [{ module: 'wasm:js-string', name: 'length', kind: 'function', params: [{ kind: 'externref', nullable: true }], result: { kind: 'i32' } }],
  exports: [{ name: 'probe', params: [{ ty: { kind: 'string' }, guard: null }], result: { kind: 'int', bits: 32, signed: true } }],
};
const strings = await instantiate(probe, stringManifest);
for (const s of ['', 'abc', '😀', '\ud800x', '\0世']) { assert.equal(strings.probe(s), s.length); cases++; }
const omittedBuiltin = structuredClone(stringManifest);
omittedBuiltin.builtins = [];
await assert.rejects(instantiate(probe, omittedBuiltin), WebAssembly.LinkError); cases++;
// Fresh loader state; ignoring the compile option must fail the probe instead
// of silently importing a JavaScript replacement for the builtin.
const fresh = await import(`${url.href}?ignored-options`);
const compile = WebAssembly.compile;
let ignoredOptionsRefused = false;
try {
  WebAssembly.compile = input => compile(input);
  await assert.rejects(fresh.instantiate(probe, stringManifest), error => {
    ignoredOptionsRefused = error.code === 'NTS5001' && String(error).includes('js-string');
    return ignoredOptionsRefused;
  }); cases++;
} finally { WebAssembly.compile = compile; }
console.log(JSON.stringify({ cases, ignoredOptionsRefused }));
