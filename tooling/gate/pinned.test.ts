import { spawnTest } from "./test-wait.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {GateResource} from "../lanes/gate-resource.ts";

const script = readFileSync(new URL("./pinned.sh", import.meta.url), "utf8");
const scratch = join(homedir(), ".cache/nts-scratch/tsrs-lane/pinned-tests");
mkdirSync(scratch, { recursive: true });

for (const refuses of [false, true]) for (const inherited of [false,true]) {
  test(`candidate owns input preparation${refuses ? " and its failure is preserved" : ""}${inherited ? " under the inherited tree lock" : ""}`, t => {
    const directory = mkdtempSync(join(scratch, "candidate-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const root = join(directory, "repo");
    const tree = join(directory, "gate-tree");
    mkdirSync(join(root, "tooling/gate"), { recursive: true });
    mkdirSync(join(root, "tooling/lanes"), { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && !key.startsWith("NTS_")));
    Object.assign(env, {
      GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      NTS_GATE_TREE: tree, NTS_GATE_TARGET: join(directory, "target"), NTS_GATE_SETUP_ONLY: "1",
      NTS_PREPARATION_MARKER: join(directory, "marker"),
    });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    writeFileSync(join(root, "tooling/gate/pinned.sh"), script);
    // Affinity is independently tested; this fixture isolates which commit
    // supplies preparation without depending on delegated host cpusets.
    writeFileSync(join(root, "tooling/gate/affinity.ts"), "");
    writeFileSync(join(root, "tooling/lanes/inputs.sh"), 'printf owner > "$NTS_PREPARATION_MARKER"\n');
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "owner");
    const owner = git("rev-parse", "HEAD");
    writeFileSync(join(root, "tooling/lanes/inputs.sh"), 'test -z "${NTS_GATE_LOCK_FD:-}" || { echo "lock marker leaked into candidate tools" >&2; exit 24; }\n' + (refuses
      ? 'echo "candidate input is missing" >&2\nexit 23\n'
      : 'printf candidate > "$NTS_PREPARATION_MARKER"\n'));
    git("add", ".");
    git("commit", "-qm", "candidate");
    const candidate = git("rev-parse", "HEAD");
    git("checkout", "--detach", "-q", owner);
    const held=inherited ? GateResource.tryAcquire(`${tree}.lock`)! : null;
    const result = spawnTest("sh", [join(root, "tooling/gate/pinned.sh"), candidate], { cwd: root, env:{...env,...(held?{NTS_GATE_LOCK_FD:"8"}:{})}, encoding: "utf8",
      ...(held ? {stdio:held.stdio("pipe")} : {}) });
    held?.close();
    if (refuses) {
      assert.equal(result.status, 23, result.stdout + result.stderr);
      assert.match(result.stderr, /candidate input is missing/);
    } else {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(readFileSync(join(directory, "marker"), "utf8"), "candidate");
    }
  });
}
