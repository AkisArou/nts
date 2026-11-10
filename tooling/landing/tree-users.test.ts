// The processes that use a tree, read from /proc: by their working directory,
// their executable or an open file; never the process that asks, never one
// outside the tree.
//
//   node --test tooling/landing/tree-users.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeUsers, treeUsers } from "./tree-users.ts";

/**
 * A `cat` that runs until its input closes, started from `binary` in `cwd`.
 * With `open`, a shell opens that file on descriptor 3, says so, and becomes
 * the `cat`, which keeps it open.
 */
async function waiting(binary: string, cwd: string, open?: string) {
  const child = open === undefined ? spawn(binary, [], { cwd, stdio: ["pipe", "pipe", "ignore"] })
    : spawn("sh", ["-c", 'exec 3<"$1"; echo open; exec cat', "sh", open], { cwd, stdio: ["pipe", "pipe", "ignore"] });
  await once(child, "spawn");
  if (open !== undefined) await once(child.stdout, "data");
  return { pid: child.pid!, end: async () => { child.stdin.end(); await once(child, "exit"); } };
}

test("a process uses a tree by its working directory, its executable or an open file there, and no other way", async t => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "tree-users-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tree = join(dir, "tree"), outside = join(dir, "outside");
  mkdirSync(join(tree, "target/release"), { recursive: true }); mkdirSync(outside);
  writeFileSync(join(tree, "held.txt"), "held\n");
  copyFileSync("/usr/bin/cat", join(tree, "target/release/cat"));
  assert.deepEqual(treeUsers(tree), [], "nothing uses a new tree");
  const inside = await waiting("cat", tree);
  const reading = await waiting("cat", outside, join(tree, "held.txt"));
  const running = await waiting(join(tree, "target/release/cat"), outside);
  const elsewhere = await waiting("cat", outside);
  try {
    const users = treeUsers(tree);
    assert.deepEqual(users.map(user => `${user.pid} ${user.where}`).sort(), [
      `${inside.pid} its working directory`,
      `${reading.pid} an open file held.txt`,
      `${running.pid} its executable target/release/cat`,
    ].sort(), JSON.stringify(users));
    assert.ok(users.every(user => user.command === "cat"), JSON.stringify(users));
    assert.equal(users.some(user => user.pid === elsewhere.pid), false, "a process outside the tree does not use it");
    assert.equal(treeUsers(tree, { self: inside.pid }).some(user => user.pid === inside.pid), false, "the process that asks is never its own user");
    assert.deepEqual(treeUsers(join(tree, "target")).map(user => user.pid), [running.pid], "a folder in the tree is a tree of its own");
    assert.match(describeUsers(users, 2), /^pid \d+ cat \([^)]+\), pid \d+ cat \([^)]+\) and 1 more$/);
  } finally {
    for (const one of [inside, reading, running, elsewhere]) await one.end();
  }
  assert.deepEqual(treeUsers(tree), [], "once they end, nothing uses it");
  assert.deepEqual(treeUsers(join(dir, "gone")), [], "a tree that is not there has no users");
});
