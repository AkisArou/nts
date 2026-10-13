// Bounded scalar smoke comparison for explicitly selected examples. The full
// hostile-pool agree instrument joins in M1; this does not claim that coverage.
//
// A refusal (NTS5001) is asked of node too. Where node throws as well it is
// `declined`; where node answers it is `refused`, tallied by the refusal's
// reason, so a test pins which refusals may stand in for an answer and a
// refusal where node answers cannot hide among the throws.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [artifact, source] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'program.instance.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.wasm.json'), 'utf8'));
const wasm = instantiate();
const js = await import(pathToFileURL(path.resolve(source)));
const pool = [NaN, -Infinity, Infinity, -0, 0, 1, -1, 0.5, -0.5, 3, 7, 20,
  2147483647, -2147483648, 2147483648, 4294967295, Number.MAX_SAFE_INTEGER];
let cases = 0, declined = 0;
const refused = {};
const reasonOf = error => String(error.message).replace(/^NTS5001: wasm (?:operation in|input to|result from|throw from) [^:]*: /, '');
for (const e of manifest.exports) {
  assert.equal(typeof js[e.name], 'function');
  const base = e.params.map(p => p.ty.kind === 'bool' ? true : 3);
  for (let at = 0; at < e.params.length; at++) {
    for (const value of e.params[at].ty.kind === 'bool' ? [false, true] : pool) {
      const args = base.with(at, value);
      let actual;
      try { actual = wasm[e.name](...args); }
      catch (error) {
        if (error.code !== 'NTS5001') throw error;
        let threw = false;
        try { js[e.name](...args); } catch { threw = true; }
        if (threw) declined++;
        else refused[reasonOf(error)] = (refused[reasonOf(error)] ?? 0) + 1;
        continue;
      }
      const expected = js[e.name](...args);
      assert.ok(Object.is(actual, expected), `${e.name}(${args}) wasm=${actual} JS=${expected}`);
      cases++;
    }
  }
  if (e.params.length === 0) {
    assert.ok(Object.is(wasm[e.name](), js[e.name]())); cases++;
  }
}
assert.ok(manifest.functions.every(f => f.route === 'structured'));
console.log(JSON.stringify({ cases, declined, refused, exportedFunctions: manifest.exports.length, functions: manifest.functions.length, imports: manifest.imports }));
