import {fixtureEnvironment} from './test-environment.ts';
import { launcherPolicyNames } from "./canonical-environment.ts";
import { spawnTest } from "./test-wait.ts";
import { copyModuleClosure } from "./module-closure-fixture.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {GateResource} from "./gate-resource.ts";
import { testScratch } from "./test-scratch.ts";

const script = readFileSync(new URL("./pinned.sh", import.meta.url), "utf8");

for (const refuses of [false, true]) for (const inherited of [false,true]) {
  test(`candidate owns input preparation${refuses ? " and its failure is preserved" : ""}${inherited ? " under the inherited tree lock" : ""}`, t => {
    const directory = testScratch(t, "pinned-candidate");
    const root = join(directory, "repo");
    const tree = join(directory, "gate-tree");
    mkdirSync(join(root, "tooling/gate"), { recursive: true });
    mkdirSync(join(root, "tooling/inputs"), { recursive: true });
    const env = Object.fromEntries(Object.entries(fixtureEnvironment(t)).filter(([key]) => !key.startsWith("GIT_") && !key.startsWith("NTS_") && !launcherPolicyNames({[key]:process.env[key]}).length));
    Object.assign(env, {
      GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      NTS_GATE_TREE: tree, NTS_GATE_TARGET: join(directory, "target"), NTS_GATE_SETUP_ONLY: "1",
      NTS_GATE_RUN_DIR: join(directory, "run"),
    });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    writeFileSync(join(root, "tooling/gate/pinned.sh"), script);
    copyModuleClosure(["tooling/gate/canonical-environment.ts", "tooling/inputs/linker.ts"], root);
    // Affinity is independently tested; this fixture isolates which commit
    // supplies preparation without depending on delegated host cpusets.
    writeFileSync(join(root, "tooling/gate/affinity.ts"), "");
    writeFileSync(join(root, "tooling/inputs/link.sh"), 'printf owner > "' + join(directory, "marker") + '"\n');
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "owner");
    const owner = git("rev-parse", "HEAD");
    writeFileSync(join(root, "tooling/inputs/link.sh"), 'test -z "${NTS_GATE_LOCK_FD:-}" || { echo "lock marker leaked into candidate tools" >&2; exit 24; }\n' + (refuses
      ? 'echo "candidate input is missing" >&2\nexit 23\n'
      : 'printf candidate > "' + join(directory, "marker") + '"\n'));
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
