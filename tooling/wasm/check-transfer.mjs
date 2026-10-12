import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
// Each call goes through a downcast that must succeed: the object really is
// a `Derived`, and its second field is read through the cast reference.
for (const x of [1.5, -0]) {
  assert.ok(Object.is(wasm.viaResult(x), x), `viaResult ${x}`); cases++;
  assert.ok(Object.is(wasm.viaEdge(x), x), `viaEdge ${x}`); cases++;
}
console.log(JSON.stringify({ cases }));
