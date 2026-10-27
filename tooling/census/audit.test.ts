import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

test("metadata audit reads all authorities and exclusions without a compiler or selection", () => {
  const root = mkdtempSync(join(tmpdir(), "classification-audit-"));
  const write = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  try {
    const path = "tooling/census/audit.ts";
    write(path, ""); copyFileSync(new URL("./audit.ts", import.meta.url), join(root, path));
    write("tooling/census/features.json", JSON.stringify({ version: 1, features: { Feature: { class: "inapplicable", reason: "reason", authority: "docs/boundary.md §Boundary" } } }));
    const exclusions = { exclusions: [{ kind: "include", match: "helper.js", reason: "reason", authority: "docs/boundary.md §Boundary" }] };
    write("tooling/census/test262-exclusions.json", JSON.stringify(exclusions));
    write("third_party/test262/features.txt", "Feature\n");
    write("third_party/test262/harness/helper.js", "// source\n");
    write("docs/boundary.md", "# Spec\n\n## Boundary\n");
    const run = () => spawnSync(process.execPath, [path, "--metadata-only"], { cwd: root, env: { ...process.env, PATH: "/no-cargo-here" }, encoding: "utf8" });
    const green = run();
    assert.equal(green.status, 0, green.stdout + green.stderr);
    assert.match(green.stdout, /1 exclusions \(no case selection\)/);
    exclusions.exclusions[0].authority = "docs/missing.md";
    write("tooling/census/test262-exclusions.json", JSON.stringify(exclusions));
    const missingAuthority = run();
    assert.equal(missingAuthority.status, 1);
    assert.match(missingAuthority.stdout, /include:helper.js: authority names docs\/missing.md/);
    exclusions.exclusions[0].authority = "docs/boundary.md §Boundary";
    exclusions.exclusions[0].match = "gone.js";
    write("tooling/census/test262-exclusions.json", JSON.stringify(exclusions));
    assert.match(run().stdout, /exclusion names no suite entry/);
    rmSync(join(root, "third_party/test262"), { recursive: true });
    assert.equal(run().status, 2, "a missing registry is not an empty successful audit");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
