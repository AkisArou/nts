// The check command's own behaviour: status, withdraw, retry, and the
// refusals it makes before doing anything.
//
//   node --test tooling/landing/check.test.ts
//
// Each command runs in a child with its own HOME (so the landing home and the
// pool are the test's) and only the variables a command needs. The test holds
// the service's lock itself, so no command starts a service.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquire } from "./lock.ts";
import { Queue } from "./queue.ts";
import { scratchRepo } from "./scratch-repo.ts";

const CHECK = fileURLToPath(new URL("./check.ts", import.meta.url));

function cli(t: TestContext) {
  const s = scratchRepo(t, "landing-cli");
  const home = join(s.dir, "home"), landing = join(home, ".cache/nts-landing");
  mkdirSync(landing, { recursive: true });
  const env = { PATH: process.env.PATH!, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@a", GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@a" };
  const run = (args: string[], cwd = s.root, extra: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [CHECK, ...args], { cwd, env: { ...env, ...extra }, encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { s, home, landing, queue: new Queue(landing), run };
}

test("status shows the service, the queue, held changes, recent answers and the pool", t => {
  const c = cli(t);
  const empty = c.run(["status"]);
  assert.equal(empty.status, 0, empty.out);
  assert.match(empty.out, /^service: not running; idle/m);
  assert.match(empty.out, /^waiting \(0\): none$/m);
  const sha = c.s.git(["rev-parse", "HEAD"]);
  const a = c.queue.submit(sha, { branch: "fix/a" }), b = c.queue.submit(sha, { branch: "fix/b", first: true, by: "full-check", note: "revert" });
  c.queue.answer(c.queue.take()!, { state: "held", message: "held: tests INSTRUMENT" });
  const listed = c.run(["status"]);
  assert.match(listed.out, new RegExp(`^ {2}1\\. ${a.id} fix/a by agent$`, "m"));
  assert.match(listed.out, new RegExp(`^ {2}${b.id} fix/b: held: tests INSTRUMENT$`, "m"));
  assert.match(listed.out, /^recent \(1\):/m);
});

test("withdraw answers a waiting change; retry queues a held one first", t => {
  const c = cli(t);
  const sha = c.s.git(["rev-parse", "HEAD"]);
  const a = c.queue.submit(sha), b = c.queue.submit(sha);
  const out = c.run(["withdraw", a.id]);
  assert.equal(out.status, 0, out.out);
  assert.equal(c.queue.result(a.id)?.state, "withdrawn");
  assert.equal(c.run(["withdraw", "nothing-here"]).status, 1);
  c.queue.answer(c.queue.take()!, { state: "held", message: "held" });
  const lock = acquire(join(c.landing, "serve.lock"))!; // a service "is draining"
  t.after(() => lock.release());
  const retried = c.run(["retry", b.id]);
  assert.equal(retried.status, 0, retried.out);
  assert.match(retried.out, /queued again, first; running/);
  assert.deepEqual(c.queue.waiting().map(e => e.id), [b.id]);
});

test("the command refuses before it acts: usage, policy variables, a tree not at the commit, a dirty tree, serve elsewhere", t => {
  const c = cli(t);
  assert.equal(c.run([]).status, 2);
  assert.equal(c.run(["no-such-commit"]).status, 2);
  for(const args of [["HEAD","--trace-rust-inputs"],["HEAD","--dry-run","--trace-rust-inputs"],["status","--here","--trace-rust-inputs"]]){
    const observed=c.run(args);assert.equal(observed.status,2,observed.out);
    assert.match(observed.out,/trace-rust-inputs is an observation of --here/);
  }
  const policy = c.run(["HEAD", "--here"], c.s.root, { NTS_GATE_SLOTS: "4" });
  assert.equal(policy.status, 2);
  assert.match(policy.out, /verdict-policy overrides are not allowed.*NTS_GATE_SLOTS/);
  const behind = c.s.git(["rev-parse", "HEAD"]);
  c.s.commit({ "src/a.txt": "a\n" }, "a");
  assert.match(c.run([behind, "--here"]).out, /runs in a tree at [0-9a-f]{12}; this one is not/);
  writeFileSync(join(c.s.root, "README.md"), "edited\n");
  assert.match(c.run(["HEAD", "--here"]).out, /this tree has uncommitted changes/);
  const elsewhere = join(c.s.dir, "elsewhere");
  c.s.git(["worktree", "add", "-q", "--detach", elsewhere]);
  const serve = c.run(["serve"], elsewhere);
  assert.equal(serve.status, 2);
  assert.match(serve.out, /the service runs from the shared checkout/);
});

test("status --json is the same state, versioned, with numbers as numbers and each answer's task and issue", t => {
  const c = cli(t);
  const sha = c.s.git(["rev-parse", "HEAD"]);
  const landed = c.queue.submit(sha, { branch: "42-a-task" });
  c.queue.answer(c.queue.take()!, { state: "landed", message: "LANDED", base: sha, tip: sha, wall_s: 125, estimate_s: 100, landing: ["build", "tests"], deferred: ["integrity"], pending: ["one"] });
  c.queue.submit(sha, { branch: "fix/b", note: "after it" });
  const out = c.run(["status", "--json"]);
  assert.equal(out.status, 0, out.out);
  const s = JSON.parse(out.out);
  assert.equal(s.version, 1);
  assert.equal(s.kind, "landing");
  assert.deepEqual(s.service, { running: false, pid: null, unit: "nts-landing-check", state: "idle", since: s.service.since, message: null });
  assert.equal(s.checking, null);
  assert.deepEqual(s.waiting.map((w: { branch: string; issue: number | null; note: string }) => [w.branch, w.issue, w.note]), [["fix/b", null, "after it"]]);
  const [r] = s.recent;
  assert.equal(r.id, landed.id);
  assert.deepEqual([r.state, r.branch, r.issue, r.wall_s, r.estimate_s, r.pending], ["landed", "42-a-task", 42, 125, 100, 1], "numbers as numbers, and the task's issue");
  assert.deepEqual(r.landing, ["build", "tests"]);
  assert.deepEqual(s.day, { landed: 1, refused: 0, held: 0, withdrawn: 0, median_wall_s: 125, max_wall_s: 125 });
  assert.equal(s.main.commit, sha);
  assert.deepEqual(s.pool.trees, []);
  assert.match(c.run(["status"]).out, /^last day: 1 landed \(median 2\.1 min, longest 2\.1 min\), 0 refused, 0 held, 0 withdrawn$/m, "the text is rendered from the same model");
});
