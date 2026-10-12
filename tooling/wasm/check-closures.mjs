import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const loader = pathToFileURL(path.join(artifact, 'node.mjs'));
const { instantiate, WasmInputDecline } = await import(loader);
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
const bytes = await readFile(path.join(artifact, 'program.wasm'));
const wasm = await instantiate(bytes, manifest);
let cases = 0;
function same(actual, expected, name) { assert.ok(Object.is(actual, expected), `${name}: ${String(actual)} != ${String(expected)}`); cases++; }
const classes = manifest.exports.map(e => e.name).filter(n => n.startsWith('call_')).map(n => Number(n.split('_')[1])).sort((a, b) => a - b);
const ids = [...new Set(classes)]; assert.equal(ids.length, 2);
const numbers = [NaN, Infinity, -Infinity, -0, 0, 1, -1, 0.5, 2 ** 30, Number.MIN_VALUE, Number.MAX_VALUE, ...Array.from({length: 20}, (_, i) => i - 10)];
for (const capture of numbers) for (const arg of numbers) {
  for (const [at, classId] of ids.entries()) for (const erased of [false, true]) for (const slot of [5, 6]) {
    const expected = at === 0 ? slot === 5 ? capture + arg : capture * arg : slot === 5 ? capture - arg : capture / arg;
    same(wasm[`call_${classId}_${erased}_${slot}`](capture, arg), expected, `closure ${classId} ${slot}`);
  }
  same(wasm.merged(true, capture, arg), capture + arg, 'first sibling through common base');
  same(wasm.merged(false, capture, arg), capture - arg, 'second sibling through common base');
}
for (const n of numbers) same(wasm.staticCall(n), 2 * n, 'static call');
same(wasm.namedIdentity(), true, 'named singleton identity'); same(wasm.freshIdentity(), false, 'fresh arrow identity');
same(wasm.functionTag(), 4, 'function runtime tag');
for (const s of ['', 'abc', '😀', '\ud800', '\udfff', 'a\ud800b']) same(wasm.capturedString(s), s, 'captured primitive string');
same(wasm.global(), 17, 'static closure prefix leaves program globals in place');
assert.throws(() => wasm.nullCall(1), e => e instanceof WasmInputDecline && e.message.includes('nullCall'));
const fresh = await import(`${loader.href}?function-references-disabled`);
const compile = WebAssembly.compile;
let capability_refusal = false;
try {
  WebAssembly.compile = (input, options) => {
    if (input.length < 100 && input.includes(210) && input.includes(20)) throw new WebAssembly.CompileError('function references disabled');
    return compile(input, options);
  };
  await assert.rejects(fresh.instantiate(bytes, manifest), error => {
    capability_refusal = error.code === 'NTS5001' && String(error).includes('function-references');
    return capability_refusal;
  });
} finally { WebAssembly.compile = compile; }
console.log(JSON.stringify({cases, named_declines: 1, separate_slots: [5, 6], sibling_capture_types: 2, immutable_static_identity: true, capability_refusal}));
