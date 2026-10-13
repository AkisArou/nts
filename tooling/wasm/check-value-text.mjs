// The value-text fixture against node: `String(v)` of every erased tag, a
// boolean's text, and an object refused by name.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
const same = (actual, expected, name) => { assert.ok(Object.is(actual, expected), `${name}: ${actual} != ${expected}`); cases++; };
same(wasm.count(), oracle.count(), 'count');
for (let i = 0; i < oracle.count(); i++) {
  same(wasm.concatenated(i), oracle.concatenated(i), `concatenated(${i})`);
  same(wasm.converted(i), oracle.converted(i), `converted(${i})`);
}
for (const n of [-1, 0, 1]) same(wasm.aBoolean(n), oracle.aBoolean(n), `aBoolean(${n})`);
same(wasm.kindCount(), oracle.kindCount(), 'kindCount');
for (let i = 0; i < oracle.kindCount(); i++) same(wasm.kindOf(i), oracle.kindOf(i), `kindOf(${i})`);
assert.throws(() => wasm.anObject(1), e => e instanceof WasmInputDecline && e.message.includes('String() of an object or a function'));
cases++;
console.log(JSON.stringify({ cases }));
