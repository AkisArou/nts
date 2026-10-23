import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ARCHIVE_HEADER, parseArchives, requireArchiveCoverage } from "./archive.ts";
import { branchHealth, healthLines } from "./health.ts";
import { inventory } from "./branches.ts";

test("registry coverage is exact, inventory rejects both directions, and health shares patch equivalence", async () => {
  const parent = join(homedir(), ".cache/nts-scratch/branch-inventory"); mkdirSync(parent, { recursive: true });
  const repo = mkdtempSync(join(parent, "registry-test-"));
  const env = { ...process.env, GIT_AUTHOR_DATE: new Date(Date.now() - 5 * 86400000).toISOString(), GIT_COMMITTER_DATE: new Date(Date.now() - 5 * 86400000).toISOString() };
  const git = (args: string[]) => { const r = spawnSync("git", args, { cwd: repo, env, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const file = join(repo, "tooling/lanes/archive.tsv");
  const commit = (path: string, body: string, subject: string) => { writeFileSync(join(repo, path), body); git(["add", "--", path]); git(["commit", "-qm", subject]); return git(["rev-parse", "HEAD"]); };
  try {
    git(["init", "-q", "-b", "main"]); git(["config", "user.name", "test"]); git(["config", "user.email", "test@example.invalid"]);
    mkdirSync(join(repo, "tooling/lanes"), { recursive: true }); writeFileSync(file, ARCHIVE_HEADER + "\n");
    git(["add", "."]); git(["commit", "-qm", "base"]); const base = git(["rev-parse", "HEAD"]);
    git(["checkout", "-qb", "jvm/unlanded"]); commit("unlanded", "work\n", "unlanded work");
    git(["checkout", "-qb", "wasm/replay", base]); const replay = commit("replay", "same patch\n", "replay");
    git(["checkout", "-q", "main"]); commit("advance", "advance\n", "advance"); git(["cherry-pick", replay]);
    git(["checkout", "-qb", "sdk/subject", base]); commit("subject-before", "old\n", "amended landing");
    git(["checkout", "-q", "main"]); commit("subject-after", "new\n", "amended landing");
    const archive = "refs/archive/jvm/saved"; git(["update-ref", archive, base]);
    assert.throws(() => requireArchiveCoverage([archive], file), /1 missing rows/);
    await assert.rejects(inventory({ repo }), /1 missing rows/);
    writeFileSync(file, ARCHIVE_HEADER + `\n${archive}\tjvm\twork\tpaused\tunknown\nrefs/archive/jvm/orphan\tjvm\tunknown\tunknown\tunknown\n`);
    await assert.rejects(inventory({ repo }), /1 rows without refs/);
    writeFileSync(file, ARCHIVE_HEADER + `\n${archive}\tjvm\twork\tpaused\tunknown\n`);
    assert.equal(requireArchiveCoverage([archive], file).length, 1);
    const before = git(["show-ref"]), index = readFileSync(join(repo, ".git/index"));
    const health = await branchHealth(repo);
    assert.deepEqual(health.unlanded.map(b => [b.name, b.state]), [["jvm/unlanded", "UNLANDED"], ["sdk/subject", "PROBABLY-LANDED"]]);
    assert.deepEqual(health.archivesWithoutRegistry, []);
    assert.deepEqual(health.registryWithoutRefs, []);
    assert.ok(healthLines(health).join("\n").includes("unlanded branches older than 3 days: 2"));
    writeFileSync(file, ARCHIVE_HEADER + "\n");
    assert.deepEqual((await branchHealth(repo)).archivesWithoutRegistry, [archive]);
    assert.equal(git(["show-ref"]), before); assert.deepEqual(readFileSync(join(repo, ".git/index")), index);
    assert.throws(() => parseArchives(ARCHIVE_HEADER + `\n${archive}\tjvm\twork\tpaused\tunknown\n${archive}\tjvm\twork\tpaused\tunknown\n`), /duplicate/);
    assert.throws(() => parseArchives(ARCHIVE_HEADER + `\n${archive}\tjvm\t\tpaused\tunknown\n`), /nonempty/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
