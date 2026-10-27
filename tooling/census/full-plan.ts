import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { gateEnvironment } from "../gate/canonical-environment.ts";
import { STANDING_GATE_POLICY } from "../gate/verdict-policy.ts";

export function fullPlan(root: string, home: string, args: string[], now = Date.now()) {
  const candidate = args.includes("--candidate");
  const positional = args.filter(arg => arg !== "--candidate");
  if (positional.length > 1 || positional.some(arg => arg.startsWith("--")) || (candidate && positional.length !== 1)) {
    throw new Error("usage: node tooling/census/full.ts [commit] [--candidate] (candidate requires an explicit commit)");
  }
  const asked = positional[0] ?? "main";
  const resolved = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${asked}^{commit}`], { cwd: root, encoding: "utf8" });
  if (resolved.status !== 0) throw new Error(`\`${asked}\` names no commit`);
  // Resolve once. Every later command consumes this immutable object ID, even
  // if the caller's branch moves while waiting for the landing lock.
  const commit = resolved.stdout.trim();
  if (!candidate && spawnSync("git", ["merge-base", "--is-ancestor", commit, "main"], { cwd: root }).status !== 0) {
    throw new Error(`${asked} is not on main -- use --candidate for explicit pre-landing validation`);
  }
  const scope = candidate ? join(home, "candidates") : home;
  const label = candidate ? "CANDIDATE" : "MAIN";
  return {
    candidate, commit, label,
    run: join(scope, "runs", `${candidate ? "CANDIDATE-" : ""}${commit.slice(0, 12)}-${now}`),
    tree: join(scope, "tree"),
    target: join(scope, "target"),
  };
}

export function fullEnvironment(plan: ReturnType<typeof fullPlan>, steps: string[], base: NodeJS.ProcessEnv) {
  return gateEnvironment(base, {run:plan.run, standalone:true, owned:{
    ...STANDING_GATE_POLICY,
    // Candidate times must not rewrite even its pinned policy records.
    ...(plan.candidate ? { NTS_GATE_RECORD_TIMES: "0" } : {}),
    NTS_GATE_STEPS: steps.join(" "),
    NTS_GATE_TREE: plan.tree,
    NTS_GATE_TARGET: plan.target,
    NTS_GATE_RUN_DIR: plan.run,
    NTS_CHECKERS: "1",
  }}).env;
}
