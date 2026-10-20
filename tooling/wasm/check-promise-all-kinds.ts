// The promise-all-kinds fixture against node: every export of the source,
// awaited on both sides over a small pool, answers the same.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact, source] = process.argv.slice(2) as [string, string];
const oracle = (await import(pathToFileURL(source).href)) as Record<string, (n: number) => Promise<unknown>>;
const { instantiate } = (await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')).href)) as {
  instantiate(): Record<string, (n: number) => Promise<unknown>>;
};
const wasm = instantiate();
let cases = 0;
for (const name of Object.keys(oracle)) {
  for (const n of [-1, 0, 1, 2, 3]) {
    const expected = await oracle[name]!(n);
    const actual = await wasm[name]!(n);
    assert.ok(Object.is(actual, expected), `${name}(${n}): ${actual} != ${expected}`);
    cases += 1;
  }
}
console.log(JSON.stringify({ cases }));
