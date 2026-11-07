import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_HASH } from "./project.ts";
import { OUTPUT_PREFIX_VERSION } from "../conformance/output-prefix.ts";
import { spawnTest } from "../gate/test-wait.ts";

import { test } from "node:test";
import { newTestScratch } from "../gate/test-scratch.ts";

test("a JavaScript checkpoint from before prefix validation cannot be resumed", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const binary = resolve(root, process.env.NTS_BIN ?? "target/release/nts");
  assert.ok(existsSync(binary), `compiler missing: ${binary}; set NTS_BIN to a built pin`);
  const scratch = newTestScratch("output-checkpoint-case");
  try {
    const path = "test/language/arguments-object/10.5-1gs.js";
    // Only selection is supplied by this fixture. The real runner performs
    // its compiler self-checks and reads the controlled checkpoint itself.
    const protocol = join(scratch, "select");
    const overrides = JSON.parse(readFileSync(join(root, "tooling/census/test262-evidence-overrides.json"), "utf8"));
    const catalog = [...new Set<string>([path, ...overrides.overrides.flatMap(entry => entry.positives)])];
    const selected = catalog.map(path => ({ path, schedule: "planned", variant_id: `${path}#strict`, strict_prefix: "",
      includes: [], features: [], flags: [], source_hash: "test", body_hash: "test", function_token: false }));
    writeFileSync(protocol, `#!${process.execPath}\nconsole.log(${JSON.stringify(selected.map(row => JSON.stringify(row)).join("\n"))});\n`, { mode: 0o700 });
    const population = join(scratch, "population.tsv");
    const header = readFileSync(join(root, "results/test262/c/language.tsv"), "utf8").split("\n").slice(0, 3).join("\n");
    writeFileSync(population, `${header}\n${path}\tpass\t\n`);
    const fingerprint = createHash("sha256").update(readFileSync(binary)).digest("hex").slice(0, 16);
    const rows = join(scratch, "rows.jsonl"), report = join(scratch, "report.json");
    for (const version of [undefined, OUTPUT_PREFIX_VERSION]) {
      writeFileSync(rows, JSON.stringify({ fingerprint, under: "test/language", harness: HARNESS_HASH,
        ...(version === undefined ? {} : { output_prefix: version }) }) + "\n" +
        JSON.stringify({ path, bucket: "strict-pass" }) + "\n");
      rmSync(report, { force: true });
      const run = spawnTest(process.execPath, ["tooling/census/conformance262.ts", "--under", "test/language",
        "--jobs", "1", "--recorded", population, "--rows", rows, "--resume", "--json", report], {
        cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, NTS_BIN: binary, NTS_TEST262_PROTOCOL: protocol, NTS_CENSUS_DIR: join(scratch, "run") },
      }, "output-prefix checkpoint census result");
      if (version === undefined) {
        assert.equal(run.status, 2, run.stdout + run.stderr);
        assert.match(run.stdout + run.stderr, /output-prefix version/);
        assert.equal(existsSync(report), false);
      } else {
        assert.equal(run.status, 0, run.stdout + run.stderr);
        assert.equal(JSON.parse(readFileSync(report, "utf8")).tally.pass, 1);
      }
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
