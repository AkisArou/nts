// A JSON-lines reader sees a writer's line before its newline (#963): the
// case-admission fixture's watcher parsed a half-appended queue event and threw.
// Each control delivers the read between the two halves of one line.
import assert from "node:assert/strict";
import { appendFileSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { JsonLinesTail, waitForJsonLine } from "./json-lines.ts";
import { testScratch } from "./test-scratch.ts";

const row = { event: "pool.change", memory: { reserved_bytes: 1, used_bytes: 0 }, note: "naïve ✓" };
const line = JSON.stringify(row) + "\n";
// Split inside a multi-byte character, so the halves are not valid UTF-8 alone.
const cut = Buffer.byteLength(line.slice(0, line.indexOf("ï"))) + 1;
const halves = [Buffer.from(line).subarray(0, cut), Buffer.from(line).subarray(cut)] as const;

test("a read between the two halves of a line returns no row, and the completed line returns it once", t => {
  const file = join(testScratch(t, "json-lines-tail"), "queue.jsonl");
  writeFileSync(file, "");
  const tail = new JsonLinesTail(file);
  assert.deepEqual(tail.read(), []);
  appendFileSync(file, halves[0]);
  assert.deepEqual(tail.read(), []);
  appendFileSync(file, halves[1]);
  assert.deepEqual(tail.read(), [row]);
  assert.deepEqual(tail.read(), []);
  appendFileSync(file, line + line);
  assert.deepEqual(tail.read(), [row, row]);
});

test("a complete line that is not JSON still throws, naming the file", t => {
  const file = join(testScratch(t, "json-lines-malformed"), "queue.jsonl");
  writeFileSync(file, '{"event":"token.request"\n');
  assert.throws(() => new JsonLinesTail(file).read(), error => error instanceof Error && error.message.startsWith(`${file}: a complete line is not JSON`));
});

test("a file that shrinks under the tail is refused by name", t => {
  const file = join(testScratch(t, "json-lines-shrink"), "queue.jsonl");
  writeFileSync(file, line);
  const tail = new JsonLinesTail(file);
  assert.deepEqual(tail.read(), [row]);
  writeFileSync(file, "");
  assert.throws(() => tail.read(), /shrank from \d+ to 0 bytes/);
});

test("a watcher notified between the two halves of a matching line keeps waiting, then resolves with the row", async t => {
  const file = join(testScratch(t, "json-lines-watch"), "queue.jsonl");
  writeFileSync(file, JSON.stringify({ event: "pool.state" }) + "\n");
  let settled: string | undefined;
  const waiting = waitForJsonLine<typeof row>(file, candidate => candidate.event === "pool.change")
    .then(value => { settled = "resolved"; return value; }, error => { settled = `rejected: ${(error as Error).message}`; throw error; });
  // An independent watcher shows the change notification was delivered; the
  // following check phase runs after every callback of that notification.
  const notified = new Promise<void>(resolve => { const observer = watch(file, () => { observer.close(); resolve(); }); });
  appendFileSync(file, halves[0]);
  await notified;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, undefined);
  appendFileSync(file, halves[1]);
  assert.deepEqual(await waiting, row);
});
