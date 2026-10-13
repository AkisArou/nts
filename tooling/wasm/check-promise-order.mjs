// The promise-order fixture against node: each export runs its synchronous
// part and returns; then `read` sees the order the queued tasks ran in. In
// node that is after the turn's microtasks; in Wasm the export's own return is
// the checkpoint, so `read` follows at once.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
const [artifact, source] = process.argv.slice(2);
const oracle = await import(pathToFileURL(source));
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
for (const name of Object.keys(oracle).filter(name => name !== 'read')) {
  for (const n of [-1, 0, 1, 2]) {
    const syncNode = oracle[name](n);
    await turn();
    const afterNode = oracle.read(0);
    const syncWasm = wasm[name](n);
    const afterWasm = wasm.read(0);
    assert.ok(Object.is(syncWasm, syncNode), `${name}(${n}) before the checkpoint: ${syncWasm} != ${syncNode}`);
    assert.ok(Object.is(afterWasm, afterNode), `${name}(${n}) after the checkpoint: ${afterWasm} != ${afterNode}`);
    cases += 2;
  }
}
console.log(JSON.stringify({ cases }));
