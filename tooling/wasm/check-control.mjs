import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [artifact, fixture] = process.argv.slice(2);
const { instantiate } = await import(pathToFileURL(path.join(artifact, 'node.mjs')));
const manifest = JSON.parse(await readFile(path.join(artifact, 'program.json'), 'utf8'));
const wasm = await instantiate(await readFile(path.join(artifact, 'program.wasm')), manifest);
const graph = JSON.parse(await readFile(fixture, 'utf8')).successors;
const covered = new Set(), terminals = new Set();
let cases = 0, cyclicPaths = 0, maxVisits = 0;
for (let n = -3; n <= 30; n++) {
  let x = 7, y = 11;
  for (let i = 0; i < n; i++) [x, y] = [y, x];
  assert.equal(wasm.phiSwap(n), x * 100 + y, `cyclic phi copy n=${n}`);
  cases++;
}
const seeds = [...Array(16384).keys()];
let state = 0x12345678;
for (let i = 0; i < 4096; i++) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  seeds.push(state);
}
for (const seed of seeds) {
  const path = [];
  let at = 0, visits = 0;
  for (; visits < 512; ) {
    path.push(at); visits++;
    const to = graph[at];
    if (to.length === 0) break;
    at = to.length === 1 ? to[0] : to[(seed >>> (at + visits)) & 1 ? 0 : 1];
  }
  // Other inputs may loop forever in the original graph. Establish termination
  // with the independent walker before invoking wasm; do not change any edge.
  if (visits === 512) continue;
  assert.equal(wasm.triangleGraph(seed), visits * 100 + at, `generator graph seed=${seed}`);
  for (const id of path) covered.add(id);
  terminals.add(at);
  if (new Set(path).size !== path.length) cyclicPaths++;
  maxVisits = Math.max(maxVisits, visits);
  cases++;
}
assert.equal(covered.size, graph.length, 'every original block executed');
assert.deepEqual([...terminals].sort((a, b) => a - b), [2, 10, 12]);
const routes = manifest.functions.map(f => ({ name: f.name, route: f.route, blocks: f.blocks, edges: f.edges }));
assert.equal(routes.find(f => f.name === 'phiSwap').route, 'structured');
const triangle = routes.find(f => f.name === 'triangleGraph');
assert.equal(triangle.route, 'dispatcher');
assert.equal(triangle.blocks, graph.length);
assert.equal(triangle.edges, graph.reduce((n, edges) => n + edges.length, 0));
console.log(JSON.stringify({ cases, visitedBlocks: covered.size, cyclicPaths, maxVisits, routes }));
