import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { testScratch } from "../gate/test-scratch.ts";
import { ToolingInstrumentError } from "../gate/step-result.ts";
import { launchCpu } from "./host-columns.ts";
import { buildLauncher, environmentDigest, launchEnvironment, launchSitting, parseLaunches, type LaunchRequest } from "./launcher.ts";

/** Any CPU a test may use (none of the measurement pair outside the lock): the timer itself is pinned to it. */
const testCpu = (): number => launchCpu();
const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

function sitting(t: { after(fn: () => void): void }, columns: LaunchRequest["columns"], warmups = 1, launches = 3, bounds?: LaunchRequest["bounds"]) {
  const directory = testScratch(t, "launch-timer");
  const launcher = buildLauncher(join(directory, "bin"), String(testCpu()));
  return launchSitting({ launcher, cpu: testCpu(), cwd: directory, environment: launchEnvironment(join(directory, "env")),
    columns, warmups, launches, out: join(directory, "sitting"), ...(bounds ? { bounds } : {}) });
}

test("each launch is timed from spawn to its own reaping, in rotating rounds", async (t) => {
  const result = await sitting(t, [{ label: "true", argv: ["/bin/true"] }, { label: "sleep", argv: ["/bin/sh", "-c", "sleep 0.05"] }]);
  const [fast, slow] = result.columns as [typeof result.columns[0], typeof result.columns[0]];
  assert.equal(fast.details.warmups.length, 1);
  assert.equal(fast.details.launches.length, 3);
  for (const launch of slow.details.launches) assert.ok(launch.wallNanoseconds >= 50_000_000, "a sleeping child is timed until it exits");
  for (const launch of fast.details.launches) {
    assert.ok(launch.wallNanoseconds < 50_000_000);
    assert.equal(launch.status, 0);
    assert.ok(launch.maxRssKib > 0, "wait4 reports the child's own peak");
  }
  assert.equal(fast.details.stdoutSha256, sha256(""));
});

test("a child's exit status, its signal and a launch past its wall bound are observations", async (t) => {
  const result = await sitting(t, [
    { label: "three", argv: ["/bin/sh", "-c", "echo out; echo err >&2; exit 3"] },
    { label: "killed", argv: ["/bin/sh", "-c", "kill -9 $$"] },
  ], 0, 1);
  const [three, killed] = result.columns as [typeof result.columns[0], typeof result.columns[0]];
  assert.equal(three.details.launches[0]!.status, 3);
  assert.equal(three.stdout, "out\n");
  assert.equal(three.stderr, "err\n");
  assert.equal(killed.details.launches[0]!.status, null);
  assert.equal(killed.details.launches[0]!.signal, 9);
  const hung = await sitting(t, [{ label: "hang", argv: ["/bin/sh", "-c", "sleep 30"] }], 0, 1, { cpuSeconds: 5, wallSeconds: 1 });
  const launch = hung.columns[0]!.details.launches[0]!;
  assert.equal(launch.timedOut, true);
  assert.equal(launch.signal, 9);
  assert.ok(launch.wallNanoseconds < 10_000_000_000);
});

test("output goes to a file read after reaping, so a child never blocks on it, and the environment is exactly the sitting's", async (t) => {
  const result = await sitting(t, [
    { label: "large", argv: ["/usr/bin/head", "-c", "4194304", "/dev/zero"] },
    { label: "env", argv: ["/usr/bin/env"] },
  ], 0, 1);
  assert.equal(result.columns[0]!.details.launches[0]!.status, 0);
  assert.equal(result.columns[0]!.details.stdoutSha256, sha256(Buffer.alloc(4194304)));
  const printed = result.columns[1]!.stdout.trim().split("\n").sort();
  assert.deepEqual(printed, Object.entries(result.environment).map(([key, value]) => `${key}=${value}`).sort());
  assert.equal(result.environmentSha256, environmentDigest(result.environment));
  for (const key of ["NODE_OPTIONS", "NODE_COMPILE_CACHE", "BUN_RUNTIME_TRANSPILER_CACHE_PATH"]) assert.ok(!printed.some((line) => line.startsWith(key + "=")));
});

test("control: a launch that cannot start or output that is not the protocol is an instrument error, never a value", async (t) => {
  await assert.rejects(sitting(t, [{ label: "missing", argv: ["/nonexistent/program"] }], 0, 1), (error: unknown) =>
    error instanceof ToolingInstrumentError && /cannot launch: \/nonexistent\/program/.test(error.message));
  await assert.rejects(sitting(t, [{ label: "relative", argv: ["true"] }], 0, 1), ToolingInstrumentError);
  const request = { cpu: 7, cwd: "/", environment: { PATH: "/usr/bin" }, columns: [{ label: "x", argv: ["/bin/true"] }], warmups: 0, launches: 2 };
  const read = () => Buffer.alloc(0);
  const good = "nts-launch 1 cpu=7 columns=1 rounds=2\nL 0 0 0 1000 1 0 0 1 1 1\nL 0 1 0 1200 1 0 0 1 1 1\nend 2\n";
  assert.equal(parseLaunches(good, request, read)[0]!.details.launches.length, 2);
  for (const bad of [
    good.replace("end 2", "end 1"),
    good.replace("L 0 1 0 1200 1 0 0 1 1 1\n", ""),
    good.replace("1200", "-5"),
    good.replace("1200", "0"),
    good.replace("L 0 1 0", "L 1 1 0"),
    good.replace("L 0 0 0", "L 0 0 1"),
    good.replace("cpu=7", "cpu=4"),
    "",
  ]) assert.throws(() => parseLaunches(bad, request, read), ToolingInstrumentError, JSON.stringify(bad));
});
