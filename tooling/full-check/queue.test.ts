// node --test tooling/full-check/queue.test.ts
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { acquire } from "../landing/lock.ts";
import { Queue } from "../landing/queue.ts";
import { landingQueue, submitTo } from "./queue.ts";
import { repository } from "./repository-fixture.ts";

test("the full check's revert goes into the landing check's queue first, and a records commit takes its turn", async t => {
  const repo = repository(t);
  const change = repo.commit({ "a.txt": "a\n" }, "a change waiting to land");
  const records = repo.commit({ "results/a.tsv": "a\n" }, "records: a");
  const revert = repo.commit({ "a.txt": null }, 'Revert "a change waiting to land"');
  const home = join(repo.root, "landing"), queue = new Queue(home);
  queue.submit(change, { branch: "task/a" });
  // A service is draining the queue, so submitting starts no second one.
  const service = acquire(join(home, "serve.lock"))!;
  t.after(() => service.release());
  const landing = landingQueue({ root: repo.dir, home });
  assert.deepEqual(await submitTo(landing, records, { first: false }), { submitted: true, line: `submitted ${records} to the landing queue` });
  assert.deepEqual(await submitTo(landing, revert, { first: true }), { submitted: true, line: `submitted ${revert} first to the landing queue` });
  assert.deepEqual(queue.waiting().map(e => [e.sha, e.by, e.first]), [[revert, "full-check", true], [change, "agent", false], [records, "full-check", false]]);
  const unknown = await submitTo(landing, "0".repeat(40), { first: true });
  assert.equal(unknown.submitted, false);
  assert.match(unknown.line, new RegExp(`^the landing queue refused ${"0".repeat(40)}: `));
  assert.equal(queue.waiting().length, 3, "a refused commit is not queued");
});

test("a queue's submit is called with the commit and its place, and a refusal is reported", async () => {
  const calls: unknown[] = [];
  const ok = await submitTo({ submit: (commit, options) => { calls.push([commit, options]); } }, "b".repeat(40), { first: true });
  assert.deepEqual(calls, [["b".repeat(40), { first: true }]]);
  assert.equal(ok.submitted, true);
  const refused = await submitTo({ submit: async () => { throw new Error("not on main"); } }, "c".repeat(40), { first: false });
  assert.deepEqual(refused, { submitted: false, line: `the landing queue refused ${"c".repeat(40)}: not on main` });
});
