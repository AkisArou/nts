import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [artifact] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const wasm = instantiate();
let cases = 0;
// `Split` is one class whose two layouts sit at depths 0 and 1.
for (const [name, expected] of [['rootIsSplit', true], ['underIsSplit', true], ['baseIsSplit', false], ['underIsBase', true], ['rootIsBase', false]]) {
  assert.equal(wasm[name](), expected, name); cases++;
}
console.log(JSON.stringify({ cases }));
