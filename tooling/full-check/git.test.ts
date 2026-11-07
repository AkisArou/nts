// node --test tooling/full-check/git.test.ts
//
// Ranges along first parents, the reverts a range holds, and a commit with
// culprits reverted made in the object store alone.
import assert from "node:assert/strict";
import { test } from "node:test";
import { composeReverts, firstParents, revertedBy, revertsIn } from "./git.ts";
import { repository } from "./repository-fixture.ts";

test("a range is main's first parents, oldest first", t => {
  const repo = repository(t);
  const base = repo.commit({ "a": "0\n" }, "base");
  const one = repo.commit({ "a": "1\n" }, "one");
  const two = repo.commit({ "a": "2\n" }, "two");
  assert.deepEqual(firstParents(repo.git, base, two), [one, two]);
  assert.deepEqual(firstParents(repo.git, two, two), []);
});

test("a revert in the range closes its culprit's window; a revert of the revert does not reopen it", t => {
  const repo = repository(t);
  const base = repo.commit({ "a": "0\n" }, "base");
  const culprit = repo.commit({ "b": "bad\n" }, "culprit");
  repo.git.run(["revert", "--no-edit", culprit]);
  const revert = repo.git.run(["rev-parse", "HEAD"]);
  repo.git.run(["revert", "--no-edit", revert]);
  const again = repo.git.run(["rev-parse", "HEAD"]);
  assert.deepEqual(revertedBy(repo.git.run(["log", "-1", "--format=%B", revert])), [culprit]);
  const range = firstParents(repo.git, base, again);
  assert.deepEqual([...revertsIn(repo.git, range)], [[culprit, revert], [revert, again]]);
});

test("a composition reverts culprits on top of a base without touching a tree, and refuses one that conflicts", t => {
  const repo = repository(t);
  repo.commit({ "x": "x0\n", "y": "y0\n" }, "base");
  const first = repo.commit({ "x": "x1\n" }, "first culprit");
  const second = repo.commit({ "y": "y1\n" }, "second culprit");
  const tip = repo.commit({ "z": "z\n" }, "later");
  const status = repo.git.run(["status", "--porcelain"]);
  const composed = composeReverts(repo.git, tip, [first, second], culprit => `take out ${culprit}\n`);
  assert.ok("commit" in composed);
  if (!("commit" in composed)) return;
  assert.equal(repo.git.run(["show", `${composed.commit}:x`]), "x0");
  assert.equal(repo.git.run(["show", `${composed.commit}:y`]), "y0");
  assert.equal(repo.git.run(["show", `${composed.commit}:z`]), "z");
  assert.equal(repo.git.run(["rev-list", "--count", `${tip}..${composed.commit}`]), "2", "one commit per culprit, newest reverted first");
  assert.equal(repo.git.run(["rev-parse", "HEAD"]), tip, "HEAD, the index and the tree are untouched");
  assert.equal(repo.git.run(["status", "--porcelain"]), status);
  assert.equal(repo.git.run(["for-each-ref", "--contains", composed.commit]), "", "no ref holds it");

  const over = repo.commit({ "x": "x2\n" }, "builds on the first culprit");
  const conflict = composeReverts(repo.git, over, [first], () => "take out\n");
  assert.deepEqual(conflict, { conflict: `the revert of ${first.slice(0, 12)} does not apply to ${over.slice(0, 12)}`, culprit: first });
});
