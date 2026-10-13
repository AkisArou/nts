// Each refusal in the refusal-causes fixture names its function and its cause.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate, WasmInputDecline } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let causes = 0;
function refuses(call, name, cause) {
  assert.throws(call, e => e instanceof WasmInputDecline && e.message === `NTS5001: wasm operation in ${name}: ${cause}`);
  causes++;
}
// Three of the four now answer: the lowering reads an undefined splice count
// as the method does and gives an absent `join` separator its comma, so
// nothing reaches Wasm that it has to refuse. node's answers.
assert.equal(wasm.spliceUndefined(1), 3);
assert.equal(wasm.joinUndefined(1), 3);
assert.equal(wasm.optionalSeparator(1), 3);
assert.equal(wasm.optionalSeparator(0), 3);
refuses(() => wasm.shiftNull(1), 'shiftNull', 'a null reference where the type says none is absent');
console.log(JSON.stringify({ causes }));
