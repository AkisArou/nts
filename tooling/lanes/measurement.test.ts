// These gate helpers are exercised by all.sh's existing lanes/*.test.ts glob.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cpuList, formatCpus, gateCpus, inheritedCpus } from "../gate/affinity.ts";
import { coreIsQuiet, coreTicks, waitForQuiet } from "../gate/measurement.ts";

const WITH_LOCK = new URL("../gate/with-lock.sh", import.meta.url).pathname;
const PINNED = new URL("../gate/pinned.sh", import.meta.url).pathname;
const stat = (at: number, busy: number[] = []) => [0, 4, 5, 16].map((cpu) => {
  const user = busy.includes(cpu) ? at : 0;
  return `cpu${cpu} ${user} 0 0 ${at - user} 0 0 0 0 0 0`;
}).join("\n");

test("gate CPU sets are intersections, and an empty intersection is refused", () => {
  assert.equal(gateCpus("0-31"), "0-3,6-31");
  assert.equal(gateCpus("16-31"), "16-31");
  assert.equal(gateCpus("3-6,20"), "3,6,20");
  assert.throws(() => gateCpus("4-5"), /no CPUs/);
  for (const invalid of ["", "4-x", "9-2", "-1", "1,,2"]) assert.throws(() => cpuList(invalid));
  assert.equal(formatCpus([4, 2, 3, 2, 7]), "2-4,7");
});

test("quiet admission ignores other busy cores and rejects either busy sibling", async () => {
  for (const busy of [[0, 16], [4], [5]]) {
    let now = 0;
    const admitted = await waitForQuiet({
      read: () => coreTicks(stat(now, busy)),
      now: () => now,
      sleep: async (ms) => { now += ms; },
      quietMs: 30,
      timeoutMs: 90,
      sampleMs: 10,
    });
    assert.equal(admitted, busy[0] === 0);
    assert.equal(now, admitted ? 30 : 90);
  }
  assert.throws(() => coreTicks("cpu4 1 0 0 9 0 0 0 0"), /does not name/);
  const sample = coreTicks(stat(10));
  assert.equal(coreIsQuiet(sample, sample), false, "zero elapsed ticks are not proof of idle");
});

test("quiet admission needs a full quiet window after activity", async () => {
  let now = 0;
  const result = await waitForQuiet({
    read: () => coreTicks(`cpu4 ${Math.min(now, 20)} 0 0 ${Math.max(0, now - 20)} 0 0 0 0\ncpu5 0 0 0 ${now} 0 0 0 0`),
    now: () => now,
    sleep: async (ms) => { now += ms; },
    quietMs: 30,
    timeoutMs: 90,
    sampleMs: 10,
  });
  assert.equal(result, true);
  assert.equal(now, 50);
});

test("the wrapper releases its own lock after quiet timeout and command failure, preserving another holder", () => {
  const dir = mkdtempSync(join(tmpdir(), "nts-measurement-test-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    // Stub only quiet admission, not lock acquisition or the command. Pure
    // tests above drive the real timer and counters with a controlled clock.
    writeFileSync(join(bin, "node"), '#!/bin/sh\nexit "$TEST_QUIET_EXIT"\n');
    chmodSync(join(bin, "node"), 0o755);
    const lock = join(dir, "measurement.lock.d");
    const ran = join(dir, "ran");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NTS_MEASUREMENT_LOCK: lock, TEST_QUIET_EXIT: "75" };
    const command = ["-c", 'echo "$NTS_BENCH_CPUS" > "$1"; exit 7', "_", ran];
    let result = spawnSync("sh", [WITH_LOCK, "sh", ...command], { env, encoding: "utf8" });
    assert.equal(result.status, 75, result.stderr);
    assert.equal(existsSync(ran), false);
    assert.equal(existsSync(lock), false, "quiet timeout must release its lock");
    result = spawnSync("sh", [WITH_LOCK, "sh", ...command], { env: { ...env, TEST_QUIET_EXIT: "0" }, encoding: "utf8" });
    assert.equal(result.status, 7, result.stderr);
    assert.equal(readFileSync(ran, "utf8"), "4\n");
    assert.equal(existsSync(lock), false, "command failure must release its lock");
    rmSync(ran);
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), String(process.pid));
    result = spawnSync("sh", [WITH_LOCK, "sh", ...command], { env, encoding: "utf8" });
    assert.equal(result.status, 75);
    assert.equal(readFileSync(join(lock, "pid"), "utf8"), String(process.pid));
    assert.equal(existsSync(ran), false);
    // An actually stale holder is reclaimed; no process-name search.
    writeFileSync(join(lock, "pid"), "2147483647");
    result = spawnSync("sh", [WITH_LOCK, "sh", ...command], { env, encoding: "utf8" });
    assert.equal(result.status, 75);
    assert.match(result.stderr, /lock is stale/);
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pinned.sh restricts its own entry before invoking git or a build", { skip: process.platform !== "linux" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "nts-pinned-affinity-test-"));
  try {
    const log = join(dir, "mask");
    const git = join(dir, "git");
    writeFileSync(git, `#!/bin/sh\nawk '/^Cpus_allowed_list:/ {print $2}' /proc/self/status >> "$TEST_MASK_LOG"\nexit 23\n`);
    chmodSync(git, 0o755);
    const inherited = inheritedCpus();
    const eCore = cpuList(inherited).find((cpu) => cpu >= 16)!;
    assert.ok(eCore !== undefined);
    for (const mask of [inherited, String(eCore)]) {
      writeFileSync(log, "");
      const result = spawnSync("taskset", ["-c", mask, "sh", PINNED], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_MASK_LOG: log }, encoding: "utf8",
      });
      assert.notEqual(result.status, 0, "the git stub must prevent any build");
      const lines = readFileSync(log, "utf8").trim().split("\n");
      assert.ok(lines.length > 0);
      assert.ok(lines.every((line) => line === gateCpus(mask)), JSON.stringify({ lines, result }));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
