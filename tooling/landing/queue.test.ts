import {fixtureEnvironment} from "../gate/test-environment.ts";
// The durable landing queue and its owner lock.
//
//   node --test tooling/landing/queue.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquire, holder, withLock } from "./lock.ts";
import { ensureService, Queue, serviceRunning, submit } from "./queue.ts";
import { scratchRepo } from "./scratch-repo.ts";

const home = (t: { after: (f: () => void) => void }) => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "landing-queue-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const sha = (c: string) => c.repeat(40);

test("changes are checked in the order they were queued, and a revert goes first", t => {
  const q = new Queue(home(t));
  const a = q.submit(sha("a"), { branch: "task/a" });
  const b = q.submit(sha("b"), { branch: "task/b" });
  const revert = q.submit(sha("c"), { first: true, by: "full-check", note: "revert of bbbbbbbbbbbb" });
  assert.deepEqual(q.waiting().map(e => e.id), [revert.id, a.id, b.id]);
  // The queue is its files: a new process reads the same order.
  assert.deepEqual(new Queue(q.home).waiting().map(e => e.id), [revert.id, a.id, b.id]);
  const taken = q.take()!;
  assert.equal(taken.id, revert.id);
  assert.equal(q.checking()?.id, revert.id);
  assert.deepEqual(q.waiting().map(e => e.id), [a.id, b.id]);
  assert.throws(() => q.submit("main"), /full commit id/);
});

test("an answer is durable before the change leaves checking, and a crash puts it back in front", t => {
  const q = new Queue(home(t));
  const a = q.submit(sha("a")), b = q.submit(sha("b"));
  q.take();
  q.update({ base: sha("0"), tip: sha("1"), phase: "landing" });
  assert.equal(q.checking()?.phase, "landing");
  // The service died here: restart puts the change back ahead of the others.
  const again = q.requeue()!;
  assert.equal(again.id, a.id);
  assert.equal(q.checking(), null);
  assert.deepEqual(q.waiting().map(e => e.id), [a.id, b.id]);
  const taken = q.take()!;
  const result = q.answer(taken, { state: "refused", message: "tests FAIL", run: "/runs/x" });
  assert.equal(q.checking(), null);
  assert.equal(q.result(a.id)?.state, "refused");
  assert.equal(result.message, "tests FAIL");
  assert.deepEqual(q.results().map(r => r.id), [a.id]);
});

test("a held change waits aside until it is retried, at the front", t => {
  const q = new Queue(home(t));
  const a = q.submit(sha("a")), b = q.submit(sha("b"));
  q.answer(q.take()!, { state: "held", message: "tooling: hung" });
  assert.deepEqual(q.held().map(e => e.id), [a.id]);
  assert.deepEqual(q.waiting().map(e => e.id), [b.id]);
  q.retry(a.id);
  assert.deepEqual(q.held(), []);
  assert.deepEqual(q.waiting().map(e => e.id), [a.id, b.id]);
  assert.throws(() => q.retry(a.id), /no held change/);
});

test("a withdrawal answers a waiting change at once and the one being checked when its check ends", t => {
  const q = new Queue(home(t));
  const a = q.submit(sha("a")), b = q.submit(sha("b"));
  q.take();
  assert.equal(q.withdraw(sha("a").slice(0, 12)), "requested");
  assert.ok(q.withdrawRequested(a.id));
  assert.equal(q.withdraw(b.id), "withdrawn");
  assert.equal(q.result(b.id)?.state, "withdrawn");
  assert.deepEqual(q.waiting(), []);
  assert.equal(q.withdraw("nothing"), "unknown");
  q.answer(q.checking()!, { state: "withdrawn", message: "withdrawn while it was checked" });
  assert.equal(q.withdrawRequested(a.id), false);
});

test("the status says what the service does, and since when", t => {
  const q = new Queue(home(t));
  assert.equal(q.status().state, "idle");
  q.setStatus({ state: "held", id: "x", message: "memory: 9.0 GB" });
  const since = q.status().since;
  q.setStatus({ state: "held", id: "x", message: "memory: 10.0 GB" });
  assert.equal(q.status().since, since, "the same hold keeps its start");
  assert.equal(q.status().message, "memory: 10.0 GB");
});

test("submit, as the full check calls it, puts a revert first and starts no second service", t => {
  const s = scratchRepo(t, "landing-submit");
  const home = join(s.dir, "landing");
  const q = new Queue(home);
  const waiting = q.submit(s.git(["rev-parse", "HEAD"]), { branch: "fix/a" });
  const revert = s.commit({ "docs/workflow.md": "reverted\n" }, "Revert \"something\"");
  const lock = acquire(join(home, "serve.lock"))!; // a service is draining
  t.after(() => lock.release());
  const entry = submit("HEAD", { first: true, note: `revert of ${"f".repeat(12)}`, root: s.root, home });
  assert.equal(entry.sha, revert);
  assert.equal(entry.by, "full-check");
  assert.deepEqual(q.waiting().map(e => e.id), [entry.id, waiting.id]);
  assert.ok(serviceRunning(home));
  assert.equal(ensureService(s.root, home), "running");
});

test("one owner holds the lock; a dead owner's lock is taken over", t => {
  const dir = home(t), path = join(dir, "serve.lock");
  const lock = acquire(path)!;
  assert.ok(lock);
  assert.equal(holder(path), process.pid);
  assert.equal(acquire(path), null, "held by a live process");
  lock.release();
  assert.equal(existsSync(path), false);
  // A process that held it and exited.
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import {acquire} from ${JSON.stringify(new URL("./lock.ts", import.meta.url).href)}; acquire(${JSON.stringify(path)});`], {env:fixtureEnvironment(t)});
  assert.equal(child.status, 0, child.stderr?.toString());
  assert.ok(existsSync(path) && readFileSync(path, "utf8").includes(` ${child.pid} `));
  assert.equal(holder(path), null);
  const taken = acquire(path);
  assert.ok(taken, "the dead owner's lock is taken over");
  taken!.release();
  writeFileSync(path, "garbage\n");
  assert.throws(()=>withLock(path,()=>true),/malformed owner bytes.*garbage.*confirm.*remove this file/);
  assert.equal(readFileSync(path,'utf8'),'garbage\n','corruption is not a dead owner');
});


test("future queue state refuses reads, transitions and deletions byte for byte",t=>{
  const q=new Queue(home(t)),entry=q.submit(sha("a"));
  const queued=join(q.home,"queue",readdirSync(join(q.home,"queue"))[0]!);
  const checking=join(q.home,"checking.json"),result=join(q.home,"results",entry.id+".json"),status=join(q.home,"status.json");
  const future='{ "version": 2, "id": "opaque", "extra": true }\n';
  for(const [path,actions] of [
    [queued,[()=>q.waiting(),()=>q.take(),()=>q.withdraw(entry.id)]],
    [checking,[()=>q.checking(),()=>q.update({phase:"landing"}),()=>q.requeue(),()=>q.answer(entry,{state:"refused",message:"old"})]],
    [result,[()=>q.result(entry.id),()=>q.answer(entry,{state:"refused",message:"old"})]],
    [status,[()=>q.status(),()=>q.setStatus({state:"idle"})]],
  ] as const){
    writeFileSync(path,future);
    if(path===checking)assert.equal(existsSync(result),false);
    for(const action of actions){assert.throws(action,/future state version 2/);assert.equal(readFileSync(path,"utf8"),future);}
    if(path===checking)assert.equal(existsSync(result),false,"an incompatible transition publishes no partial result");
    rmSync(path);
  }
  const held=join(q.home,"held",entry.id+".json");writeFileSync(held,future);
  assert.throws(()=>q.retry(entry.id),/future state version 2/);assert.equal(readFileSync(held,"utf8"),future);
});
