import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [artifact, source] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
const js = await import(pathToFileURL(source));
const indices = [NaN, Infinity, -Infinity, -0, 0, 1, 2, 3, -1,
  0.5, -0.5, 1.5, Number.MIN_VALUE, -Number.MIN_VALUE,
  2 ** 30 - 1, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1,
  2 ** 32, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, -Number.MAX_VALUE];
const values = [NaN, Infinity, -Infinity, -0, 0, 1, -1, 0.5,
  2 ** 31, 2 ** 32 + 1, Number.MIN_VALUE, Number.MAX_VALUE];
let cases = 0, refused = 0;
function same(name, ...args) {
  assert(Object.is(wasm[name](...args), js[name](...args)), `${name}(${args.map(String)})`);
  cases++;
}
function refusal(name, reason, ...args) {
  assert.throws(() => wasm[name](...args), e => e instanceof WasmInputDecline && e.message.includes(reason), `${name}(${args.map(String)}) must refuse, never trap or silently truncate`);
  refused++;
}
for (const at of indices) {
  same('optionalAt', at);
  same('convertedAt', at);
  same('integerBits', at);
  if (Number.isInteger(at) && at >= 0 && at < 3) same('readAt', at);
  else refusal('readAt', 'an index past the end', at);
  for (const value of values) {
    if (Number.isInteger(at) && at >= 0 && at <= 3) {
      same('writeAt', at, value);
      same('writeLength', at, value);
    } else {
      // JS accepts non-index properties and holes. This lane refuses those
      // writes by name; spending the successful guard must preserve that.
      refusal('writeAt', 'a write past the end', at, value);
      refusal('writeLength', 'a write past the end', at, value);
    }
    // Bytes are deliberately outside the checked GC conversion's scope.
    if (Number.isInteger(at) && at >= 0 && at < 3) same('byteBacked', at, value);
    else refusal('byteBacked', 'a typed-array index outside the view', at, value);
  }
}
for (const value of values) same('integerBits', value);
console.log(JSON.stringify({ cases, refused }));
