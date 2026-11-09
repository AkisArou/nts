// node --test tooling/full-check/unit.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUnitOptions, unitText } from "./unit.ts";
import { layout } from "./state.ts";

test("the unit runs the service from its controller at low priority, off the measurement CPUs, with the schedule on its command line", () => {
  const text = unitText({
    node: "/opt/node 24/bin/node",
    layout: layout("/home/u/.cache"),
    schedule: { wide: ["10:00", "16:00"], nightly: "03:00" },
    memoryHigh: "20G",
    env: { PATH: "/usr/bin:/home/u/.cargo/bin", HOME: "/home/u", SSH_AUTH_SOCK: "/run/user/1000/ssh-%agent", NODE_OPTIONS: "--inspect", SECRET_TOKEN: "x" },
  });
  const line = (pattern: RegExp) => assert.match(text, pattern);
  line(/^ExecStart="\/opt\/node 24\/bin\/node" "\/home\/u\/\.cache\/nts-full-check\/controller\/tooling\/full-check\/service\.ts" "--wide-at=10:00,16:00" "--nightly-at=03:00"$/m);
  line(/^WorkingDirectory=\/home\/u\/\.cache\/nts-full-check\/controller$/m);
  for (const setting of ["Restart=always", "Nice=19", "CPUWeight=20", "IOWeight=20", "CPUAffinity=0-3 6-31", "MemoryHigh=20G", "OOMScoreAdjust=500", "LimitCORE=0", "KillMode=control-group"]) {
    assert.ok(text.split("\n").includes(setting), setting);
  }
  line(/^Environment="SSH_AUTH_SOCK=\/run\/user\/1000\/ssh-%%agent"$/m);
  line(/^Environment="TZ=UTC"$/m);
  assert.doesNotMatch(text, /NODE_OPTIONS|SECRET_TOKEN/, "only the gate's host capabilities pass");
});

test("the unit's options", () => {
  assert.deepEqual(parseUnitOptions(["--install", "--wide-at=12:00", "--nightly-at=04:00", "--memory-high=16G"]),
    { install: true, schedule: { wide: ["12:00"], nightly: "04:00" }, memoryHigh: "16G" });
  assert.throws(() => parseUnitOptions(["--bench-wait=60"]), /unknown argument/, "the benchmarks stay due until the next nightly slot; no wait bounds them");
  assert.throws(() => parseUnitOptions(["--memory-high=lots"]), /unknown argument/);
});
