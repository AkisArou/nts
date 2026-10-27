import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pruneTestArtifacts } from "./test-artifacts.ts";

test("Cargo rebuilds pruned feature/incremental variants while build-script output stays valid", () => {
  const root = mkdtempSync(join(tmpdir(), "nts-test-cache-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "Cargo.toml"), '[package]\nname="cache-control"\nversion="0.0.0"\nedition="2024"\n[features]\nother=[]\n');
    writeFileSync(join(root, "build.rs"), 'fn main() { std::fs::write(std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("private.rs"), "pub const VALUE: u8 = 7;").unwrap(); }\n');
    writeFileSync(join(root, "src/lib.rs"), 'include!(concat!(env!("OUT_DIR"), "/private.rs"));\n#[test] fn generated_value() { assert_eq!(VALUE, 7); }\n');
    const cargo = (args: string[], env: Record<string, string> = {}) => {
      const result = spawnSync("cargo", args, {
        cwd: root, encoding: "utf8",
        env: { ...process.env, CARGO_TARGET_DIR: join(root, "target"), CARGO_BUILD_JOBS: "1", CARGO_INCREMENTAL: "0", CARGO_TERM_COLOR: "never", ...env },
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return result;
    };
    const build = (features: string[] = [], env: Record<string, string> = {}) => {
      const result = cargo(["test", "--offline", "--no-run", "--message-format=json", ...features], env);
      return result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line))
        .filter((event) => event.reason === "compiler-artifact" && event.profile.test && event.executable)
        .map((event) => event.executable);
    };
    const old = build([], { CARGO_INCREMENTAL: "1" });
    const oldIncremental = build(["--features", "other"], { CARGO_INCREMENTAL: "1" });
    const current = build(["--features", "other"]);
    assert.equal(old.length, 1);
    assert.equal(current.length, 1);
    assert.notEqual(old[0], current[0]);
    assert.notEqual(oldIncremental[0], current[0]);
    const profile = dirname(dirname(current[0]));
    const outputs = readdirSync(join(profile, "build"))
      .map((dir) => join(profile, "build", dir, "out/private.rs")).filter(existsSync);
    assert.ok(outputs.length > 0, "a real build script produced private.rs");
    const before = outputs.map((path) => readFileSync(path, "utf8"));
    const outsideLink = join(root, "linked-test");
    linkSync(old[0], outsideLink);
    assert.equal(pruneTestArtifacts(current).binaries, 1, "prune the old incremental variant, keep hardlinked executables");
    assert.equal(existsSync(oldIncremental[0]), false);
    rmSync(outsideLink);
    const sidecar = old[0] + ".d";
    assert.ok(existsSync(sidecar));
    assert.equal(pruneTestArtifacts(current).binaries, 1);
    assert.equal(existsSync(old[0]), false);
    assert.equal(existsSync(sidecar), false);
    assert.ok(existsSync(current[0]));
    assert.deepEqual(outputs.map((path) => readFileSync(path, "utf8")), before);
    const warm = cargo(["test", "--offline", "--features", "other"]);
    assert.doesNotMatch(warm.stderr, /Compiling cache-control/, "the current variant stays incremental");
    assert.match(warm.stdout, /1 passed; 0 failed/);
    cargo(["test", "--offline"], { CARGO_INCREMENTAL: "1" }); // Missing old executable must rebuild.
    assert.ok(existsSync(old[0]));
    rmSync(old[0]);
    symlinkSync(current[0], old[0]);
    assert.equal(pruneTestArtifacts(current).binaries, 0, "keep symlinks");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
