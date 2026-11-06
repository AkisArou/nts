// node --test tooling/full-check/queue.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { landingQueue, submitTo } from "./queue.ts";

test("without the landing check's queue module nothing is submitted, and the line says what to do", async () => {
  const queue = await landingQueue(new URL("./no-such-queue.ts", import.meta.url));
  assert.ok("unavailable" in queue);
  const result = await submitTo(queue, "a".repeat(40), { first: true });
  assert.equal(result.submitted, false);
  assert.match(result.line, /^not submitted \(no landing queue at .*no-such-queue\.ts\): submit a{40} first by hand$/);
});

test("a queue's submit is called with the commit and its place, and a refusal is reported", async () => {
  const calls: unknown[] = [];
  const ok = await submitTo({ submit: (commit, options) => { calls.push([commit, options]); } }, "b".repeat(40), { first: true });
  assert.deepEqual(calls, [["b".repeat(40), { first: true }]]);
  assert.equal(ok.submitted, true);
  const refused = await submitTo({ submit: async () => { throw new Error("not on main"); } }, "c".repeat(40), { first: false });
  assert.deepEqual(refused, { submitted: false, line: `the landing queue refused ${"c".repeat(40)}: not on main` });
});
