// node --test tooling/full-check/unit.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { BENCH_UNIT, COUNT_UNIT, countServiceText, countTimerText, lowPriority, parseUnitOptions, recordsUnitName, UNIT, unitText } from "./unit.ts";
import { layout } from "./state.ts";
import { CPU_WEIGHT } from "../gate/ranks.ts";
import { hostTool } from "../gate/toolchain.ts";
import { infrastructureProbes } from "../gate/infrastructure-probe.ts";
import { fixtureEnvironment } from "../gate/test-environment.ts";
import { testScratch } from "../gate/test-scratch.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnTest } from "../gate/test-wait.ts";
import { generatedJavaScript } from "../gate/generated-javascript.ts";

const ENV = { PATH: "/usr/bin:/home/u/.cargo/bin", HOME: "/home/u", SSH_AUTH_SOCK: "/run/user/1000/ssh-%agent", NODE_OPTIONS: "--inspect", SECRET_TOKEN: "x" };

test("the unit runs the service from its controller at low priority, off the measurement CPUs, with the schedule on its command line", () => {
  const text = unitText({
    node: "/opt/node 24/bin/node",
    layout: layout("/home/u/.cache"),
    schedule: { nightly: "03:00" },
    env: ENV,
  });
  const line = (pattern: RegExp) => assert.match(text, pattern);
  line(/^ExecStart="\/opt\/node 24\/bin\/node" "\/home\/u\/\.cache\/nts-full-check\/controller\/tooling\/full-check\/service\.ts" "--nightly-at=03:00"$/m);
  line(/^WorkingDirectory=\/home\/u\/\.cache\/nts-full-check\/controller$/m);
  for (const setting of ["Restart=always", "Nice=19", "CPUWeight=10", "IOWeight=20", "CPUAffinity=0-3 6-31", "OOMScoreAdjust=500", "LimitCORE=0", "KillMode=control-group"]) {
    assert.ok(text.split("\n").includes(setting), setting);
  }
  assert.doesNotMatch(text, /^MemoryHigh=/m, "the ledger and OOM ranking must not be preempted by a stalling soft limit");
  line(/^Environment="SSH_AUTH_SOCK=\/run\/user\/1000\/ssh-%%agent"$/m);
  line(/^Environment="TZ=UTC"$/m);
  assert.doesNotMatch(text, /NODE_OPTIONS|SECRET_TOKEN/, "only the gate's host capabilities pass");
});

test("the hourly count is a service its own timer starts: once from the controller's tree, holding the tree's lock shared while it reads it", () => {
  const service = countServiceText({ flock: "/opt/host tools/bin/flock", node: "/opt/node/bin/node", layout: layout("/home/u/.cache"), env: ENV });
  const lines = service.split("\n");
  assert.ok(lines.includes(`ExecStart="/opt/host tools/bin/flock" "--shared" "/home/u/.cache/nts-full-check/controller.lock" "/opt/node/bin/node" "/home/u/.cache/nts-full-check/controller/tooling/full-check/service.ts" "--count"`), service);
  for (const setting of ["Type=oneshot", "WorkingDirectory=/home/u/.cache/nts-full-check/controller", "TimeoutStartSec=30min", ...lowPriority()]) assert.ok(lines.includes(setting), setting);
  assert.ok(lines.includes('Environment="TZ=UTC"'));
  assert.doesNotMatch(service, /NODE_OPTIONS|SECRET_TOKEN|Restart=|\[Install\]/, "the timer starts it, and only the gate's host capabilities pass");
  const timer = countTimerText().split("\n");
  for (const setting of ["OnCalendar=hourly", "Persistent=true", `Unit=${COUNT_UNIT}.service`, "WantedBy=timers.target"]) assert.ok(timer.includes(setting), setting);
  assert.equal(COUNT_UNIT, `${UNIT}-count`);
});

test("unit generation refuses every relative executable, including node beneath flock", () => {
  const options = { node: "/opt/node/bin/node", flock: "/usr/bin/flock", layout: layout("/home/u/.cache"), schedule: { nightly: "03:00" }, env: ENV };
  for (const path of ["node", "./bin/node", ""]) {
    assert.throws(() => unitText({ ...options, node: path }), /unit executable node must be absolute/);
    assert.throws(() => countServiceText({ ...options, node: path }), /unit executable node must be absolute/);
  }
  for (const path of ["flock", "./bin/flock", ""]) {
    assert.throws(() => countServiceText({ ...options, flock: path }), /unit executable flock must be absolute/);
  }
});

test("the installer's host tool resolver retains an absolute PATH executable and refuses relative or missing answers", t => {
  const root = testScratch(t, "unit-tools"), bin = join(root, "host tools");
  mkdirSync(bin);
  writeFileSync(join(bin, "flock"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  // Even a regressed install must never reach Git or the user's manager.
  const calls = join(root, 'forbidden-calls.jsonl');
  for (const command of Object.keys({ git: true, systemctl: true })) writeFileSync(join(bin, command), generatedJavaScript(`#!${process.execPath}
import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(calls)},JSON.stringify({command:${JSON.stringify(command)},args:process.argv.slice(2)})+'\\n');
process.stderr.write('unexpected unit installer command: '+${JSON.stringify(command)}+'\\n');process.exitCode=1;
`), { mode: 0o755 });
  const env = fixtureEnvironment(t, { PATH: bin + ":/usr/bin", NTS_GATE_STEP_RESULT: undefined });
  assert.equal(hostTool("flock", env), join(bin, "flock"));
  const entry = fileURLToPath(new URL('./unit.ts', import.meta.url));
  const printed = spawnTest(process.execPath, [entry], { env, encoding: "utf8" });
  assert.equal(printed.status, 0, printed.stderr);
  assert.ok(printed.stdout.includes(`ExecStart="${join(bin, 'flock')}" "--shared"`), printed.stdout);
  // Supply a relative result and prove --install refuses before any Git call.
  writeFileSync(join(bin, "sh"), "#!/bin/sh\nprintf '%s\\n' 'flock'\n", { mode: 0o755 });
  const relative = spawnTest(process.execPath, [entry, "--install"], { env, encoding: "utf8" });
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /host tool flock must resolve to an absolute executable: "flock"/);
  assert.equal(existsSync(calls), false, 'no Git or systemctl invocation before refusing the relative executable');
  assert.equal(existsSync(join(env.HOME!, '.config/systemd/user')), false, 'no unit files written');
  // The remaining controls use the real shell supplied before this shim.
  const realEnv = { ...env, PATH: "/usr/bin" };
  for (const answer of ["flock", "./bin/flock", "", "/bin/flock\n/bin/other"]) {
    const probe = infrastructureProbes((command, args, options) => {
      assert.equal(command, "sh");
      assert.deepEqual(args, ["-c", 'command -v "$1"', "sh", "flock"]);
      assert.equal(options.env, env);
      return { pid: 0, output: [null, answer, ""], stdout: answer, stderr: "", status: 0, signal: null };
    });
    assert.throws(() => hostTool("flock", env, probe), /host tool flock must resolve to an absolute executable/);
  }
  assert.throws(() => hostTool("nts-missing-unit-tool", realEnv), /locate host tool nts-missing-unit-tool.*exited (?:1|127)/);
});

test("each part's records unit and the nightly benchmarks' unit have one name, so a second cannot start while one runs, and every unit runs at the controller's priority", () => {
  assert.deepEqual([recordsUnitName("core"), recordsUnitName("wide"), BENCH_UNIT], ["nts-full-check-records-core", "nts-full-check-records-wide", "nts-full-check-bench"]);
  assert.deepEqual(lowPriority("0-3,6-31"), ["Nice=19", `CPUWeight=${CPU_WEIGHT["full-check"]}`, "IOWeight=20", "CPUAffinity=0-3,6-31", "OOMScoreAdjust=500", "LimitCORE=0"]);
  assert.equal(CPU_WEIGHT["full-check"], 10, "the full check's units carry the lowest rank's CPU weight");
});

test("the unit's options", () => {
  assert.deepEqual(parseUnitOptions(["--install", "--nightly-at=04:00"]),
    { install: true, schedule: { nightly: "04:00" } });
  assert.throws(() => parseUnitOptions(["--wide-at=12:00"]), /unknown argument/);
  assert.throws(() => parseUnitOptions(["--bench-wait=60"]), /unknown argument/, "the benchmarks stay due until the next nightly slot; no wait bounds them");
  assert.throws(() => parseUnitOptions(["--memory-high=lots"]), /unknown argument/);
  assert.throws(() => parseUnitOptions(["--memory-high=16G"]), /unknown argument/, "a caller cannot restore MemoryHigh");
});
