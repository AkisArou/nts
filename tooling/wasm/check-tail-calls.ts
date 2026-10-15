// The tail-calls fixture: a recursion 100,000 deep in tail position completes
// on Wasm, where node itself would run out of stack, so its answers are known
// rather than asked of node. The calls that are not in tail position are
// checked at a depth any stack holds.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [artifact] = process.argv.slice(2);
const wasm = await import(pathToFileURL(path.join(artifact!, "program.mjs")).href);
let cases = 0;
function same(actual: unknown, expected: unknown, what: string): void {
  assert.ok(Object.is(actual, expected), `${what}: ${String(actual)} != ${String(expected)}`);
  cases++;
}
const deep = 100_000;
same(wasm.countdown(deep), 0, "countdown(deep)");
same(wasm.throughJoin(deep), 0, "throughJoin(deep)");
for (const n of [0, 1, 3, 7, 100]) {
  same(wasm.countdown(n), 0, `countdown(${n})`);
  same(wasm.throughJoin(n), 0, `throughJoin(${n})`);
  same(wasm.caught(n), n === 3 ? -1 : n, `caught(${n})`);
  same(wasm.addedTo(n), n, `addedTo(${n})`);
}
console.log(JSON.stringify({ cases }));
