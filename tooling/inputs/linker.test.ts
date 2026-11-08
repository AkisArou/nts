import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { testScratch } from "../gate/test-scratch.ts";
import { linkerOf, linkTree } from "./linker.ts";

// A linker that writes the use and the paths it was given into the tree.
const RECORDS = 'printf "%s %s %s\\n" "$1" "$2" "$3" > "$3/linked"\n';
function tree(root: string, name: string, linkers: Record<string, string>): string {
  const dir = join(root, name);
  for (const [path, body] of Object.entries(linkers)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}
const linked = (dir: string) => readFileSync(join(dir, "linked"), "utf8").trim();

test("a tree is linked by its own linker, for the use asked", t => {
  const root = testScratch(t, "linker");
  const dir = tree(root, "current", { "tooling/inputs/link.sh": RECORDS });
  for (const use of ["gate", "work"] as const) {
    linkTree(dir, use, "/shared");
    assert.equal(linked(dir), `${use} /shared ${dir}`);
  }
});

test("a commit from before the move is linked where it kept its linker, `work` by its old name", t => {
  const root = testScratch(t, "linker");
  const dir = tree(root, "before", { "tooling/lanes/inputs.sh": RECORDS });
  linkTree(dir, "work", "/shared");
  assert.equal(linked(dir), `lane /shared ${dir}`);
  linkTree(dir, "gate", "/shared");
  assert.equal(linked(dir), `gate /shared ${dir}`);
});

test("the current linker wins over a stale copy of the old one", t => {
  const root = testScratch(t, "linker");
  const dir = tree(root, "both", { "tooling/inputs/link.sh": RECORDS, "tooling/lanes/inputs.sh": "exit 7\n" });
  assert.equal(linkerOf(dir, "work")?.script, join(dir, "tooling/inputs/link.sh"));
  linkTree(dir, "work", "/shared");
  assert.equal(linked(dir), `work /shared ${dir}`);
});

test("a tree with no linker is refused, never linked by guesswork", t => {
  const root = testScratch(t, "linker");
  const dir = tree(root, "none", {});
  assert.equal(linkerOf(dir, "gate"), null);
  assert.throws(() => linkTree(dir, "gate", "/shared"), new RegExp(`${dir} has no input linker`));
});

test("a linker that fails is reported with its last lines", t => {
  const root = testScratch(t, "linker");
  const dir = tree(root, "failing", { "tooling/inputs/link.sh": 'echo one >&2; echo "no node pair for this tree" >&2; exit 3\n' });
  assert.throws(() => linkTree(dir, "gate", "/shared"), /inputs for .*: one; no node pair for this tree/);
});

test("the command line links a tree and refuses a use it does not know", t => {
  const root = testScratch(t, "linker");
  const dir = tree(root, "cli", { "tooling/inputs/link.sh": RECORDS });
  const cli = fileURLToPath(new URL("./linker.ts", import.meta.url));
  const ok = spawnSync(process.execPath, [cli, "gate", "/shared", dir], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(linked(dir), `gate /shared ${dir}`);
  const bad = spawnSync(process.execPath, [cli, "lane", "/shared", dir], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: node tooling\/inputs\/linker\.ts gate\|work/);
  const missing = spawnSync(process.execPath, [cli, "gate", "/shared", join(root, "absent")], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /linker: .*absent has no input linker/);
});

test("the command line exits with the linker's own status, its output passed through", t => {
  const root = testScratch(t, "linker");
  const dir = tree(root, "refusing", { "tooling/inputs/link.sh": 'echo "candidate input is missing" >&2; exit 23\n' });
  const cli = fileURLToPath(new URL("./linker.ts", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "gate", "/shared", dir], { encoding: "utf8" });
  assert.equal(result.status, 23, result.stderr);
  assert.match(result.stderr, /candidate input is missing/);
});
