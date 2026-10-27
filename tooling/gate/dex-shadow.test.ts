import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("the two real identical Box artifacts match despite d8 warning origin paths", { timeout: 120_000 }, t => {
  const root = mkdtempSync(join(tmpdir(), "nts-dex-shadow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = process.env.NTS_BIN ?? join(ROOT, "target/nts-dev/nts");
  assert.ok(existsSync(bin), `build nts or set NTS_BIN before running this integration test: ${bin}`);
  assert.ok(process.env.ANDROID_HOME, "this integration test requires the declared Android SDK capability");
  const cache = join(root, "cache"), costs = join(root, "costs"); mkdirSync(costs);
  const fixtures = ["a-decorator-option-needs-a-decorator", "a-fieldless-class-needs-no-define-option"];
  const result = spawnSync("sh", ["tooling/android/dexes.sh", ...fixtures], { cwd: ROOT, encoding: "utf8", timeout: 110_000,
    env: { ...process.env, NTS_BIN: bin, NTS_CHECKERS: "1", NTS_GATE_JOBS: "1", NTS_ART_WORK: join(root, "work"),
      NTS_GATE_STEP: "dex", NTS_GATE_RUN_DIR: root, NTS_GATE_CASE_COSTS_DIR: costs, NTS_GATE_SHADOW_DIR: cache } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const rows = readdirSync(costs).filter(f => /^shadow-\d+-\d+\.jsonl$/.test(f)).flatMap(f =>
    readFileSync(join(costs, f), "utf8").trim().split("\n").map(line => JSON.parse(line)));
  assert.equal(rows.length, 2, "both real d8 executions must be observed");
  assert.equal(rows.filter(r => r.status === "miss").length, 1);
  assert.equal(rows.filter(r => r.status === "hit-match").length, 1);
  assert.equal(rows[0].key, rows[1].key, "the fixtures must emit byte-identical inputs");
  const baseline = JSON.parse(readFileSync(join(cache, "dex", `${rows[0].key}.json`), "utf8"));
  assert.match(baseline.result.log, /Warning in .*a-(decorator|fieldless)/);
  assert.match(baseline.comparison_result.log, /Warning in artifact\/nts\/gen\/Box\.class:/);
  assert.ok(!fixtures.some(name => baseline.comparison_result.log.includes(name)), "only artifact names belong in the comparison log");
  assert.ok(baseline.result.outputs.length > 0, "a matching log alone cannot stand in for DEX output bytes");
});
