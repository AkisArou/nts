import { waitFor } from "./test-wait.ts";
// The gate's tokens, end to end: tokenpool.mjs's server with token.sh and
// tokens.mjs as clients, the same code run.mjs uses.
//
//   node --test tooling/gate/tokens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTokenPool } from "./tokenpool.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = join(HERE, "token.sh");

async function pool(n, opts = {}) {
  let peakTotal = 0;
  const p = createTokenPool({
    free: () => n - p.total,
    claim: opts.claim ?? ((step, { waitedS }) => waitedS),
    known: () => true,
    observe: opts.observe,
  });
  const grant = p.grant;
  p.grant = () => { grant(); peakTotal = Math.max(peakTotal, p.total); };
  await p.start();
  p.peakTotal = () => peakTotal;
  return p;
}

function run(cmd, args, env, input, holdInput = false) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    if (!holdInput) child.stdin.end(input);
    child.on("close", (status, signal) => resolve({ status, signal, out, pid: child.pid }));
  });
  return Object.assign(done, { child });
}
const tokenEnv = (p, step = "examples") => ({ NTS_GATE_TOKENS: p.addr, NTS_GATE_STEP: step, NTS_GATE_TOKEN_HELD: "" });

test("no more commands run at once than there are tokens, and every one runs", async () => {
  // Measured on the commands themselves, not on the server's count: a client
  // that stopped waiting for `go` would keep the server's books and break the
  // budget.
  const p = await pool(3);
  const dir = mkdtempSync(join(tmpdir(), "nts-tokens-"));
  const script = `const fs=require('node:fs'),base=process.argv[1];
fs.writeFileSync(base+'.start',String(process.hrtime.bigint()));
process.stdin.resume();process.stdin.on('end',()=>{
fs.writeFileSync(base+'.end',String(process.hrtime.bigint()));console.log('done '+process.argv[2]);});`;
  const runs = Array.from({ length: 10 }, (_, i) =>
    run(TOKEN, [process.execPath, "-e", script, `${dir}/${i}`, String(i)], tokenEnv(p), undefined, true));
  try {
    await waitFor("three actual token holders and seven queued commands", () =>
      runs.filter((_,i) => {try {readFileSync(`${dir}/${i}.start`);return true;}catch{return false;}}).length===3 && p.waiting.length===7);
  } finally {for (const r of runs) r.child.stdin.end();}
  const results = await Promise.all(runs);
  for (const [i, r] of results.entries()) {
    assert.equal(r.status, 0);
    assert.equal(r.out.trim(), `done ${i}`);
  }
  const spans = results.map((_, i) => [BigInt(readFileSync(`${dir}/${i}.start`, "utf8")), BigInt(readFileSync(`${dir}/${i}.end`, "utf8"))]);
  const most = Math.max(...spans.map(([s]) => spans.filter(([a, b]) => a <= s && s < b).length));
  rmSync(dir, { recursive: true, force: true });
  assert.equal(most, 3);
  assert.equal(p.peakTotal(), 3);
  await waitFor("all token releases",()=>p.total===0);
  assert.equal(p.total, 0);
  p.close();
});

test("a token comes back when its holder is SIGKILLed", async () => {
  const p = await pool(1);
  const child = spawn(TOKEN, [process.execPath, "-e", "process.stdin.resume()"], { env: { ...process.env, ...tokenEnv(p) }, stdio: ["pipe", "ignore", "ignore"] });
  const closed=new Promise(resolve=>child.on("close",resolve));
  await waitFor("the token holder to be granted",()=>p.total===1);
  child.kill("SIGKILL");
  await closed;
  await waitFor("all token releases",()=>p.total===0);
  assert.equal(p.total, 0);
  const r = await run(TOKEN, ["true"], tokenEnv(p));
  assert.equal(r.status, 0);
  p.close();
});

test("exit status, signals and stdin are the command's own", async () => {
  const p = await pool(2);
  assert.equal((await run(TOKEN, ["sh", "-c", "exit 7"], tokenEnv(p))).status, 7);
  assert.equal((await run(TOKEN, ["sh", "-c", "kill -SEGV $$"], tokenEnv(p))).signal, "SIGSEGV");
  assert.equal((await run(TOKEN, ["cat"], tokenEnv(p), "from stdin\n")).out, "from stdin\n");
  p.close();
});

test("a holder that runs token.sh again does not wait for a second token", async () => {
  const p = await pool(1);
  const r = await run(TOKEN, [TOKEN, "sh", "-c", "echo nested"], tokenEnv(p));
  assert.equal(r.status, 0);
  assert.equal(r.out.trim(), "nested");
  p.close();
});

test("outside a gate the command runs; inside one, a runner that is gone is an error", async () => {
  assert.equal((await run(TOKEN, ["sh", "-c", "echo plain"], { NTS_GATE_TOKENS: "" })).out.trim(), "plain");
  const unreachable = await run(TOKEN, ["sh", "-c", "echo ran"], { NTS_GATE_TOKENS: "127.0.0.1:1", NTS_GATE_TOKEN_HELD: "" });
  assert.equal(unreachable.status, 75);
  assert.ok(!unreachable.out.split("\n").includes("ran"), unreachable.out);
});

test("a runner that accepted and then died: every waiting worker exits non-zero, none runs", async () => {
  const p = await pool(1);
  const holder = spawn(TOKEN, [process.execPath, "-e", "process.stdin.resume()"], { env: { ...process.env, ...tokenEnv(p) }, stdio: ["pipe", "ignore", "ignore"] });
  await waitFor("the token holder to be granted",()=>p.total===1);
  const waiting = Array.from({ length: 3 }, () => run(TOKEN, ["sh", "-c", "echo ran"], tokenEnv(p)));
  await waitFor("three queued token clients",()=>p.waiting.length===3);
  // The runner goes: its server and every connection it held.
  p.close();
  for (const w of p.waiting) w.sock.destroy();
  for (const r of await Promise.all(waiting)) {
    assert.equal(r.status, 75, r.out);
    assert.ok(!r.out.split("\n").includes("ran"), r.out);
  }
  holder.kill("SIGKILL");
});

test("the highest claim among waiting steps gets the freed token", async () => {
  // `long` claims more, but `short` has waited: the claim decides, so the
  // policy run.mjs passes (work left per token held, plus seconds waited) is
  // what orders them.
  //
  // The holder lets go only once both are queued. A fixed half-second hold
  // raced the second client's start: on a loaded machine `long` was not yet
  // waiting when the token came free, so `short` took it unopposed and the
  // test failed on landings that never touched the gate (2026-10-15).
  const order = [];
  const p = await pool(1, { claim: (step) => (step === "long" ? 100 : 1),
    observe: e => { if (e.event === "token.grant" && e.step !== "other") order.push(e.step); },
  });
  const holder = spawn(TOKEN, ["sh", "-c", "read _"], { env: { ...process.env, ...tokenEnv(p, "other") }, stdio: ["pipe", "ignore", "ignore"] });
  const released = new Promise((r) => holder.on("close", r));
  await waitFor("the token holder to be granted",()=>p.total===1);
  const a = run(TOKEN, ["sh", "-c", "echo short"], tokenEnv(p, "short")).then((r) => assert.equal(r.status, 0));
  await waitFor("the short client to queue",()=>p.waiting.length===1);
  const b = run(TOKEN, ["sh", "-c", "echo long"], tokenEnv(p, "long")).then((r) => assert.equal(r.status, 0));
  await waitFor("both competing token requests",()=>p.waiting.length===2);
  holder.stdin.end();
  await Promise.all([a, b, released]);
  assert.deepEqual(order, ["long", "short"]);
  p.close();
});

test("tokens.mjs holds a token around fn and returns it", async () => {
  const p = await pool(2);
  process.env.NTS_GATE_TOKENS = p.addr;
  process.env.NTS_GATE_STEP = "integrity";
  delete process.env.NTS_GATE_TOKEN_HELD;
  const { withToken } = await import(`./tokens.mjs?callback-hold-test`);
  let inside = 0, most = 0;
  const release=Promise.withResolvers();
  const running=Promise.all(Array.from({ length: 6 }, () => withToken(async () => {
    inside += 1; most = Math.max(most, inside);
    await release.promise;
    inside -= 1;
  })));
  try {await waitFor("two admitted callbacks and four queued requests",()=>inside===2 && p.waiting.length===4);}
  finally {release.resolve();await running;}
  assert.equal(most, 2);
  await waitFor("all token releases",()=>p.total===0);
  assert.equal(p.total, 0);
  assert.equal(await withToken(async () => 42), 42);
  // What the tool spawns inherits the guard, so it does not ask again.
  const child = await run("sh", ["-c", "echo $NTS_GATE_TOKEN_HELD"], {});
  assert.equal(child.out.trim(), "1");
  p.close();
  // And a runner that is gone rejects rather than running untokened.
  await assert.rejects(withToken(async () => "ran"), /went away|cannot be reached/);
});

test("a failed telemetry observer changes neither grants nor the command's exit", async () => {
  const p = await pool(1, { observe: () => { throw new Error("metrics unavailable"); } });
  try {
    const r = await run(TOKEN, ["sh", "-c", "printf original; exit 7"], tokenEnv(p));
    assert.equal(r.status, 7);
    assert.equal(r.out, "original");
    await waitFor("the token release",()=>p.total===0);
    assert.equal(p.total, 0);
  } finally { p.close(); }
});

test("shell telemetry preserves project names without adding protocol lines", async () => {
  const observations = [];
  const p = await pool(1, { observe: e => observations.push(e) });
  try {
    const project = "tests/programs/a% b\nq/tsconfig.json";
    const r = await run(TOKEN, ["sh", "-c", "exit 0", "_", project], {
      ...tokenEnv(p), NTS_GATE_CASE_COSTS_DIR: "enabled",
    });
    assert.equal(r.status, 0);
    const request = observations.find(e => e.event === "token.request");
    assert.equal(decodeURIComponent(request.context.slice(5)), project);
    assert.equal(observations.filter(e => e.event === "token.grant").length, 1);
  } finally { p.close(); }
});
