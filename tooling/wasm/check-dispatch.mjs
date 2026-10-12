import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
const wasm = await instantiate(await readFile(path.join(artifact, 'program.wasm')), manifest);
let cases = 0;
function same(actual, expected, name) { assert.ok(Object.is(actual, expected), `${name}: ${String(actual)} != ${String(expected)}`); cases++; }
const numbers = [NaN, Infinity, -Infinity, -0, 0, 1, -1, 0.5, 2 ** 30, Number.MIN_VALUE, Number.MAX_VALUE, ...Array.from({length: 20}, (_, i) => i - 10)];
const names = Object.keys(wasm).filter(n => n.startsWith('call_'));
for (const name of names) {
  const [, id, slot] = name.split('_').map((s, i) => i ? Number(s) : s);
  for (const capture of numbers) for (const arg of numbers) {
    let expected;
    if (id === 10) expected = slot === 2 ? capture + arg : capture * arg;
    else if (id === 11) expected = slot === 2 ? capture - arg : capture * arg;
    else if (id === 12) expected = slot === 2 ? capture * arg : capture / arg;
    else if (id === 14) expected = slot === 2 ? capture / arg : capture - arg;
    else throw new Error(`unclassified class ${id}`);
    same(wasm[name](capture, arg), expected, name);
  }
}
for (const n of numbers) same(wasm.nominal(n), false, 'equal physical storage preserves Other identity');
for (const n of numbers) same(wasm.covariant(n), n, 'covariant returned object retains its fields');
same(wasm.covariantIdentity(), true, 'covariant result retains identity');
same(wasm.covariantClass(), true, 'covariant result retains Child descriptor');
assert.throws(() => wasm.nullCall(1), e => e instanceof WasmInputDecline && e.message.includes('nullCall'));
console.log(JSON.stringify({cases, named_declines: 1, class_shapes: 4, slots: [2, 3, 4], inherited_entry_checked: true, nominal_equal_storage_checked: true, covariant_identity_checked: true}));
