import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("unrouted names a broken corpus link and fails without an unhandled stack", t => {
  const root = mkdtempSync(join(tmpdir(), "nts-unrouted-link-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "runtime/web-platform/src"), { recursive: true });
  mkdirSync(join(root, "tooling"));
  symlinkSync("missing-config", join(root, "tooling/broken-config"));
  const script = new URL("../conformance/web-platform/unrouted.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unrouted: cannot inspect tooling\/broken-config -> missing-config \(ENOENT\)/);
  assert.doesNotMatch(result.stderr, /node:fs|Error: ENOENT/);
  assert.doesNotMatch(result.stdout, /no unexplained exports/);
});

for (const platform of ["linux", "darwin"]) {
  test(`the named incomplete CocoaPods input is an exception only on Linux (${platform})`, t => {
    const root = mkdtempSync(join(tmpdir(), "nts-unrouted-pods-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "runtime/web-platform/src"), { recursive: true });
    const dir = join(root, "tests/interop/macos-pods/Pods/Headers/Public/Chirp");
    mkdirSync(dir, { recursive: true });
    symlinkSync("../../../Target Support Files/Chirp/Chirp-umbrella.h", join(dir, "Chirp-umbrella.h"));
    const script = new URL("../conformance/web-platform/unrouted.mjs", import.meta.url).pathname;
    const preload = "data:text/javascript," + encodeURIComponent(`Object.defineProperty(process, "platform", {value:${JSON.stringify(platform)}});`);
    const result = spawnSync(process.execPath, ["--import", preload, script], { cwd: root, encoding: "utf8" });
    if (platform === "linux") {
      assert.match(result.stderr, /known Linux fixture link tests\/interop\/macos-pods\/Pods\/Headers\/Public\/Chirp\/Chirp-umbrella.h/);
      assert.doesNotMatch(result.stderr, /cannot inspect|Error: ENOENT/);
      // This deliberately empty corpus can fail the export allowlist audit.
    } else {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /cannot inspect.*Chirp-umbrella.h/);
      assert.doesNotMatch(result.stderr, /known Linux fixture link/);
    }
  });
}

test("a different target at a named CocoaPods link still fails", t => {
  const root = mkdtempSync(join(tmpdir(), "nts-unrouted-pods-target-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "runtime/web-platform/src"), { recursive: true });
  const dir = join(root, "tests/interop/macos-pods/Pods/Headers/Public/Chirp");
  mkdirSync(dir, { recursive: true });
  symlinkSync("unexpected-target.h", join(dir, "Chirp-umbrella.h"));
  const script = new URL("../conformance/web-platform/unrouted.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot inspect.*Chirp-umbrella.h -> unexpected-target.h/);
  assert.doesNotMatch(result.stderr, /known Linux fixture link/);
});

test("a ninth dangling CocoaPods link is not covered by the named exceptions", t => {
  const root = mkdtempSync(join(tmpdir(), "nts-unrouted-pods-extra-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "runtime/web-platform/src"), { recursive: true });
  const dir = join(root, "tests/interop/macos-pods/Pods/Headers/Public/Chirp");
  mkdirSync(dir, { recursive: true });
  symlinkSync("../../../Target Support Files/Chirp/Extra.h", join(dir, "Extra.h"));
  const script = new URL("../conformance/web-platform/unrouted.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot inspect.*Chirp\/Extra.h/);
  assert.doesNotMatch(result.stderr, /known Linux fixture link/);
});
