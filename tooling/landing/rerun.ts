// `check.ts rerun <id> --step <name>`: run one step of a refused (or held)
// landing again, in the caller's own pool tree, to diagnose it
// (docs/workflow.md, "Landing: the landing check"). It never lands anything:
// it reads the queue's answer and writes only its own run directory.
//
// What it reuses from the landing it reruns, so the step runs as the landing
// ran it:
//
//   - the step, which must be one the landing ran, with the compiler's build
//     first when the landing built one;
//   - the narrowing the rules chose (landing.json's `scopes`: the interop
//     projects and doc-test crates), and the landing's ceiling;
//   - the host capabilities the landing's runner recorded (summary.json's
//     `environment.host`: JAVA_HOME, ANDROID_HOME, PATH, ...), never the
//     caller's shell, so a unit that dropped them cannot drop them here. Only
//     host capabilities are taken; anything else recorded there is refused by
//     name, as is a recorded path that is gone.
//
// It checks the caller's HEAD, and says whether that is the refused tip's
// tree (a reproduction) or another one (the caller's own change, such as a
// fix).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertLandingEnvironment } from "../gate/canonical-environment.ts";
import { HOST_CAPABILITIES } from "../gate/host-environment.ts";
import { Queue, type Result } from "./queue.ts";
import type { Ran } from "./run.ts";
import { treeOf, revParse, type Git } from "./git.ts";

/** Capabilities the canonical environment derives from the tree itself: never taken from a record. */
const DERIVED = new Set(["NTS_ORACLE_TYPESCRIPT", "NTS_ORACLE_DEPENDENCIES"]);
/** Recorded absolute paths that may be gone without the step needing them. */
const TRANSIENT = new Set(["SSH_AUTH_SOCK"]);
const HOST = new Set<string>(HOST_CAPABILITIES);

export type RerunPlan = {
  result: Result; recorded: Ran;
  /** The steps to run: the step, after the compiler's build when the landing built one. */
  steps: string[];
  interop: string | null; doctests: string | null;
  /** The launcher environment: the landing's recorded host capabilities, or the caller's when its runner recorded none. */
  env: Record<string, string>; source: "recorded" | "caller";
  commit: string; tip: string | null; base: string | null;
  /** Whether HEAD's tree is the refused tip's. */
  reproduces: boolean;
};

const short = (sha: string) => sha.slice(0, 12);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * The host capabilities a landing ran with, from its runner's summary: each
 * named one with a value, the tree-derived ones left for the canonical
 * environment to derive again. A name that is no host capability, a
 * verdict-policy variable, or a recorded path that no longer exists refuses.
 */
export function recordedHost(summary: unknown): Record<string, string> {
  const host = (summary as { environment?: { host?: unknown } } | null)?.environment?.host;
  if (!host || typeof host !== "object" || Array.isArray(host)) throw Error("its summary records no host environment");
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(host)) {
    if (!HOST.has(name)) throw Error(`its recorded environment names ${name}, which is not a host capability`);
    if (value === null || value === undefined || DERIVED.has(name)) continue;
    if (typeof value !== "string") throw Error(`its recorded ${name} is not a string`);
    env[name] = value;
  }
  assertLandingEnvironment(env);
  for (const [name, value] of Object.entries(env)) {
    if (!value.startsWith("/") || value.includes(":") || TRANSIENT.has(name)) continue;
    if (!existsSync(value)) throw Error(`its recorded ${name} ${value} no longer exists`);
  }
  return env;
}

/** What `rerun` runs, or why it refuses. Pure of the machine but for the files it reads. */
export function planRerun(request: { home: string; id: string; step: string; git: Git; head: string; caller: NodeJS.ProcessEnv }): RerunPlan {
  const result = new Queue(request.home).result(request.id);
  if (!result) throw Error(`no landing answer is ${request.id}`);
  if (result.state !== "refused" && result.state !== "held") throw Error(`rerun diagnoses a refused or held landing; ${request.id} is ${result.state}`);
  if (!result.run) throw Error(`${request.id} ran no steps: ${result.message}`);
  const file = join(result.run, "landing.json");
  if (!existsSync(file)) throw Error(`${request.id}'s run ${result.run} is gone (runs are kept three days)`);
  const recorded = readJson(file) as Ran;
  const names = (recorded.steps ?? []).map(row => row.name);
  if (!names.includes(request.step)) throw Error(`${request.step} was not one of ${request.id}'s steps: ${names.join(" ") || "none"}`);
  const steps = request.step !== "build" && names.includes("build") ? ["build", request.step] : [request.step];
  const summary = join(result.run, "summary.json");
  let env: Record<string, string>, source: RerunPlan["source"];
  if (existsSync(summary)) {
    try { env = recordedHost(readJson(summary)); } catch (error) { throw Error(`${request.id}: ${(error as Error).message}`); }
    source = "recorded";
  } else {
    // A landing whose build failed first started no runner: the caller's capabilities, checked before any step.
    env = Object.fromEntries(Object.entries(request.caller).filter((entry): entry is [string, string] => HOST.has(entry[0]) && !DERIVED.has(entry[0]) && typeof entry[1] === "string"));
    source = "caller";
  }
  const commit = revParse(request.git, request.head);
  const tip = result.tip ?? null;
  return {
    result, recorded, steps, interop: recorded.scopes?.interop ?? null, doctests: recorded.scopes?.doctests ?? null, env, source, commit, tip,
    base: result.base ?? null, reproduces: tip !== null && treeOf(request.git, commit) === treeOf(request.git, tip),
  };
}

/** The line that says what this rerun checks against the landing it reruns. */
export function describeRerun(plan: RerunPlan, step: string): string {
  const against = plan.reproduces ? `reproduces ${plan.result.id}'s tip ${short(plan.tip!)}`
    : plan.tip ? `HEAD ${short(plan.commit)} differs from ${plan.result.id}'s tip ${short(plan.tip)}${plan.base ? `; \`git rebase ${short(plan.base)}\` reproduces it exactly` : ""}`
    : `HEAD ${short(plan.commit)}; ${plan.result.id} recorded no tip`;
  const scopes = plan.recorded.scopes ? "" : "; the landing recorded no narrowing, so the step runs whole";
  return `rerun ${step} of ${plan.result.id} (${plan.result.state}): ${against}; environment ${plan.source === "recorded" ? "as the landing's runner recorded it" : "the caller's (the landing started no runner)"}${scopes}`;
}
