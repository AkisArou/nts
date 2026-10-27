import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("doc-only checks select the named crates, keep failures and bound checker pools", () => {
  const root = mkdtempSync(join(tmpdir(), "doctest-command-"));
  try {
    const capture = join(root, "args.json"), cargo = join(root, "cargo");
    writeFileSync(cargo, `#!${process.execPath}\nrequire("node:fs").writeFileSync(process.env.DOC_CAPTURE, JSON.stringify({args:process.argv.slice(2),checkers:process.env.NTS_CHECKERS})); process.exit(7);\n`);
    chmodSync(cargo, 0o755);
    const run = spawnSync(process.execPath, [new URL("./doctests.ts", import.meta.url).pathname], { encoding: "utf8", env: { ...process.env, PATH: root, DOC_CAPTURE: capture, NTS_CHECKERS: "9", NTS_DOCTEST_CRATES: "nts-core nts-codegen-c nts-core" } });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /cargo exited 7/);
    assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")), { args: ["test", "--doc", "--no-fail-fast", "-p", "nts-core", "-p", "nts-codegen-c"], checkers: "1" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
