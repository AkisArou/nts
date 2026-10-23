import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordedTopics, revisitLandedTopics, upkeepStatus } from "./topics.ts";

test("revisits retain added unlanded commits, then CAS against the current classified tip; unrecorded branches survive", async () => {
  const parent = join(homedir(), ".cache/nts-scratch/branch-inventory"); mkdirSync(parent, { recursive: true });
  const repo = mkdtempSync(join(parent, "topics-test-"));
  const git = (args: string[]) => { const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  const commit = (file: string, body: string) => { writeFileSync(join(repo, file), body); git(["add", file]); git(["commit", "-qm", file]); return git(["rev-parse", "HEAD"]); };
  try {
    git(["init", "-q", "-b", "main"]); git(["config", "user.name", "test"]); git(["config", "user.email", "test@example.invalid"]);
    commit("base", "base\n"); git(["checkout", "-qb", "compiler/recorded"]); const original = commit("old-work", "old\n");
    git(["checkout", "-q", "main"]); commit("advance", "advance\n"); git(["cherry-pick", original]);
    git(["branch", "compiler/never-submitted"]);
    git(["checkout", "-q", "compiler/recorded"]); const current = commit("new-work", "new unlanded work\n"); git(["checkout", "-q", "main"]);
    const ref = "refs/heads/compiler/recorded", log = join(repo, "upkeep.jsonl");
    const record = { operation: "landed-submission", item: ref, status: "recorded", sha: original };
    writeFileSync(log, JSON.stringify(record) + "\n");
    assert.deepEqual(recordedTopics(log), [ref]);
    const kept = await revisitLandedTopics(repo, recordedTopics(log));
    assert.ok(kept.some(e => e.item === ref && e.status === "has unlanded commits"));
    assert.equal(git(["rev-parse", ref]), current);
    git(["cherry-pick", current]);
    const deleted = await revisitLandedTopics(repo, recordedTopics(log));
    const attempt = deleted.find(e => e.operation === "delete-landed-topic" && e.status === "attempt")!;
    assert.equal((attempt.argv as string[]).at(-1), current, "CAS uses the current classified tip, not the original landing SHA");
    assert.ok(deleted.some(e => e.item === ref && e.status === "deleted"));
    assert.equal(git(["for-each-ref", ref]), ""); assert.ok(git(["for-each-ref", "refs/heads/compiler/never-submitted"]));
    writeFileSync(log, [record, ...kept, ...deleted].map(e => JSON.stringify(e)).join("\n") + "\n");
    assert.equal(upkeepStatus(log).latest[0].status, "deleted"); assert.equal(upkeepStatus(log).recordedTopics, 1);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
