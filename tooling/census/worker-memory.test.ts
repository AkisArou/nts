import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("compiler reserves 32 GiB under a resident cap while executed programs retain RLIMIT_AS", (t) => {
  t.after(() => memoryRun().close());
  const code = "import mmap,resource; held=mmap.mmap(-1,32*1024**3,flags=mmap.MAP_PRIVATE|mmap.MAP_ANONYMOUS,prot=mmap.PROT_READ|mmap.PROT_WRITE); print(resource.getrlimit(resource.RLIMIT_AS)[0])";
  const tools = { memoryCapKb: 64 * 1024 };
  const before = spawnSync("sh", capped(tools, "python3", ["-c", code]), { encoding: "utf8" });
  assert.notEqual(before.status, 0, "the old compiler address cap rejects its virtual reservation");
  const compiled = compileSync(tools, "python3", ["-c", code], { encoding: "utf8", timeout: 10_000 });
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.equal(compiled.stdout.trim(), "-1", "compiler inherits no RLIMIT_AS");
  assert.equal(compiled.memoryKilled, false);
  const executed = spawnSync("sh", capped(tools, "python3", ["-c", "import resource; print(resource.getrlimit(resource.RLIMIT_AS)[0])"]), { encoding: "utf8" });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout.trim(), String(64 * 2 ** 20));
});

test("a compiler OOM loses only its in-flight case and restarts that worker", { timeout: 30_000 }, async (t) => {
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

test("aggregate OOM retains a survivor verdict and per-worker counters outlive scopes", { timeout: 30_000 }, async (t) => {
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
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent-nts-user-bus" }, timeout: 10_000 });
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes("UNCAPPED"));
  assert.match(result.stderr, /resident cap: user manager failed/);
});

test("a serial runner shares one scope across compiles and removes every cgroup", () => {
  const result = spawnSync(process.execPath, [join(HERE, "fixtures/resident-serial.ts")], { encoding: "utf8", timeout: 10_000 });
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
