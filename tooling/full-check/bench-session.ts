// The session owns a unit for everything it starts, including nested build
// supervisors. A budget ends that unit before the durable prefix is sealed.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { finishBudget } from "../bench/run-session.ts";
import { readJournal } from "../bench/run-journal.ts";
import { toolingSliceArgs } from "../gate/tooling-slice.ts";
import type { BenchAttempt } from "./bench.ts";
import { lowPriority } from "./unit.ts";
import { systemdEnvironment } from "../gate/environment.ts";
import { gateEnvironment, sealOracleRun } from "../gate/canonical-environment.ts";
import { finishRunTemporary } from "../gate/run-temporary.ts";

// The containing job's eight-hour guard is only for a runaway, including
// finalization. Admission and waiting for the reserved core spend this budget.
export const BENCH_SESSION_BUDGET_MS = 7.5 * 60 * 60_000;
export const SESSION_OUTCOME = "session.outcome.json";

export async function runSession(tree: string, run: string, binary: string, history: string,
  ownerUnit: string, budgetMs = BENCH_SESSION_BUDGET_MS, journal = join(run, `bench-${randomUUID()}.jsonl`)): Promise<BenchAttempt> {
  assert.match(ownerUnit, /^[a-zA-Z0-9_-]+$/);
  assert.ok(Number.isFinite(budgetMs) && budgetMs > 0, "session budget must be positive");
  assert.equal(spawnSync("systemctl", ["--user", "is-active", "--quiet", ownerUnit]).status, 0,
    "the benchmark session must belong to a running unit");
  const unit = `nts-bench-session-${randomUUID()}`;
  // The unit gets fresh systemd metadata. Its command gets a canonical handoff,
  // including owned temporary storage and any test-owned memory observations.
  const planned = gateEnvironment(process.env, { run: join(run, unit), standalone: !process.env.NTS_GATE_ENV_CONTEXT,
    owned: { NTS_MEMORY_PRIORITY: "full-check", NTS_GATE_COSTS_DIR: history } });
  const sealed = await sealOracleRun(planned);
  const handoff = join(run, `${unit}.command.json`);
  writeFileSync(handoff, JSON.stringify({ cwd: tree, env: sealed.env, command: ["sh", join(tree, "tooling/gate/with-lock.sh"), "--key", "bench-session", binary, "--root", tree, "--journal", journal] }));
  const child = spawn("systemd-run", ["--user", ...toolingSliceArgs(), `--unit=${unit}`, "--collect", "--quiet", "--wait", "--pipe",
    ...lowPriority().map(setting => `--property=${setting}`), "--property=TimeoutStopSec=5s",
    `--property=BindsTo=${ownerUnit}.service`, `--property=After=${ownerUnit}.service`,
    `--working-directory=${tree}`, ...systemdEnvironment(), "--setenv=NTS_MEMORY_PRIORITY=full-check", `--setenv=NTS_GATE_COSTS_DIR=${history}`,
    process.execPath, fileURLToPath(import.meta.url), "--measure", handoff], { stdio: "inherit" });
  let exhausted = false;
  const stop = () => {
    const stopped = spawnSync("systemctl", ["--user", "stop", unit], { encoding: "utf8" });
    if (stopped.status !== 0 && !stopped.stderr.includes("not loaded")) throw new Error(`cannot stop ${unit}: ${stopped.stderr}`);
  };
  const timer = setTimeout(() => {
    exhausted = true;
    try { stop(); } catch (error) { console.error("benchmark budget could not stop its unit; waiting for its outcome:", error); }
  }, budgetMs);
  let status: number;
  try {
    status = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve(code ?? 1)); });
  } finally {
    clearTimeout(timer);
    rmSync(handoff, { force: true });
    finishRunTemporary(planned.temporary, planned.env.HOME!, true);
  }
  if (!exhausted) return status === 75 ? { admitted: false, reason: "not admitted" } : { admitted: true, status };

  let record: string | undefined;
  let unreached = readdirSync(join(tree, "benchmarks/cases"), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  try {
    if (existsSync(journal)) {
      unreached = readJournal(journal).unreached;
      record = finishBudget(tree, journal, budgetMs).record;
    }
  } catch (error) { console.error("benchmark prefix could not be retained:", error); }
  console.error(`benchmarks: session time budget exhausted; unreached: ${unreached.join(", ") || "(none)"}`);
  return { admitted: true, status: 124, budget: { milliseconds: budgetMs, unreached }, ...(record ? { record } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--measure") {
    const request = JSON.parse(readFileSync(process.argv[3], "utf8"));
    process.exitCode = spawnSync(request.command[0], request.command.slice(1), { cwd: request.cwd, env: request.env, stdio: "inherit" }).status ?? 1;
  } else {
    const [tree, run, binary, history, ownerUnit, budget] = process.argv.slice(2);
    try {
    const outcome = await runSession(tree, run, binary, history, ownerUnit, budget === undefined ? undefined : Number(budget));
    writeFileSync(join(run, SESSION_OUTCOME), JSON.stringify(outcome));
    process.exitCode = outcome.admitted ? outcome.status : 75;
    } catch (error) { console.error(error); process.exitCode = 1; }
  }
}
