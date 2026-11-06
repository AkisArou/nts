import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// doctests.ts with a stand-in cargo that records how it was called. The
// variables it reads are the test's own: a run's NTS_TEST_PROFILE is not.
function doctests(env: Record<string, string | undefined>) {
  const root = mkdtempSync(join(tmpdir(), "doctest-command-"));
  try {
    const capture = join(root, "args.json"), cargo = join(root, "cargo");
    writeFileSync(cargo, `#!${process.execPath}\nrequire("node:fs").writeFileSync(process.env.DOC_CAPTURE, JSON.stringify({args:process.argv.slice(2),checkers:process.env.NTS_CHECKERS})); process.exit(7);\n`);
    chmodSync(cargo, 0o755);
    const run = spawnSync(process.execPath, [new URL("./doctests.ts", import.meta.url).pathname], { encoding: "utf8",
      env: { ...process.env, PATH: root, DOC_CAPTURE: capture, NTS_CHECKERS: "9", NTS_TEST_PROFILE: undefined, ...env } });
    let called: unknown = null;
    try { called = JSON.parse(readFileSync(capture, "utf8")); } catch { /* cargo was not called */ }
    return { run, called };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("doc-only checks select the named crates, keep failures and bound checker pools", () => {
  const { run, called } = doctests({ NTS_DOCTEST_CRATES: "nts-core nts-codegen-c nts-core" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /cargo exited 7/);
  assert.deepEqual(called, { args: ["test", "--doc", "--no-fail-fast", "-p", "nts-core", "-p", "nts-codegen-c"], checkers: "1" });
});

test("doc tests build in the profile NTS_TEST_PROFILE names, as the tests do", () => {
  const { called } = doctests({ NTS_DOCTEST_CRATES: "nts-core", NTS_TEST_PROFILE: "nts-dev" });
  assert.deepEqual(called, { args: ["test", "--doc", "--no-fail-fast", "--profile", "nts-dev", "-p", "nts-core"], checkers: "1" });
  const bad = doctests({ NTS_TEST_PROFILE: "--release" });
  assert.notEqual(bad.run.status, 0);
  assert.match(bad.run.stderr, /invalid NTS_TEST_PROFILE/);
  assert.equal(bad.called, null, "cargo is never called with a profile that is not a name");
});
