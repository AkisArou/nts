import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [directory, source] = process.argv.slice(2);
const { load } = await import(pathToFileURL(resolve(directory, 'node.mjs')));
const api = await load(pathToFileURL(resolve(directory, 'program.wasm')));
const graphs = JSON.parse(await readFile(source, 'utf8'));
let cases = 0;
for (const [index, graph] of graphs.entries()) {
  for (const seed of [0, 1, 0xffff_ffff, 0x5555_5555, 0xaaaa_aaaa, 0x0123_4567, 0x7fff_ffff, 0x8000_0000]) {
    for (const fuel of [0, 1, 2, 3, 7, 15, 16, 31, 32, 63]) {
      let at = 0, trace = 0;
      for (let step = 0; step < fuel; step++) {
        trace = (Math.imul(trace, 33) + at + 1) | 0;
        if (graph[at].length === 0) break;
        at = graph[at][((seed >>> step) & 1) ? 0 : 1];
      }
      assert.equal(api[`graph${index}`](seed, fuel), trace, `graph${index} seed=${seed} fuel=${fuel}`);
      cases++;
    }
  }
}
console.log(JSON.stringify({ functions: graphs.length, cases }));
