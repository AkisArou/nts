import {test} from "node:test";
import assert from "node:assert/strict";
import {chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {collectTargetStorage, LARGE_TARGET_BYTES, storageLines} from "./target-storage.ts";
import {spawnTest} from "../gate/test-wait.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
function fixture(t: {after(fn: () => void): void}): string {
  const base = join(homedir(), ".cache/nts-scratch/target-storage");
  mkdirSync(base, {recursive: true});
  const tree = mkdtempSync(join(base, "tree-"));
  t.after(() => rmSync(tree, {recursive: true, force: true}));
  return tree;
}
function marker(tree: string, profile: string, name: string, hours: number): string {
  const dir = join(tree, "target", profile, ".fingerprint", "crate-123");
  mkdirSync(dir, {recursive: true});
  const file = join(dir, name);
  writeFileSync(file, "0123456789abcdef");
  const at = new Date(NOW - hours * 3_600_000);
  utimesSync(file, at, at);
  return file;
}

test("storage observes allocated blocks, custom/cross profiles and successful-unit age without changing files", async t => {
  const tree = fixture(t);
  const old = marker(tree, "debug", "lib-example", 25);
  marker(tree, "debug", "invoked.timestamp", 0);
  marker(tree, "debug", "lib-example.json", 0);
  marker(tree, "debug", "dep-lib-example", 0);
  marker(tree, "nts-dev", "test-lib-example", 1);
  marker(tree, "aarch64-unknown-linux-gnu/release", "bin-nts", 24);
  const sparse = join(tree, "target/debug/sparse");
  writeFileSync(sparse, ""); truncateSync(sparse, LARGE_TARGET_BYTES + 1);
  const before = {mtime: lstatSync(old).mtimeMs, text: readFileSync(old, "utf8")};
  const [row] = await collectTargetStorage([{path: tree}], {now: NOW});
  assert.equal(row.state, "known");
  assert.ok(row.allocatedBytes! < 1 << 20, "sparse logical length must not be reported as allocated disk");
  assert.equal(row.over40GiB, false);
  assert.deepEqual(row.profiles.map(p => [p.profile, p.stale]), [
    ["aarch64-unknown-linux-gnu/release", true], ["debug", true], ["nts-dev", false],
  ]);
  assert.equal(row.profiles.find(p => p.profile === "debug")!.lastSuccessfulUnit, new Date(NOW - 25 * 3_600_000).toISOString());
  assert.deepEqual({mtime: lstatSync(old).mtimeMs, text: readFileSync(old, "utf8")}, before);
  assert.equal(lstatSync(sparse).size, LARGE_TARGET_BYTES + 1);
  assert.match(storageLines([{path: tree, lane: "owner", storage: row}]).join("\n"), /debug: .*NO BUILD IN 24h/);
});

test("target links and fingerprint links never become another owner's profile", async t => {
  const source = fixture(t), linked = fixture(t), empty = fixture(t), missing = fixture(t);
  marker(source, "debug", "lib-example", 25);
  symlinkSync(join(source, "target"), join(linked, "target"));
  mkdirSync(join(empty, "target/debug"), {recursive: true});
  mkdirSync(join(empty, "target/custom/deps"), {recursive: true});
  symlinkSync(join(source, "target/debug/.fingerprint"), join(empty, "target/debug/.fingerprint"));
  symlinkSync(join(source, "target/debug/.fingerprint"), join(empty, "target/custom/.fingerprint"));
  const rows = await collectTargetStorage([source, linked, empty, missing].map(path => ({path})), {now: NOW});
  assert.equal(rows[0].state, "known");
  assert.equal(rows[1].state, "symlink");
  assert.equal(rows[1].allocatedBytes, null);
  assert.equal(rows[2].state, "known");
  assert.equal(rows[2].profiles.length, 1);
  assert.equal(rows[2].profiles[0].profile, "custom");
  assert.equal(rows[2].profiles[0].ageState, "unknown");
  assert.equal(rows[2].profiles[0].lastSuccessfulUnit, null);
  assert.equal(rows[2].profiles[0].stale, null);
  assert.equal(rows[3].state, "absent");
});

test("an existing profile without a successful fingerprint has unknown age", async t => {
  const tree = fixture(t);
  marker(tree, "debug", "invoked.timestamp", 25);
  const [row] = await collectTargetStorage([{path: tree}], {now: NOW});
  assert.equal(row.state, "known");
  assert.equal(row.profiles[0].ageState, "unknown");
  assert.equal(row.profiles[0].stale, null);
});

test("auxiliary dependency caches stay in other output instead of inventing Cargo profiles", async t => {
  const tree = fixture(t), cache = join(tree, "target/tmp/build-aar-dependency/deps");
  mkdirSync(cache, {recursive: true}); writeFileSync(join(cache, "fixture.jar"), "fixture");
  const [row] = await collectTargetStorage([{path: tree}], {now: NOW});
  assert.equal(row.state, "known"); assert.ok(row.allocatedBytes! > 0);
  assert.deepEqual(row.profiles, []); assert.equal(row.otherBytes, row.allocatedBytes);
});

test("NUL framing preserves whitespace/UTF-8 paths and malformed completed observations stay unknown", async t => {
  const base = fixture(t), tree = join(base, "space\nline-π"); mkdirSync(tree);
  marker(tree, "debug", "lib-example", 1);
  const [real] = await collectTargetStorage([{path: tree}], {now: NOW});
  assert.equal(real.state, "known"); assert.equal(real.profiles[0].profile, "debug");
  const target = join(tree, "target"), command = join(base, "du");
  for (const bad of [`4\t${target}/debug\0`, `NaN\t${target}\0`, `4\t/elsewhere\0`, `4\t${target}\0` + `5\t${target}\0`, `4\t${target}\0unfinished`]) {
    writeFileSync(command, `#!${process.execPath}\nrequire('node:fs').writeSync(1,${JSON.stringify(bad)});\n`); chmodSync(command, 0o755);
    const [row] = await collectTargetStorage([{path: tree}], {command});
    assert.equal(row.state, "unknown"); assert.equal(row.allocatedBytes, null);
  }
});

test("a failed or blocked disk probe cannot admit tempting partial sizes", async t => {
  const tree = fixture(t), dir = join(tree, "target");
  mkdirSync(dir);
  const command = join(tree, "du");
  writeFileSync(command, `#!${process.execPath}\nprocess.stdout.write('1\\t'+process.argv.at(-1)+'\\0');process.exit(1);\n`);
  chmodSync(command, 0o755);
  const [failed] = await collectTargetStorage([{path: tree}], {command});
  assert.equal(failed.state, "unknown"); assert.equal(failed.allocatedBytes, null);
  const fifo = join(tree, "blocked");
  assert.equal(spawnTest("mkfifo", [fifo], {encoding: "utf8"}).status, 0);
  writeFileSync(command, `#!${process.execPath}\nrequire('node:fs').readFileSync(${JSON.stringify(fifo)});\n`);
  const [blocked] = await collectTargetStorage([{path: tree}], {command, budgetMs: 100});
  assert.equal(blocked.state, "unknown"); assert.equal(blocked.over40GiB, null);
  assert.equal(readFileSync(join(tree, "du"), "utf8").includes("readFileSync"), true);
});

test("large-target flag is computed from the completed allocated-byte observation", async t => {
  const tree = fixture(t); mkdirSync(join(tree, "target"));
  const command = join(tree, "du");
  writeFileSync(command, `#!${process.execPath}\nprocess.stdout.write(${LARGE_TARGET_BYTES + 1}+'\\t'+process.argv.at(-1)+'\\0');\n`);
  chmodSync(command, 0o755);
  const [row] = await collectTargetStorage([{path: tree}], {command});
  assert.equal(row.state, "known"); assert.equal(row.over40GiB, true);
  assert.match(storageLines([{path: tree, lane: "owner", storage: row}]).join("\n"), /OVER 40 GiB/);
});

test("large scratch inventories are streamed without hiding target/profile totals", async t => {
  const tree = fixture(t); marker(tree, "debug", "lib-example", 1);
  const command = join(tree, "du");
  writeFileSync(command, `#!${process.execPath}\nconst fs=require('node:fs'),p=process.argv.at(-1);for(let i=0;i<25000;i++)fs.writeSync(1,'4096\\t'+p+'/scratch/case-'+i+'/output\\0');fs.writeSync(1,'4096\\t'+p+'/debug/.fingerprint\\0'+'8192\\t'+p+'/debug\\0'+'16384\\t'+p+'\\0');\n`);
  chmodSync(command, 0o755);
  const [row] = await collectTargetStorage([{path: tree}], {command, now: NOW});
  assert.equal(row.state, "known"); assert.equal(row.allocatedBytes, 16384);
  assert.equal(row.profiles[0].allocatedBytes, 8192);
  assert.equal(row.profiles[0].stale, false);
});
