import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("carried patches are reconstructed, disclosed, and reviewed again before a new pin", () => {
  const scratch = mkdtempSync(join(process.env.TMPDIR ?? join(process.env.HOME!, ".cache"), "nts-vendor-patch-test-"));
  try {
    const source = join(scratch, "source");
    const adapter = join(scratch, "adapter");
    const output = join(scratch, "vendor");
    const name = "crates/tsrs_compiler/src/lib.rs";
    mkdirSync(join(source, dirname(name)), { recursive: true });
    mkdirSync(join(adapter, "patches"), { recursive: true });
    copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "vendor.ts"), join(adapter, "vendor.ts"));
    writeFileSync(join(source, "Cargo.toml"), `[workspace.package]
version = "0.19.0"
[workspace.metadata.typescript]
commit = "${"3".repeat(40)}"
[workspace.dependencies]
tsrs_compiler = { path = "crates/tsrs_compiler" }
[workspace.lints.rust]
unused = "warn"
[workspace.lints.clippy]
all = "warn"
`);
    writeFileSync(join(source, "crates/tsrs_compiler/Cargo.toml"), "[package]\nname = \"tsrs_compiler\"\n[dependencies]\n");
    writeFileSync(join(source, name), "pub fn answer() -> u32 { 1 }\n");
    writeFileSync(join(source, "LICENSE"), "fixture license\n");
    writeFileSync(join(source, "NOTICE"), "fixture notice\n");
    const git = (...args: string[]) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
    git("init", "--quiet");
    git("add", ".");
    git("-c", "user.name=nts test", "-c", "user.email=test@nts.invalid", "commit", "--quiet", "-m", "fixture base");
    const revision = git("rev-parse", "HEAD");
    const patch = `diff --git a/${name} b/${name}
--- a/${name}
+++ b/${name}
@@ -1 +1 @@
-pub fn answer() -> u32 { 1 }
+pub fn answer() -> u32 { 2 }
`;
    const record = { id: "test-recovery", base: revision, path: "patches/test-recovery.patch", sha256: createHash("sha256").update(patch).digest("hex"), rationale: "fixture recovery", remove_when: "official equivalent passes the controls" };
    const registry = join(adapter, "patches.json");
    const patchPath = join(adapter, record.path);
    writeFileSync(registry, JSON.stringify([record]));
    writeFileSync(patchPath, patch);
    const invoke = (...args: string[]) => spawnSync(process.execPath, [join(adapter, "vendor.ts"), "--out", output, ...args], { encoding: "utf8" });
    const good = (...args: string[]) => {
      const result = invoke(...args);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    const bad = (pattern: RegExp, ...args: string[]) => {
      const result = invoke(...args);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, pattern);
    };
    good("--source", source, "--rev", revision);
    assert.equal(readFileSync(join(output, name), "utf8"), "pub fn answer() -> u32 { 2 }\n");
    assert.equal(readFileSync(join(source, name), "utf8"), "pub fn answer() -> u32 { 1 }\n");
    assert.equal(git("status", "--porcelain"), "");
    assert.deepEqual(JSON.parse(readFileSync(join(output, "UPSTREAM.json"), "utf8")).patches, [record]);
    assert.match(readFileSync(join(output, "UPSTREAM.md"), "utf8"), /explicit local patches/);
    good("--check");
    good("--source", source, "--rev", revision, "--check");
    const original = readFileSync(join(output, name));
    writeFileSync(join(output, name), "pub fn answer() -> u32 { 3 }\n");
    bad(/modified: crates\/tsrs_compiler\/src\/lib.rs/, "--check");
    bad(/modified: crates\/tsrs_compiler\/src\/lib.rs/, "--source", source, "--rev", revision);
    writeFileSync(join(output, name), original);
    writeFileSync(patchPath, patch + "\n");
    bad(/carried patch hash mismatch/, "--check");
    writeFileSync(patchPath, patch);
    writeFileSync(registry, "[]");
    bad(/UPSTREAM.json and carried patch records differ/, "--check");
    writeFileSync(registry, JSON.stringify([record]));
    git("-c", "user.name=nts test", "-c", "user.email=test@nts.invalid", "commit", "--quiet", "--allow-empty", "-m", "new upstream");
    bad(/review applicability or removal before re-pinning/, "--source", source, "--rev", git("rev-parse", "HEAD"));
    good("--source", source, "--rev", revision, "--check");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
