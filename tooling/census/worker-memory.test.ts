import { spawnTest, testProcessResult, TEST_HANG_MS } from "../gate/test-wait.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { capped } from "./attempt262.ts";
import { compileSync, MemoryRun, memoryRun } from "./worker-memory.ts";
import { runMemoryWorkers } from "./worker-pool.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = join(HERE, "fixtures/resident-worker.ts");
const CGROUP = "/sys/fs/cgroup";
const scratch = () => {
  const root = join(homedir(), ".cache/nts-scratch/resident-tests");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "run-"));
};
const kills = (group: string) => Number(/^oom_kill (\d+)$/m.exec(readFileSync(join(CGROUP, group, "memory.events"), "utf8"))![1]);

test("a real step records its aggregate memory.peak before the cgroup is removed", { timeout: TEST_HANG_MS }, t => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const costs = join(directory, "costs"); mkdirSync(costs);
  const module = new URL("./worker-memory.ts", import.meta.url).href;
  const code = `import { MemoryRun } from ${JSON.stringify(module)};
import { readFileSync } from 'node:fs';
import {spawnTest} from ${JSON.stringify(new URL("../gate/test-wait.ts",import.meta.url).href)};
const run = new MemoryRun({ budgetBytes: 128 * 2 ** 20 });
let peak;
try {
 const worker = run.worker(0, 128 * 2 ** 20);
 const scope = worker.scope('python3', ['-c', 'held=bytearray(24*1024**2); print(len(held))']);
 const child = spawnTest('systemd-run', scope.argv, { env: scope.env, encoding: 'utf8',});
 if (child.status !== 0) throw new Error(child.stderr);
 peak = Number(readFileSync('/sys/fs/cgroup' + run.group + '/memory.peak', 'utf8'));
} finally { run.close(); }
console.log(JSON.stringify({ peak, group: run.group }));`;
  const result = spawnTest(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8",
    env: { ...process.env, NTS_GATE_RUN_DIR: directory, NTS_GATE_CASE_COSTS_DIR: costs, NTS_GATE_STEP: "peak-control" } });
  assert.equal(result.status, 0, result.stderr);
  const { peak, group } = JSON.parse(result.stdout);
  const files = readdirSync(costs); assert.equal(files.length, 1);
  const observation = JSON.parse(readFileSync(join(costs, files[0]), "utf8"));
  assert.equal(observation.peak_bytes, peak);
  assert.ok(peak >= 24 * 2 ** 20 && peak <= 128 * 2 ** 20);
  assert.equal(observation.scope_budget_bytes, 128 * 2 ** 20);
  assert.equal(observation.step, "peak-control");
  assert.equal(existsSync(join(CGROUP, group)), false);
});

test("compiler reserves 32 GiB under a resident cap while executed programs retain RLIMIT_AS", (t) => {
  t.after(() => memoryRun().close());
  const code = "import mmap,resource; held=mmap.mmap(-1,32*1024**3,flags=mmap.MAP_PRIVATE|mmap.MAP_ANONYMOUS,prot=mmap.PROT_READ|mmap.PROT_WRITE); print(resource.getrlimit(resource.RLIMIT_AS)[0])";
  const tools = { memoryCapKb: 64 * 1024 };
  const before = spawnTest("sh", capped(tools, "python3", ["-c", code]), { encoding: "utf8" });
  assert.notEqual(before.status, 0, "the old compiler address cap rejects its virtual reservation");
  const compiled = testProcessResult(compileSync(tools, "python3", ["-c", code], { encoding: "utf8", timeout: TEST_HANG_MS }), "the resident compiler control");
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.equal(compiled.stdout.trim(), "-1", "compiler inherits no RLIMIT_AS");
  assert.equal(compiled.memoryKilled, false);
  const executed = spawnTest("sh", capped(tools, "python3", ["-c", "import resource; print(resource.getrlimit(resource.RLIMIT_AS)[0])"]), { encoding: "utf8" });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout.trim(), String(64 * 2 ** 20));
});

test("a compiler OOM loses only its in-flight case and restarts that worker", { timeout: TEST_HANG_MS }, async (t) => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = new MemoryRun({ budgetBytes: 192 * 2 ** 20, id: "worker-oom-control" });
  const rows: any[] = [];
  await runMemoryWorkers({
    paths: ["before", "oom", "after"], jobs: 1, memory, workerBytes: 96 * 2 ** 20,
    args: () => [fixture, directory], onRow: (row) => rows.push(row),
  });
  assert.deepEqual(rows.map((row) => [row.path, row.bucket]), [["before", "strict-pass"], ["oom", "memory-cap"], ["after", "strict-pass"]]);
  assert.notEqual(rows[0].pid, rows[2].pid, "next case uses a fresh process");
  assert.equal(existsSync(join(CGROUP, memory.group)), false, "run cgroup is removed");
});

test("aggregate OOM retains a survivor verdict and per-worker counters outlive scopes", { timeout: TEST_HANG_MS }, async (t) => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = new MemoryRun({ budgetBytes: 256 * 2 ** 20, id: "aggregate-oom-control" });
  const rows: any[] = [];
  let deltas: number[] = [];
  let aggregate = 0;
  await runMemoryWorkers({
    paths: ["survivor", "victim", "after"], jobs: 2, memory, workerBytes: 192 * 2 ** 20,
    args: () => [fixture, directory],
    onRow: (row) => {
      rows.push(row);
      if (row.bucket === "memory-cap") writeFileSync(join(directory, "release"), "ready");
      deltas = readdirSync(join(CGROUP, memory.group)).filter((name) => name.endsWith(".slice")).map((name) => kills(join(memory.group, name))).sort();
      aggregate = memory.aggregateOoms();
    },
  });
  assert.deepEqual(rows.map((row) => [row.path, row.bucket]).sort(), [["after", "strict-pass"], ["survivor", "strict-pass"], ["victim", "memory-cap"]]);
  assert.deepEqual(deltas, [0, 1], "only the actual killed worker increments oom_kill");
  assert.ok(aggregate > 0, "the aggregate ceiling, not a worker ceiling, fired");
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
});

test("an unavailable user bus refuses to compile instead of running uncapped", () => {
  const module = new URL("./worker-memory.ts", import.meta.url).href;
  const code = `import {compileSync} from ${JSON.stringify(module)}; compileSync({memoryCapKb:65536},"sh",["-c","echo UNCAPPED"],{encoding:"utf8"});`;
  const result = spawnTest(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent-nts-user-bus" },});
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes("UNCAPPED"));
  assert.match(result.stderr, /resident cap: user manager failed/);
});

test("a serial runner shares one scope across compiles and removes every cgroup", () => {
  const result = spawnTest(process.execPath, [join(HERE, "fixtures/resident-serial.ts")], { encoding: "utf8",});
  assert.equal(result.status, 0, result.stderr);
  const { groups, own, boundary } = JSON.parse(result.stdout);
  assert.deepEqual(groups, [own, own]);
  assert.equal(existsSync(join(CGROUP, boundary)), false);
  assert.equal(existsSync(join(CGROUP, dirname(boundary))), false);
});

test("byte budgets accept kernel page rounding while never exceeding the reservation", () => {
  const budget = 193 * 2 ** 20 + 13;
  const memory = new MemoryRun({ budgetBytes: budget, id: "page-rounding-control" });
  try {
    const worker = memory.worker("round", 96 * 2 ** 20 + 17);
    for (const [group, reserved] of [[memory.group, budget], [worker.group, worker.bytes]] as const) {
      const limit = Number(readFileSync(join(CGROUP, group, "memory.max"), "utf8"));
      assert.ok(limit > 0 && limit <= reserved);
      assert.equal(readFileSync(join(CGROUP, group, "memory.swap.max"), "utf8").trim(), "0");
    }
  } finally {
    memory.close();
  }
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
});

test("a closed worker cannot recreate an uncapped parent slice", () => {
  const memory = new MemoryRun({ budgetBytes: 192 * 2 ** 20, id: "closed-worker-control" });
  const worker = memory.worker("closed", 96 * 2 ** 20);
  memory.close();
  assert.throws(() => worker.scope(process.execPath, []), /worker is closed/);
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
});

// A queued job and a lagging ControlGroup property, without changing the real
// manager. Patches live only in a short-lived child, never in peer processes.
async function fakeManager(mode, module) {
  const { default: fs } = await import("node:fs");
  const { default: cp } = await import("node:child_process");
  const { syncBuiltinESMExports } = await import("node:module");
  const original = { spawn: cp.spawnSync, read: fs.readFileSync, exists: fs.existsSync };
  const units = new Map();
  const calls = [];
  let root, rootLookups = 0;
  const response = (stdout = "", status = 0, stderr = "") => ({ stdout, stderr, status });
  cp.spawnSync = (command, args, options) => {
    if (command === "busctl") {
      let at = args.indexOf("StartTransientUnit");
      if (at >= 0) {
        const unit = args[at + 2]; root ??= unit;
        const group = `/fake-user/${root}${unit === root ? "" : `/${unit}`}`;
        units.set(unit, { unit, group, bytes: Number(args[args.indexOf("MemoryMax") + 2]), ready: false, reads: 0 });
        calls.push(`create:${unit}`);
        return response('o "/fake-job"');
      }
      at = args.indexOf("StopUnit");
      if (at >= 0) {
        const unit = args[at + 2];
        calls.push(`stop:${unit}`);
        if (mode === "failed-cleanup" && unit !== root) return response("", 1, "injected cleanup failure");
        const held = units.get(unit);
        for (const [name, row] of units) if (name === unit || held && row.group.startsWith(held.group + "/")) units.delete(name);
        return response('o "/fake-stop-job"');
      }
    }
    if (command === "systemctl") {
      const operation = args[1], unit = args[2], row = units.get(unit);
      calls.push(`${operation}:${unit}`);
      if (operation === "start") {
        if (mode === "failed-cleanup" && unit !== root) return response("", 1, "injected start failure");
        row.ready = true;
        return response();
      }
      if (operation === "show") {
        if (!row.ready) throw new Error("ControlGroup read before joining start job");
        row.reads++;
        if (mode === "always-empty" && unit !== root || mode === "empty-once" && row.reads === 1) return response();
        return response(mode === "wrong-parent" && unit !== root ? `/someone-else/${unit}` : row.group);
      }
    }
    return original.spawn(command, args, options);
  };
  fs.existsSync = path => {
    const text = String(path);
    if (text === "/sys/fs/cgroup" || text === "/sys/fs/cgroup/") { rootLookups++; throw new Error("cgroup root was checked"); }
    if (text.startsWith("/sys/fs/cgroup/")) return [...units.values()].some(row => text === "/sys/fs/cgroup" + row.group);
    return original.exists(path);
  };
  fs.readFileSync = (path, ...args) => {
    const text = String(path);
    if (text.startsWith("/sys/fs/cgroup/")) {
      const row = [...units.values()].find(row => text === "/sys/fs/cgroup" + row.group + "/memory.max" || text === "/sys/fs/cgroup" + row.group + "/memory.swap.max");
      if (!row) throw new Error(`unexpected kernel read ${text}`);
      return text.endsWith("memory.max") ? String(row.bytes) : "0";
    }
    return original.read(path, ...args);
  };
  syncBuiltinESMExports();
  const { MemoryRun } = await import(module);
  const run = new MemoryRun({ budgetBytes: 128 * 2 ** 20, id: "fake-manager" });
  let error = null, group = null;
  try { group = run.worker(0, 64 * 2 ** 20).group; }
  catch (caught) { error = String(caught); }
  finally { run.close(); }
  process.stdout.write(JSON.stringify({ error, group, calls, rootLookups, remaining: units.size }));
}

for (const mode of ["empty-once", "always-empty", "wrong-parent", "failed-cleanup"]) {
  test(`slice setup with fake manager: ${mode}`, () => {
    const code = `(${fakeManager.toString()})(${JSON.stringify(mode)},${JSON.stringify(new URL("./worker-memory.ts", import.meta.url).href)});`;
    const result = spawnTest(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8",});
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.equal(actual.rootLookups, 0);
    assert.equal(actual.remaining, 0);
    if (mode === "empty-once") {
      assert.equal(actual.error, null);
      assert.ok(actual.group.endsWith("-w0.slice"));
    } else if (mode === "failed-cleanup") {
      assert.match(actual.error, /injected start failure/);
      assert.match(actual.error, /injected cleanup failure/);
    } else {
      assert.match(actual.error, /resident cap: .*?-w0.slice has no valid ControlGroup/);
      assert.doesNotMatch(actual.error, /cgroup was not removed/);
    }
  });
}
