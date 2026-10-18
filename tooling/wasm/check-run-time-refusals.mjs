// The run-time refusals: a non-positive input answers itself, a positive one
// is refused by name, with the function and the lowering's reason.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
for (const [name, why] of [['refused', 'a thenable no job can call'], ['assertionFailed', 'an input outside the asserted representation']]) {
  assert.equal(wasm[name](-2), -2); cases++;
  assert.equal(wasm[name](0), 0); cases++;
  const kind = name === 'refused' ? 'compiler-stop' : undefined;
  assert.throws(() => wasm[name](1), e => e instanceof WasmInputDecline && e.code === 'NTS5001' && e.kind === kind && e.reason === why && e.message.includes(name) && e.message.includes(why), name);
  cases++;
}
console.log(JSON.stringify({ cases }));
