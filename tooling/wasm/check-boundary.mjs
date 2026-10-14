import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.wasm.json'), 'utf8'));
const wasm = instantiate();
let cases = 0;
assert.equal(wasm.returnsUndefined(), undefined); cases++;
function same(name, value) { assert.ok(Object.is(wasm[name](value), value), `${name} ${value}`); cases++; }
function decline(name, ...args) { assert.throws(() => wasm[name](...args), e => e instanceof WasmInputDecline && e.code === 'NTS5001'); cases++; }
for (const v of [false, true]) same('boolean', v);
for (const v of [0, 1, '', null, undefined]) decline('boolean', v);
for (const name of ['f32', 'renamed']) {
  for (const v of [NaN, -Infinity, Infinity, -0, 0, -1, 1, Math.fround(0.1)]) same(name, v);
  for (const v of [null, true, '1', 1n]) decline(name, v);
}
decline('f32', 0.1); same('renamed', 0.1);
assert.equal(Object.hasOwn(wasm, 'f64'), false, 'published alias is authoritative'); cases++;
for (const bits of [8, 16, 32, 64]) {
  for (const signed of [true, false]) {
    const name = `${signed ? 'i' : 'u'}${bits}`, limit = 2 ** (bits - Number(signed));
    const minimum = signed ? -limit : 0;
    for (const v of [0, 1, ...(signed ? [-1] : []), bits === 64 ? Number.MAX_SAFE_INTEGER : limit - 1, bits === 64 ? (signed ? Number.MIN_SAFE_INTEGER : 0) : minimum]) same(name, v);
    for (const v of [NaN, Infinity, -0, 1.5, limit, minimum - 1, '1', true, 1n]) decline(name, v);
    if (bits === 64) decline(name, Number.MAX_SAFE_INTEGER + 1);
  }
}
for (const v of [1, 2, 3]) same('known', v);
for (const v of [0, 4, 127]) decline('known', v);
same('infinityOnly', Infinity);
for (const v of [0, 1, NaN, -Infinity]) decline('infinityOnly', v);
decline('tooLarge');
// A defaulted parameter is required at the boundary: the host cannot run the
// initializer the core inlines at each compiled call, so omitting it is
// refused by name rather than given an invented value.
same('defaulted', 2.5); same('defaulted', -0);
assert.throws(() => wasm.defaulted(), e => e instanceof WasmInputDecline && e.message.includes('defaulted parameter')); cases++;
// A missing argument is undefined, outside the declared type; an extra one is
// ignored, as node ignores it.
decline('i32'); assert.equal(wasm.i32(1, 2), 1); cases++;
console.log(JSON.stringify({ cases, exports: Object.keys(wasm).length }));
