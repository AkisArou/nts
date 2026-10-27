import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, "../..");

test("benchmark shadows compare fresh JVM and imported-source oracle results without supplying verdicts", { timeout: 120_000 }, t => {
  const root = mkdtempSync(join(tmpdir(), "nts-benchmark-shadow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = process.env.NTS_BIN ?? join(ROOT, "target/nts-dev/nts");
  assert.ok(existsSync(bin), `build nts or set NTS_BIN before running this CLI integration test: ${bin}`);
  const project = join(root, "project"); mkdirSync(project);
  const config = join(project, "tsconfig.json"), helper = join(root, "helper.ts");
  writeFileSync(config, JSON.stringify({ extends: join(ROOT, "tsconfig.fixtures.json"), include: ["*.ts"] }));
  writeFileSync(join(project, "main.ts"), 'import { offset } from "../helper.ts"; export function value(n: number): number { return n + offset; }\n');
  writeFileSync(helper, "export const offset = 2;\n");
  const cache = join(root, "cache");
  const run = (name: string) => {
    const directory = join(root, name), costs = join(directory, "costs"); mkdirSync(costs, { recursive: true });
    const result = spawnSync(bin, ["check", config], { cwd: ROOT, encoding: "utf8", timeout: 60_000,
      env: { ...process.env, NTS_BACKEND: "jvm", NTS_CHECKERS: "1", NTS_GATE_STEP: "bench-agree",
        NTS_GATE_RUN_DIR: directory, NTS_GATE_CASE_COSTS_DIR: costs, NTS_GATE_SHADOW_DIR: cache,
        NTS_GATE_SHADOW_HELPER: join(HERE, "artifact-shadow.ts") } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /agreed on every case/);
    const rows = readdirSync(costs).filter(f => /^shadow-\d+-\d+\.jsonl$/.test(f)).flatMap(f => readFileSync(join(costs, f), "utf8").trim().split("\n").map(line => JSON.parse(line)));
    assert.equal(rows.length, 2, "each fresh check must observe both actual executions");
    assert.ok(rows.every(r => r.context === config), "shadow context must identify the captured project");
    assert.ok(rows.every(r => r.runtime_inputs === "unreviewed"), "shadow agreement cannot imply runtime-input eligibility");
    assert.deepEqual(rows.map(r => r.kind).sort(), ["bench-oracle-node", "bench-program-jvm"]);
    return rows;
  };
  assert.ok(run("first").every(r => r.status === "miss"));
  assert.ok(run("second").every(r => r.status === "hit-match"));
  assert.ok(run("third").every(r => r.status === "hit-match"));
  writeFileSync(helper, "export const offset = 3;\n");
  const changed = run("changed-helper");
  assert.ok(changed.every(r => r.status === "miss"), "an imported source changes both oracle and emitted-program keys");
  for (const row of changed) {
    const file = join(cache, row.kind, `${row.key}.json`), value = JSON.parse(readFileSync(file, "utf8"));
    value.result_sha256 = "0".repeat(64); writeFileSync(file, JSON.stringify(value));
  }
  assert.ok(run("mismatching-baseline").every(r => r.status === "hit-mismatch"), "fresh agreement must survive a mismatching cache observation");
});
