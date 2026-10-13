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
refuses(() => wasm.spliceUndefined(1), 'spliceUndefined', 'an erased value read as a number, which it is not');
refuses(() => wasm.joinUndefined(1), 'joinUndefined', 'a null separator, which may stand for undefined or for null');
refuses(() => wasm.optionalSeparator(1), 'joined', 'a null separator, which may stand for undefined or for null');
assert.equal(wasm.optionalSeparator(0), 3);
refuses(() => wasm.shiftNull(1), 'shiftNull', 'a null reference where the type says none is absent');
console.log(JSON.stringify({ causes }));
