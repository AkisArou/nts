import {fixtureEnvironment} from "../gate/test-environment.ts";
// A scratch repository for the landing check's tests: a local bare `origin`,
// a clone with main checked out (the shared checkout), and git configured
// only by the test, so a person's global config cannot change what runs.
// No test reaches the network.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import {testScratch} from '../gate/test-scratch.ts';

export type Scratch = {
  dir: string; root: string; origin: string; env: NodeJS.ProcessEnv;
  git: (args: readonly string[], cwd?: string) => string;
  /** Write (or, with null, delete) files in `cwd` and commit them there. */
  commit: (files: Readonly<Record<string, string | null>>, message: string, cwd?: string) => string;
};

export function scratchRepo(t: TestContext, name = "landing"): Scratch {
  const dir = testScratch(t,name);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = { ...fixtureEnvironment(t), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Agent", GIT_AUTHOR_EMAIL: "agent@example.invalid", GIT_COMMITTER_NAME: "Landing", GIT_COMMITTER_EMAIL: "landing@example.invalid" };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[name];
  const git = (args: readonly string[], cwd = root) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const origin = join(dir, "origin.git"), root = join(dir, "nts");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env });
  execFileSync("git", ["init", "-q", "-b", "main", root], { env });
  git(["remote", "add", "origin", origin]);
  const commit = (files: Readonly<Record<string, string | null>>, message: string, cwd = root) => {
    for (const [path, text] of Object.entries(files)) {
      if (text === null) git(["rm", "-q", "--", path], cwd);
      else { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), text); git(["add", "--", path], cwd); }
    }
    git(["commit", "-q", "-m", message], cwd);
    return git(["rev-parse", "HEAD"], cwd);
  };
  // Every tree has its own input linker (tooling/inputs/linker.ts); this one has nothing to link.
  commit({ "README.md": "nts\n", "docs/workflow.md": "how we work\n", "tooling/inputs/link.sh": "#!/bin/sh\nexit 0\n" }, "base");
  git(["push", "-q", "origin", "main"]);
  return { dir, root, origin, env, git, commit };
}
