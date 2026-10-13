import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.wasm.json'), 'utf8'));
const wasm = instantiate();
let cases = 0;
function same(actual, expected, name) { assert.ok(Object.is(actual, expected), `${name}: ${String(actual)} != ${String(expected)}`); cases++; }
for (const created of [1, 2, 3, 10, 11]) for (const tested of [1, 2, 3, 10, 11]) for (const erased of [0, 1]) {
  same(wasm[`is_${created}_${tested}_${erased}`](), created === tested || created === 3 && tested === 1, `nominal ${created} ${tested} ${erased}`);
}
for (const erased of [0, 1]) for (const identical of [0, 1]) same(wasm[`eq_${erased}_${identical}`](), Boolean(identical), `eq ${erased} ${identical}`);
const numbers = [NaN, Infinity, -Infinity, -0, 0, 1, -1, 0.5, 2 ** 30, Number.MIN_VALUE, Number.MAX_VALUE];
for (let n = -20; n <= 20; n++) numbers.push(n);
for (const n of numbers) for (const name of ['numberField', 'next', 'erasedField']) same(wasm[name](n), n, `${name} ${String(n)}`);
for (const s of ['', 'abc', '😀', '\ud800', '\udfff', 'a\ud800b']) same(wasm.stringField(s), s, `string ${s}`);
for (let n = -128; n <= 127; n++) same(wasm.signed8(n), n, `i8 ${n}`);
for (const n of [0, 1, 255, 256, 32767, 32768, 65535]) same(wasm.unsigned16(n), n, `u16 ${n}`);
for (let n = 0; n < 100; n++) same(wasm.swap(n, 13, -7), n % 2 ? -7 : 13, `swap ${n}`);
same(wasm.projection(), true, 'subtype projection'); same(wasm.objectTag(), 6, 'object tag');
same(wasm.objectTruthy(), true, 'object truthiness'); same(wasm.defaultNumber(), 0, 'number default');
same(wasm.defaultErased(), 0, 'erased default is undefined'); same(wasm.global(), 17, 'global offset');
same(wasm.mergedAlias(), false, 'merged layout cast preserves B identity');
// Two layouts of equal storage are two types: every object type shares one rec
// group, so projecting a B as an A is refused by name. In separate groups the
// engine made them one type and the cast passed silently.
assert.throws(() => wasm.canonicalAlias(), e => e instanceof WasmInputDecline && e.message.includes('an erased value read as an object of a type it is not'));
cases++;
assert.throws(() => wasm.reorderedAlias(), e => e instanceof WasmInputDecline && e.message.includes('an erased value read as an object of a type it is not'));
cases++;
same(wasm.nullProjection(), 7, 'projected null retains absence');
same(wasm.undefinedProjection(), 0, 'projected undefined retains absence');
for (const n of numbers) same(wasm.numberIsA(n), false, 'numeric instanceof');
for (const b of [false, true]) same(wasm.booleanIsA(b), false, 'boolean instanceof');
for (const s of ['', 'a', '\ud800']) same(wasm.stringIsA(s), false, 'string instanceof');
same(wasm.nullIsA(), false, 'null instanceof'); same(wasm.undefinedIsA(), false, 'undefined instanceof');
let named_declines = 0;
for (const [name, args] of [['nullField', []], ['badProjection', [1]], ['badProjection', [NaN]]]) {
  assert.throws(() => wasm[name](...args), error => error instanceof WasmInputDecline && error.message.includes(name));
  named_declines++;
}
console.log(JSON.stringify({ cases, named_declines, nominal_checks: 50, two_classes_one_layout: [1, 2], distinct_equal_storage: [10, 11], physical_alias_cast_checked: true }));
