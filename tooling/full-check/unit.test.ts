// node --test tooling/full-check/unit.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { BENCH_UNIT, COUNT_UNIT, countServiceText, countTimerText, lowPriority, parseUnitOptions, recordsUnitName, UNIT, unitText } from "./unit.ts";
import { layout } from "./state.ts";

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
  for (const setting of ["Restart=always", "Nice=19", "CPUWeight=20", "IOWeight=20", "CPUAffinity=0-3 6-31", "OOMScoreAdjust=500", "LimitCORE=0", "KillMode=control-group"]) {
    assert.ok(text.split("\n").includes(setting), setting);
  }
  assert.doesNotMatch(text, /^MemoryHigh=/m, "the ledger and OOM ranking must not be preempted by a stalling soft limit");
  line(/^Environment="SSH_AUTH_SOCK=\/run\/user\/1000\/ssh-%%agent"$/m);
  line(/^Environment="TZ=UTC"$/m);
  assert.doesNotMatch(text, /NODE_OPTIONS|SECRET_TOKEN/, "only the gate's host capabilities pass");
});

test("the hourly count is a service its own timer starts: once from the controller's tree, holding the tree's lock shared while it reads it", () => {
  const service = countServiceText({ node: "/opt/node/bin/node", layout: layout("/home/u/.cache"), env: ENV });
  const lines = service.split("\n");
  assert.ok(lines.includes(`ExecStart="flock" "--shared" "/home/u/.cache/nts-full-check/controller.lock" "/opt/node/bin/node" "/home/u/.cache/nts-full-check/controller/tooling/full-check/service.ts" "--count"`), service);
  for (const setting of ["Type=oneshot", "WorkingDirectory=/home/u/.cache/nts-full-check/controller", "TimeoutStartSec=30min", ...lowPriority()]) assert.ok(lines.includes(setting), setting);
  assert.ok(lines.includes('Environment="TZ=UTC"'));
  assert.doesNotMatch(service, /NODE_OPTIONS|SECRET_TOKEN|Restart=|\[Install\]/, "the timer starts it, and only the gate's host capabilities pass");
  const timer = countTimerText().split("\n");
  for (const setting of ["OnCalendar=hourly", "Persistent=true", `Unit=${COUNT_UNIT}.service`, "WantedBy=timers.target"]) assert.ok(timer.includes(setting), setting);
  assert.equal(COUNT_UNIT, `${UNIT}-count`);
});

test("each part's records unit and the nightly benchmarks' unit have one name, so a second cannot start while one runs, and every unit runs at the controller's priority", () => {
  assert.deepEqual([recordsUnitName("core"), recordsUnitName("wide"), BENCH_UNIT], ["nts-full-check-records-core", "nts-full-check-records-wide", "nts-full-check-bench"]);
  assert.deepEqual(lowPriority("0-3,6-31"), ["Nice=19", "CPUWeight=20", "IOWeight=20", "CPUAffinity=0-3,6-31", "OOMScoreAdjust=500", "LimitCORE=0"]);
});

test("the unit's options", () => {
  assert.deepEqual(parseUnitOptions(["--install", "--nightly-at=04:00"]),
    { install: true, schedule: { nightly: "04:00" } });
  assert.throws(() => parseUnitOptions(["--wide-at=12:00"]), /unknown argument/);
  assert.throws(() => parseUnitOptions(["--bench-wait=60"]), /unknown argument/, "the benchmarks stay due until the next nightly slot; no wait bounds them");
  assert.throws(() => parseUnitOptions(["--memory-high=lots"]), /unknown argument/);
  assert.throws(() => parseUnitOptions(["--memory-high=16G"]), /unknown argument/, "a caller cannot restore MemoryHigh");
});
