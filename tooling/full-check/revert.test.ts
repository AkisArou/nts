import assert from "node:assert/strict";
import {test} from "node:test";
import {issueComment, revertMessage, type Finding} from "./revert.ts";

const finding: Finding = {
  part: "core", culprit: "bad-commit", subject: "breaks tests", steps: ["tests"],
  run: "/runs/red", tip: "tip-commit", good: "good-commit", candidates: 3,
  probes: ["/runs/probe"], main: {commit: "main-commit", through: "main-commit", run: "/runs/main"},
};
const previousRevert = `Revert "breaks tests"

This reverts commit bad-commit.

The full check's core run was red at tip-commit in
tests (run /runs/red). Among the 3
commit(s) since the last green core run at good-commit, the culprit
search found bad-commit to be the first red one.
Probes: /runs/probe.
Newest main remained red at main-commit (probe /runs/main),
valid through main-commit by the owed rules.

Full-check-step: tests
Full-check-run: /runs/red
`;
const previousIssue = `The full check found that bad-commit ("breaks tests") turned tests red in its core run at tip-commit.

- The logs: \`/runs/red/tests.log\`.
- The culprit search chose it among the 3 commit(s) since the last green core run at good-commit, measured in \`/runs/probe\`.
- Newest main was still red at main-commit (probe \`/runs/main\`), valid through main-commit by the owed rules.
- Its revert, rev-commit, is queued first in the landing check.

The task is open again: land it again with a fix.
`;

test("an existing finding without a note retains its exact revert and issue text", () => {
  assert.equal(revertMessage(finding), previousRevert);
  assert.equal(issueComment(finding, "rev-commit"), previousIssue);
});

test("one search-owned finding note reaches both revert and issue text unchanged", () => {
  const note = "no failure identity for tests: range not extended", withNote = {...finding, note};
  assert.equal(revertMessage(withNote), previousRevert.replace("Newest main remained red", note + "\nNewest main remained red"));
  assert.equal(issueComment(withNote, "rev-commit"), previousIssue.replace("- Newest main was still red", "- " + note + "\n- Newest main was still red"));
});
