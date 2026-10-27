import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("manual gate runs and individual steps disable cores, with an explicit debug opt-in", t => {
  const root = mkdtempSync(join(tmpdir(), "gate-core-limit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "tooling/gate"), { recursive: true });
  mkdirSync(join(root, "bin"));
  const script = join(root, "tooling/gate/all.sh");
  writeFileSync(script, readFileSync(new URL("./all.sh", import.meta.url)));
  // Observe the limit inherited by a gate child, without running any builds.
  const node = join(root, "bin/node");
  writeFileSync(node, '#!/bin/sh\n{ ulimit -c; ulimit -Hc; } > "$CORE_LIMIT_OBSERVED"\n');
  chmodSync(node, 0o755);
  const observed = join(root, "limit");
  const hard = spawnSync("sh", ["-c", "ulimit -Hc"], { encoding: "utf8" }).stdout.trim();
  for (const args of [[], ["--call", "tooling"]]) for (const enabled of [false, true]) {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, TMPDIR: root, CORE_LIMIT_OBSERVED: observed };
    delete env.NTS_COREDUMPS;
    if (enabled) env.NTS_COREDUMPS = "1";
    const result = spawnSync("sh", [script, ...args], { env, encoding: "utf8" });
    // A default landing unit has a zero hard limit. Debugging then requires
    // the opted-in unit too; a child cannot silently bypass the parent's cap.
    if (enabled && hard === "0") {
      assert.notEqual(result.status, 0);
      continue;
    }
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(readFileSync(observed, "utf8").trim().split("\n"), enabled ? ["unlimited", "unlimited"] : ["0", "0"]);
  }
});
