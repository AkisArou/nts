// node --test tooling/full-check/queue.test.ts
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { acquire } from "../landing/lock.ts";
import { Queue } from "../landing/queue.ts";
import { answerOf, landingQueue, submitTo } from "./queue.ts";
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

test("the landing check's answer to a submitted commit is read back: waiting, its latest answer, or no record of it", t => {
  const repo = repository(t), home = join(repo.root, "landing"), queue = new Queue(home);
  const commit = repo.commit({ "results/a.tsv": "a\n" }, "records: a");
  const said = (answer: ReturnType<typeof answerOf>) => answer === null || answer === "waiting" ? answer : [answer.state, answer.message, answer.tip ?? null];
  assert.equal(answerOf(queue, commit), null, "a commit the queue has no record of");
  const entry = queue.submit(commit, { by: "full-check" });
  assert.equal(answerOf(queue, commit), "waiting");
  queue.take();
  assert.equal(answerOf(queue, commit), "waiting", "being checked is waiting too");
  queue.answer(entry, { state: "held", message: "held: the check could not finish" });
  assert.deepEqual(said(answerOf(queue, commit)), ["held", "held: the check could not finish", null]);
  queue.retry(entry.id);
  assert.equal(answerOf(queue, commit), "waiting", "a held change retried by hand waits again");
  queue.answer(queue.take()!, { state: "landed", message: "LANDED", tip: "f".repeat(40) });
  assert.deepEqual(said(answerOf(queue, commit)), ["landed", "LANDED", "f".repeat(40)]);
  assert.deepEqual(said(landingQueue({ root: repo.dir, home }).answer(commit)), ["landed", "LANDED", "f".repeat(40)], "as the full check's queue reads it");
});
