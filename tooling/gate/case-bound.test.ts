// A case's bound under the shared supervisor: its compile past its own-CPU
// bound timed out, which is an outcome and never published as a hold; past the
// group's budget, or silent, it measured nothing (active-command.ts,
// case-bound.ts).
//
//   node --test tooling/gate/case-bound.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { activeCommand, COMMAND_CPU_BUDGET_SECONDS, COMPILE_CPU_BOUND_SECONDS } from "./active-command.ts";
import { CASE_TIMEOUT_EXIT, CASE_UNMEASURED_EXIT, parseCaseBound, runCaseBound } from "./case-bound.ts";

const spin = [process.execPath, ["-e", "for(;;){}"]] as const;
// The parent only waits: the CPU is its child's.
const spinningChild = [process.execPath, ["-e", "require('node:child_process').spawn(process.execPath,['-e','for(;;){}'],{stdio:'inherit'})"]] as const;

function frame(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "case-bound-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "result.json");
  return { path, env: { ...process.env, NTS_GATE_STEP_RESULT: path, NTS_GATE_STEP: "dex", NTS_GATE_STEP_ATTEMPT: "one" },
    read: () => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as { kind: string; verdict: string } : null };
}

test("a compile past its own-CPU bound timed out: stopped, and nothing published for the step", async t => {
  const f = frame(t);
  const result = await activeCommand(spin[0], [...spin[1]], { cwd: process.cwd(), env: f.env, ownCpuSeconds: 0.3, pollMs: 20 });
  assert.match(result.timeout ?? "", /used its 0\.3 s CPU bound: its own CPU reached/);
  assert.equal(result.runaway, undefined);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(f.read(), null, "a timeout is the case's outcome, not a hold");
  assert.ok(COMPILE_CPU_BOUND_SECONDS === 600 && COMPILE_CPU_BOUND_SECONDS < COMMAND_CPU_BUDGET_SECONDS);
});

test("the bound is the command's own CPU: a child's CPU reaches only the group's budget, which is unmeasured", async t => {
  const f = frame(t);
  const result = await activeCommand(spinningChild[0], [...spinningChild[1]], { cwd: process.cwd(), env: f.env, ownCpuSeconds: 0.3, cpuBudgetSeconds: 1, pollMs: 20 });
  assert.equal(result.timeout, undefined);
  assert.match(result.runaway ?? "", /reached its 1 s budget/);
  assert.equal(f.read()?.kind, "runaway");
});

test("the helper's exits: the command's own, 125 for a timeout, 124 for what it could not measure", async t => {
  const out: string[] = [], err: string[] = [];
  const write = { out: (text: string) => { out.push(text); }, err: (text: string) => { err.push(text); } };
  const f = frame(t);
  assert.equal(await runCaseBound({ cpuSeconds: 60, idleMs: 60_000, command: "sh", args: ["-c", "echo said; exit 3"] }, f.env, write), 3);
  assert.deepEqual(out, ["said\n"]);
  assert.equal(await runCaseBound({ cpuSeconds: 60, idleMs: 60_000, command: "sh", args: ["-c", "kill -TERM $$"] }, f.env, write), 128 + 15);
  assert.equal(await runCaseBound({ ownCpuSeconds: 0.3, cpuSeconds: 60, idleMs: 60_000, command: spin[0], args: [...spin[1]] }, f.env, write), CASE_TIMEOUT_EXIT);
  assert.match(err.at(-1)!, /^timed out: .*used its 0\.3 s CPU bound/);
  assert.equal(f.read(), null, "the timeout published nothing");
  assert.equal(await runCaseBound({ cpuSeconds: 60, idleMs: 500, command: "tail", args: ["-f", "/dev/null"] }, f.env, write), CASE_UNMEASURED_EXIT);
  assert.deepEqual([f.read()?.kind, f.read()?.verdict], ["hung", "NOT RUN"]);
  assert.equal(await runCaseBound({ cpuSeconds: 60, idleMs: 60_000, command: join(tmpdir(), "no-such-command-of-case-bound"), args: [] }, f.env, write), CASE_UNMEASURED_EXIT);
  assert.deepEqual([f.read()?.kind, f.read()?.verdict], ["tooling-setup", "INSTRUMENT"]);
});

test("the helper's arguments", () => {
  assert.deepEqual(parseCaseBound(["--compile", "--", "nts", "emit-jvm", "x"]),
    { ownCpuSeconds: COMPILE_CPU_BOUND_SECONDS, cpuSeconds: COMMAND_CPU_BUDGET_SECONDS, idleMs: 5 * 60_000, command: "nts", args: ["emit-jvm", "x"] });
  assert.deepEqual(parseCaseBound(["--cpu", "14400", "--idle", "1800", "--", "node", "r.ts"]),
    { cpuSeconds: 14400, idleMs: 1_800_000, command: "node", args: ["r.ts"] });
  for (const bad of [[], ["--", ], ["nts"], ["--cpu", "0", "--", "x"], ["--idle", "soon", "--", "x"], ["--wall", "1", "--", "x"]]) {
    assert.throws(() => parseCaseBound(bad));
  }
});
