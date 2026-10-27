import { appendFileSync, existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { artifactShadow, canonicalJson, type Inputs } from "./artifact-shadow.ts";
import { REUSE } from "./artifact-reuse-policy.ts";
export { REUSE } from "./artifact-reuse-policy.ts";

type Kind = keyof typeof REUSE;
export type VerifierResult = { status: number | null; signal: string | null; error: string | null; stdout: string; stderr: string };
let counter = 0;

/** Verification reads emitted classes and the JDK, never the lander's shell
 * options or locale. Use this exact allowlist for execution and its key. */
export function verifierEnvironment(command: string, parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const located = command.includes("/") ? resolve(command) : spawnSync("sh", ["-c", 'command -v "$1"', "sh", command], { encoding: "utf8", env: parent }).stdout.trim();
  const home = dirname(dirname(realpathSync(located)));
  if (!existsSync(join(home, "release")) || !existsSync(join(home, "lib/modules"))) throw new Error(`cannot resolve JDK home for ${command}; set JAVA_HOME to the JDK`);
  return { PATH: [join(home, "bin"), "/usr/bin", "/bin"].join(delimiter), JAVA_HOME: home, LANG: "C.UTF-8" };
}

/** GNU time waits for this tool's descendants; capture/emission and hashing
 * are outside the measurement. The inner timeout owns its process group and
 * preserves the existing 900-second verifier bound. The outer guard leaves
 * it time to reap, rather than killing time and orphaning the verifier. */
export async function verifierExecution(run: (command: string, args: string[], timeout?: number) => Promise<any>,
  command: string, args: string[], scratch: string): Promise<{ result: VerifierResult; cpu_s: number | null }> {
  const timed = process.platform === "linux" && existsSync("/usr/bin/time") && existsSync("/usr/bin/timeout");
  const output = join(scratch, `verifier-time-${randomUUID()}`);
  try {
    const execution = await run(timed ? "/usr/bin/time" : command, timed
      ? ["--quiet", "-f", "%U %S", "-o", output, "/usr/bin/timeout", "--signal=KILL", "900", command, ...args] : args, timed ? 930_000 : 900_000);
    let cpu_s: number | null = null;
    if (timed) {
      try {
        const fields = readFileSync(output, "utf8").trim().split(/\s+/);
        if (fields.length === 2 && fields.every(v => /^\d+(?:\.\d+)?$/.test(v))) cpu_s = fields.map(Number).reduce((a, b) => a + b, 0);
      } catch { /* Unknown is not zero. */ }
    }
    return { result: { status: execution.status ?? null, signal: execution.signal ?? null,
      error: execution.error?.message ?? null, stdout: execution.stdout, stderr: execution.stderr }, cpu_s };
  } finally { try { rmSync(output, { force: true }); } catch { /* Observation cleanup only. */ } }
}

/** Only complete, path-independent verifier protocol results may be reused.
 * The caller still parses the result and applies today's known-list policy. */
export function completeVerifier(value: unknown, classes: number): value is VerifierResult {
  if (!value || typeof value !== "object" || classes <= 0) return false;
  const v = value as VerifierResult;
  if (v.status !== 0 || v.signal !== null || v.error !== null || typeof v.stdout !== "string" || v.stderr !== "") return false;
  const lines = v.stdout.trim().split("\n"), summaries = lines.filter(line => /^VERIFIED \d+ OF \d+$/.test(line));
  if (summaries.length !== 1 || lines.at(-1) !== summaries[0]) return false;
  if (lines.some(line => !/^(INVALID |MISSING |UNRESOLVED |SHADOWED |UNFILLED |VERIFIED )/.test(line))) return false;
  const summary = /^VERIFIED (\d+) OF (\d+)$/.exec(summaries[0])!;
  const failed = lines.filter(line => /^(INVALID|MISSING) /.test(line)).length;
  return Number(summary[2]) === classes && Number(summary[1]) + failed === classes;
}

/** Cache failures always fall back to fresh execution. Only this kind has a
 * reuse path; no environment variable can enable it in the production gate. */
export async function artifactResult<T>(kind: Kind, inputs: () => Inputs, fresh: () => Promise<{ result: T; cpu_s: number | null }>,
  accept: (value: unknown) => value is T, context: string, options: { env?: NodeJS.ProcessEnv; enabled?: boolean; log?: (line: string) => void } = {}): Promise<T> {
  const env = options.env ?? process.env, enabled = options.enabled ?? REUSE[kind];
  const observe = artifactShadow(kind, inputs, env, undefined, context);
  let source: string | null = null, reused: T | undefined;
  if (enabled && observe.key && env.NTS_GATE_SHADOW_DIR) {
    try {
      const entry = JSON.parse(readFileSync(join(env.NTS_GATE_SHADOW_DIR, kind, `${observe.key}.json`), "utf8"));
      const hash = createHash("sha256").update(canonicalJson(entry.result)).digest("hex");
      if (entry.version === 1 && entry.key === observe.key && entry.result_sha256 === hash
        && typeof entry.run === "string" && entry.run.length > 0 && !Object.hasOwn(entry, "comparison_result")
        && Object.hasOwn(entry, "result") && accept(entry.result)
        && artifactShadow(kind, inputs, env).key === observe.key) {
        source = entry.run; reused = entry.result;
      }
    } catch { /* Never trust a missing, corrupt or incomplete payload. */ }
  }
  const record = (status: string, cpu: number | null, shadow?: string) => {
    try {
      if (env.NTS_GATE_CASE_COSTS_DIR && env.NTS_GATE_STEP) appendFileSync(join(env.NTS_GATE_CASE_COSTS_DIR, `reuse-${process.pid}-${counter++}.jsonl`), JSON.stringify({
        event: "artifact.reuse", kind, step: env.NTS_GATE_STEP, context, key: observe.key,
        run: env.NTS_GATE_RUN_DIR ?? null, baseline_run: source, status, enabled,
        tool_cpu_s: cpu, matching_hit_cpu_s: shadow === "hit-match" ? cpu : null,
      }) + "\n");
    } catch { /* Cost recording cannot change the result. */ }
  };
  if (reused !== undefined) {
    (options.log ?? console.log)(`  cache reuse ${kind}: key=${observe.key} source_run=${source}`);
    record("reused", null);
    return reused;
  }
  const measured = await fresh();
  const shadow = observe(measured.result);
  record("fresh", measured.cpu_s, shadow?.status);
  return measured.result;
}
