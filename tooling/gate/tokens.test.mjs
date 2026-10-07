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
  });
  const grant = p.grant;
  p.grant = () => { grant(); peakTotal = Math.max(peakTotal, p.total); };
  await p.start();
  p.peakTotal = () => peakTotal;
  return p;
}

function run(cmd, args, env, input) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
    child.on("close", (status, signal) => resolve({ status, signal, out, pid: child.pid }));
    resolve.child = child;
  });
}
const tokenEnv = (p, step = "examples") => ({ NTS_GATE_TOKENS: p.addr, NTS_GATE_STEP: step, NTS_GATE_TOKEN_HELD: "" });
const settle = () => new Promise((r) => setTimeout(r, 200));

test("no more commands run at once than there are tokens, and every one runs", async () => {
  // Measured on the commands themselves, not on the server's count: a client
  // that stopped waiting for `go` would keep the server's books and break the
  // budget.
  const p = await pool(3);
  const dir = mkdtempSync(join(tmpdir(), "nts-tokens-"));
  const runs = Array.from({ length: 10 }, (_, i) =>
    run(TOKEN, ["sh", "-c", `date +%s%N > ${dir}/${i}.start; sleep 0.3; date +%s%N > ${dir}/${i}.end; echo done ${i}`], tokenEnv(p)));
  const results = await Promise.all(runs);
  for (const [i, r] of results.entries()) {
    assert.equal(r.status, 0);
    assert.equal(r.out.trim(), `done ${i}`);
  }
  const spans = results.map((_, i) => [Number(readFileSync(`${dir}/${i}.start`, "utf8")), Number(readFileSync(`${dir}/${i}.end`, "utf8"))]);
  const most = Math.max(...spans.map(([s]) => spans.filter(([a, b]) => a <= s && s < b).length));
  rmSync(dir, { recursive: true, force: true });
  assert.equal(most, 3);
  assert.equal(p.peakTotal(), 3);
  await settle();
  assert.equal(p.total, 0);
  p.close();
});

test("a token comes back when its holder is SIGKILLed", async () => {
  const p = await pool(1);
  const child = spawn(TOKEN, ["sleep", "30"], { env: { ...process.env, ...tokenEnv(p) }, stdio: "ignore" });
  while (p.total === 0) await settle();
  child.kill("SIGKILL");
  await new Promise((r) => child.on("close", r));
  await settle();
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
  const holder = spawn(TOKEN, ["sleep", "30"], { env: { ...process.env, ...tokenEnv(p) }, stdio: "ignore" });
  while (p.total === 0) await settle();
  const waiting = Array.from({ length: 3 }, () => run(TOKEN, ["sh", "-c", "echo ran"], tokenEnv(p)));
  while (p.waiting.length < 3) await settle();
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
  const order = [];
  const p = await pool(1, { claim: (step) => (step === "long" ? 100 : 1) });
  const holder = spawn(TOKEN, ["sleep", "0.5"], { env: { ...process.env, ...tokenEnv(p, "other") }, stdio: "ignore" });
  while (p.total === 0) await settle();
  const a = run(TOKEN, ["sh", "-c", "echo short"], tokenEnv(p, "short")).then((r) => order.push(r.out.trim()));
  await settle();
  const b = run(TOKEN, ["sh", "-c", "echo long"], tokenEnv(p, "long")).then((r) => order.push(r.out.trim()));
  await Promise.all([a, b, new Promise((r) => holder.on("close", r))]);
  assert.deepEqual(order, ["long", "short"]);
  p.close();
});

test("tokens.mjs holds a token around fn and returns it", async () => {
  const p = await pool(2);
  process.env.NTS_GATE_TOKENS = p.addr;
  process.env.NTS_GATE_STEP = "integrity";
  delete process.env.NTS_GATE_TOKEN_HELD;
  const { withToken } = await import(`./tokens.mjs?${Date.now()}`);
  let inside = 0, most = 0;
  await Promise.all(Array.from({ length: 6 }, () => withToken(async () => {
    inside += 1; most = Math.max(most, inside);
    await new Promise((r) => setTimeout(r, 100));
    inside -= 1;
  })));
  assert.equal(most, 2);
  await settle();
  assert.equal(p.total, 0);
  assert.equal(await withToken(async () => 42), 42);
  // What the tool spawns inherits the guard, so it does not ask again.
  const child = await run("sh", ["-c", "echo $NTS_GATE_TOKEN_HELD"], {});
  assert.equal(child.out.trim(), "1");
  p.close();
  // And a runner that is gone rejects rather than running untokened.
  await assert.rejects(withToken(async () => "ran"), /went away|cannot be reached/);
});
