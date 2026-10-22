import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { frontendPath, frontendPin, prepareSource, requireFrontend } from "./tsgo.ts";

const script = new URL("./tsgo.ts", import.meta.url).pathname;
const made: string[] = [];
after(() => { for (const directory of made) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tsgo-key-"));
  made.push(root);
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@test", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@test" };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") && !key.startsWith("GIT_AUTHOR_") && !key.startsWith("GIT_COMMITTER_")) delete env[key];
  const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(root, ["init", "-q"]);
  const source = join(root, "third_party/typescript-go");
  mkdirSync(source, { recursive: true });
  git(source, ["init", "-q"]);
  writeFileSync(join(source, "source.txt"), "before\n");
  git(source, ["add", "source.txt"]);
  git(source, ["commit", "-q", "-m", "source"]);
  const first = git(source, ["rev-parse", "HEAD"]);
  git(root, ["update-index", "--add", "--cacheinfo", `160000,${first},third_party/typescript-go`]);
  mkdirSync(join(root, "third_party/patches"));
  const tools = join(root, "tools");
  mkdirSync(tools);
  const go = join(tools, "go");
  writeFileSync(go, '#!/bin/sh\nset -eu\necho build >> "$TSGO_TEST_BUILDS"\nif [ -n "${TSGO_TEST_FAIL:-}" ]; then exit 7; fi\nwhile [ "$1" != -o ]; do shift; done\nshift\nprintf "#!/bin/sh\\necho frontend\\n" > "$1"\nchmod +x "$1"\n');
  chmodSync(go, 0o755);
  env.PATH = `${tools}:${env.PATH}`;
  const buildLog = join(root, "builds.log");
  env.TSGO_TEST_BUILDS = buildLog;
  const build = () => spawnSync(process.execPath, [script, "build", root, root], { env, encoding: "utf8" });
  return { root, source, env, git, build, first, buildLog };
}

const patch = (after: string) => `diff --git a/source.txt b/source.txt\n--- a/source.txt\n+++ b/source.txt\n@@ -1 +1 @@\n-before\n+${after}\n`;

test("patch contents, names and gitlinks select independent immutable builds", () => {
  const f = fixture();
  const first = frontendPin(f.root);
  assert.equal(f.build().status, 0);
  const oldBinary = realpathSync(join(f.root, "target/tsgo"));
  const oldBytes = readFileSync(oldBinary);
  assert.equal(f.build().status, 0);
  assert.equal(readFileSync(f.buildLog, "utf8"), "build\n", "an existing key must not rebuild");
  const file = join(f.root, "third_party/patches/one.patch");
  writeFileSync(file, patch("patched"));
  assert.notEqual(frontendPin(f.root).key, first.key);
  const updated = f.build();
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(readFileSync(join(f.source, "source.txt"), "utf8"), "patched\n");
  assert.notEqual(realpathSync(join(f.root, "target/tsgo")), oldBinary);
  assert.deepEqual(readFileSync(oldBinary), oldBytes);
  // A new patch series replaces the previous one, rather than stacking it.
  writeFileSync(file, patch("patched again"));
  const replaced = f.build();
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(readFileSync(join(f.source, "source.txt"), "utf8"), "patched again\n");
  const key = frontendPin(f.root).key;
  writeFileSync(join(f.root, "third_party/patches/two.patch"), readFileSync(file));
  rmSync(file);
  assert.notEqual(frontendPin(f.root).key, key);
  // Removing the carried series and moving the pin cleans the old series.
  rmSync(join(f.root, "third_party/patches/two.patch"));
  writeFileSync(join(f.source, "source.txt"), "before\n");
  writeFileSync(join(f.source, "next.txt"), "next\n");
  f.git(f.source, ["add", "next.txt"]);
  f.git(f.source, ["commit", "-q", "-m", "next pin"]);
  const next = f.git(f.source, ["rev-parse", "HEAD"]);
  f.git(f.root, ["update-index", "--cacheinfo", `160000,${next},third_party/typescript-go`]);
  const moved = f.build();
  assert.equal(moved.status, 0, moved.stderr);
  assert.notEqual(frontendPin(f.root).key, first.key);
});

test("missing, failed and modified builds cannot use or replace an existing frontend", () => {
  const f = fixture();
  assert.throws(() => requireFrontend(f.root, f.root), /missing tsgo build/);
  assert.equal(f.build().status, 0);
  const old = realpathSync(join(f.root, "target/tsgo"));
  writeFileSync(join(f.root, "third_party/patches/one.patch"), patch("patched"));
  f.env.TSGO_TEST_FAIL = "1";
  const failed = f.build();
  assert.notEqual(failed.status, 0);
  assert.equal(realpathSync(join(f.root, "target/tsgo")), old);
  assert.ok(!existsSync(dirname(frontendPath(f.root, frontendPin(f.root)))));
  delete f.env.TSGO_TEST_FAIL;
  assert.equal(f.build().status, 0);
  writeFileSync(realpathSync(join(f.root, "target/tsgo")), "changed");
  assert.throws(() => requireFrontend(f.root, f.root), /was modified/);
  assert.notEqual(f.build().status, 0, "bootstrap cannot overwrite an immutable key");
});

test("source preparation preserves unrelated edits and rolls back patch removal on refusal", () => {
  const f = fixture();
  writeFileSync(join(f.root, "third_party/patches/one.patch"), patch("patched"));
  prepareSource(f.root, f.root);
  writeFileSync(join(f.source, "untracked.txt"), "keep me\n");
  assert.throws(() => prepareSource(f.root, f.root), /unrecognised edits/);
  assert.equal(readFileSync(join(f.source, "source.txt"), "utf8"), "patched\n");
  assert.equal(readFileSync(join(f.source, "untracked.txt"), "utf8"), "keep me\n");
});

test("a conformance pin records its immutable frontend through subsequent pin builds", () => {
  const f = fixture();
  for (const name of ["conformance/pin.ts", "lanes/tsgo.ts", "lanes/inputs.sh", "lanes/workspace-links.ts"]) {
    const target = join(f.root, "tooling", name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(new URL(`../${name}`, import.meta.url), target);
  }
  writeFileSync(join(f.root, "pnpm-lock.yaml"), "importers: {}\n");
  writeFileSync(join(f.root, ".gitignore"), "/target/\n/tools/\n/pins/\n/builds.log\n");
  const cargo = join(f.root, "tools/cargo");
  writeFileSync(cargo, '#!/bin/sh\nset -eu\nmkdir -p "$CARGO_TARGET_DIR/release"\nprintf "#!/bin/sh\\necho compiler\\n" > "$CARGO_TARGET_DIR/release/nts"\n');
  chmodSync(cargo, 0o755);
  f.env.NTS_PINS = join(f.root, "pins");
  f.env.NTS_TSGO = "/wrong/caller/frontend";
  f.git(f.root, ["add", "tooling", "pnpm-lock.yaml", ".gitignore"]);
  f.git(f.root, ["commit", "-q", "-m", "first pin"]);
  assert.equal(f.build().status, 0);
  const pin = () => {
    const result = spawnSync(process.execPath, [join(f.root, "tooling/conformance/pin.ts"), "HEAD"], { env: f.env, cwd: f.root, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return JSON.parse(readFileSync(join(dirname(result.stdout.trim().split("\n").at(-1)!), "provenance.json"), "utf8"));
  };
  const first = pin();
  const firstKey = frontendPin(f.root).key;
  assert.equal(first.tsgo.path, frontendPath(f.root, frontendPin(f.root)));
  writeFileSync(join(f.root, "third_party/patches/one.patch"), patch("patched"));
  f.git(f.root, ["add", "third_party/patches/one.patch"]);
  f.git(f.root, ["commit", "-q", "-m", "second pin"]);
  assert.equal(f.build().status, 0);
  const second = pin();
  assert.notEqual(first.tsgo.path, second.tsgo.path);
  assert.equal(first.tsgo.key, firstKey);
  assert.ok(existsSync(first.tsgo.path));
  assert.equal(second.tsgo.path, frontendPath(f.root, frontendPin(f.root)));
});
