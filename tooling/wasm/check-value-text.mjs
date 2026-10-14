// The value-text fixture against node: `String(v)` of every erased tag, a
// boolean's text, a plain object's, an object whose printing the core
// refuses, refused by name, and arrays', typed arrays' and runtime objects'.
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
same(wasm.anObject(1), oracle.anObject(1), 'anObject');
assert.throws(() => wasm.anObjectWithItsOwnText(1), e => e instanceof WasmInputDecline && e.message.includes('String() of an object or a function'));
cases++;
same(wasm.containerCount(), oracle.containerCount(), 'containerCount');
for (let i = 0; i < oracle.containerCount(); i++) {
  same(wasm.containerText(i), oracle.containerText(i), `containerText(${i})`);
  same(wasm.containerInTemplate(i), oracle.containerInTemplate(i), `containerInTemplate(${i})`);
}
for (const n of [0, 1, 2.5]) {
  same(wasm.selfJoined(n), oracle.selfJoined(n), `selfJoined(${n})`);
  same(wasm.nestedCycle(n), oracle.nestedCycle(n), `nestedCycle(${n})`);
  same(wasm.sharedNotCyclic(n), oracle.sharedNotCyclic(n), `sharedNotCyclic(${n})`);
}
same(wasm.nestedDeep(64), oracle.nestedDeep(64), 'nestedDeep(64)');
assert.throws(() => wasm.nestedDeep(65), e => e instanceof WasmInputDecline && e.message.includes('nested more than 64 deep'));
cases++;
// The refusal left a join unfinished; the next call starts with none.
same(wasm.selfJoined(3), oracle.selfJoined(3), 'selfJoined(3) after a refusal');
console.log(JSON.stringify({ cases }));
