// First-run job accounting, through the real CLI in owned units. The watcher
// publishes its observed peak, which is the event releasing the held command.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { gateEnvironment, hostEnvironment } from "./canonical-environment.ts";
import { jobSizing, ledgerStatus, readLedger } from "./memory-ledger.ts";
import { readCostHistory, peakReservation } from "./step-scheduling.ts";
import { removable } from "./run-temporary.ts";
import { ownMemory } from "./test-memory.ts";
import { newTestScratch } from "./test-scratch.ts";
import { waitFor } from "./test-wait.ts";
import { toolingSliceArgs } from "./tooling-slice.ts";

const ADMIT = fileURLToPath(new URL("./admit.ts", import.meta.url));
const MiB = 2 ** 20;

function fixture(t: TestContext) {
  const root = newTestScratch("job-live-memory"), units: string[] = [];
  const memory = ownMemory(join(root, "memory"), { availableKiB: 2.5 * 2 ** 20, totalKiB: 32 * 2 ** 20 });
  const env = gateEnvironment(hostEnvironment(process.env), { run: join(root, "canonical"), standalone: true, owned: memory }).env;
  t.after(() => {
    for (const unit of units) spawnSync("systemctl", ["--user", "stop", unit], { stdio: "ignore" });
    removable(root); rmSync(root, { recursive: true, force: true });
  });
  const start = (body: string, args: string[] = []) => {
    const unit = `nts-test-live-job-${randomUUID()}`; units.push(unit);
    const setenv = Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined).map(([key, value]) => `--setenv=${key}=${value}`);
    const child = spawn("systemd-run", ["--user", ...toolingSliceArgs(), `--unit=${unit}`, "--collect", "--quiet", "--wait", "--pipe",
      "--property=LimitCORE=0", "--property=Nice=19", "--property=CPUAffinity=0-3 6-31", "--property=TimeoutStopSec=5s", "--property=RuntimeMaxSec=300s",
      ...setenv, process.execPath, ADMIT, "--key", "perf-count", "--", process.execPath, "-e", body, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.setEncoding("utf8").on("data", data => { out += data; }); child.stderr.setEncoding("utf8").on("data", data => { err += data; });
    return { done: once(child, "close"), ended: () => child.exitCode !== null ? `unit exited ${child.exitCode}: ${err}` : undefined,
      get stdout() { return out; }, get stderr() { return err; } };
  };
  return { root, memory, start };
}

test("an unknown CLI job starts beside a large unrelated history, is charged live, records its peak at unit exit and uses it next time", async t => {
  const f = fixture(t), release = join(f.root, "release"), ready = join(f.root, "ready");
  mkdirSync(f.memory.NTS_GATE_COSTS_DIR, { recursive: true });
  const history = join(f.memory.NTS_GATE_COSTS_DIR, "steps.json");
  writeFileSync(history, JSON.stringify({ version: 3, steps: {}, jobs: { unrelated: { unit: "worker", peaks: [12 * 2 ** 30] } } }));
  writeFileSync(release, "");
  assert.deepEqual([jobSizing({ key: "perf-count" }, f.memory).bytes, jobSizing({ key: "perf-count" }, f.memory).basis], [0, "live"]);
  const first = f.start("const fs=require('node:fs'),held=Buffer.alloc(160*2**20,1);const watcher=fs.watch(process.argv[1],()=>watcher.close());fs.writeFileSync(process.argv[2],'ready');process.on('exit',()=>process.stdout.write(String(held.length)));", [release, ready]);
  await waitFor("the live command and its watcher to observe the allocation", () => existsSync(ready)
    && (readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.find(entry => entry.live)?.sampledPeak ?? 0) >= 160 * MiB, { stopped: first.ended });
  const status = ledgerStatus({ env: f.memory }), entry = status.admitted.find(entry => entry.live)!;
  assert.equal(entry.liveUse, true);
  assert.equal(entry.bytes, peakReservation([entry.used_bytes]));
  assert.equal(status.pending_bytes, entry.bytes - entry.used_bytes);
  assert.ok(entry.bytes < 512 * MiB, "the unrelated 12GiB peak was never reserved");
  writeFileSync(release, "finish");
  assert.deepEqual(await first.done, [0, null], first.stderr);
  const measured = readCostHistory(history).jobs.get("perf-count")!;
  assert.ok(measured?.peaks.at(-1)! >= 160 * MiB, "unit exit flushes the observed peak");
  assert.equal(first.stdout, String(160 * MiB));
  assert.deepEqual([jobSizing({ key: "perf-count" }, f.memory).basis, jobSizing({ key: "perf-count" }, f.memory).bytes], ["measured", peakReservation(measured.peaks)]);
  const second = f.start("const fs=require('node:fs'),path=require('node:path');const entry=JSON.parse(fs.readFileSync(path.join(process.env.NTS_MEMORY_LEDGER,'admitted',process.env.NTS_MEMORY_RESERVATION+'.json'),'utf8'));process.stdout.write(JSON.stringify({live:entry.liveUse??false,bytes:entry.bytes}));");
  assert.deepEqual(await second.done, [0, null], second.stderr);
  assert.deepEqual(JSON.parse(second.stdout), { live: false, bytes: peakReservation(measured.peaks) });
});
