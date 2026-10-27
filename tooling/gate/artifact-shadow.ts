import { vmToolFlags } from "../jvm/vm-flags.ts";
// Observe prospective cache hits. This module never executes or skips work.
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type File = { name: string; path: string };
export type Inputs = { files: File[]; absent?: string[]; values?: unknown };
type Status = "miss" | "hit-match" | "hit-mismatch" | "unavailable";
export type ShadowRow = { event: "artifact.shadow"; kind: string; step: string; epoch: number;
  status: Status; key: string | null; run: string | null; baseline_run?: string | null;
  context: string | null; runtime_inputs?: "unreviewed"; evidence?: string; evidence_error?: string;
  result_sha256?: string; previous_sha256?: string; error?: string };
let counter = 0;
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  : value ?? null;
export const canonicalJson = (value: unknown) => JSON.stringify(canonical(value));
const json = canonicalJson;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const fileDigest = (path: string) => digest(readFileSync(path));

const jdkDigests = new Map<string, unknown>();
/** Hash the JDK payload once per run, with file identity checked on every use.
 * A launcher/version alone misses an in-place modules or VM update. */
export function jdkIdentity(home: string, env: NodeJS.ProcessEnv = process.env): unknown {
  const files = ["release", "lib/modules"];
  for (const native of ["lib/server/libjvm.so", "lib/server/libjvm.dylib", "bin/server/jvm.dll"]) {
    if (existsSync(join(home, native))) files.push(native);
  }
  const stamps = () => files.map(name => {
    const s = statSync(join(home, name), { bigint: true });
    if (!s.isFile()) throw new Error(`non-regular JDK input: ${name}`);
    return [name, String(s.dev), String(s.ino), String(s.size), String(s.mtimeNs), String(s.ctimeNs)];
  });
  const before = json(stamps()), key = digest(json({ home: realpathSync(home), before }));
  if (jdkDigests.has(key)) return jdkDigests.get(key);
  const saved = env.NTS_GATE_RUN_DIR ? join(env.NTS_GATE_RUN_DIR, "share/shadow-jdks", `${key}.json`) : null;
  if (saved) {
    try {
      const value = JSON.parse(readFileSync(saved, "utf8"));
      if (value.key === key && json(Object.keys(value.files).sort()) === json([...files].sort())
        && Object.values(value.files).every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash))) {
        jdkDigests.set(key, value.files); return value.files;
      }
    } catch { /* Missing or corrupt identity: hash the installed files. */ }
  }
  const value = Object.fromEntries(files.map(name => [name, fileDigest(join(home, name))]));
  if (json(stamps()) !== before) throw new Error("JDK changed while hashing its payload");
  if (saved) publish(saved, { key, files: value });
  jdkDigests.set(key, value);
  return value;
}

export function normalizeInputPaths(log: string, inputs: File[]): string {
  // d8 warnings embed the absolute input path; the output depends only on the bytes.
  // Before any skipping, cached artifact names must be rendered with the
  // current invocation's paths so a reused log never names another fixture.
  for (const input of [...inputs].sort((a, b) => b.path.length - a.path.length)) {
    if (!input.path || !input.name) throw new Error("empty invocation input");
    log = log.split(input.path).join(input.name);
  }
  return log;
}

export function artifactFiles(root: string, prefix = "artifact"): File[] {
  const files: File[] = [];
  function walk(path: string, name: string) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) walk(join(path, entry.name), `${name}/${entry.name}`);
      else if (entry.isFile()) files.push({ name: `${name}/${entry.name}`, path: join(path, entry.name) });
      else throw new Error(`non-regular artifact: ${join(path, entry.name)}`);
    }
  }
  walk(root, prefix);
  return files;
}

function keyOf(kind: string, input: Inputs): string {
  if (input.absent?.some(path => existsSync(path))) throw new Error("an absent input appeared during fresh execution");
  const files = input.files.map(f => ({ name: f.name, sha256: fileDigest(f.path) })).sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(files.map(f => f.name)).size !== files.length) throw new Error("duplicate artifact input name");
  return digest(json({ version: 1, kind, files, absent: input.absent ?? [], values: input.values }));
}

function publish(path: string, value: unknown): boolean {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, json(value), { flag: "wx" });
    try { linkSync(temporary, path); return true; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; return false; }
  } finally { rmSync(temporary, { force: true }); }
}

export function artifactShadow(kind: string, inputs: () => Inputs, env: NodeJS.ProcessEnv = process.env, expectedKey?: string | null, context: string | null = null, compare?: (result: any) => unknown) {
  if (!env.NTS_GATE_SHADOW_DIR || !env.NTS_GATE_CASE_COSTS_DIR || !env.NTS_GATE_STEP) return Object.assign((_result: unknown): ShadowRow | null => null, { key: null });
  let key: string | null = null, error: string | undefined;
  try {
    if (!/^[a-z0-9-]+$/.test(kind)) throw new Error("invalid shadow kind");
    key = keyOf(kind, inputs());
  } catch (e) { error = String(e); }
  return Object.assign((result: unknown): ShadowRow => {
    const row: ShadowRow = { event: "artifact.shadow", kind, step: env.NTS_GATE_STEP!, epoch: Date.now() / 1000,
      status: "unavailable", key, run: env.NTS_GATE_RUN_DIR ?? null, context,
      ...(kind.startsWith("bench-") ? { runtime_inputs: "unreviewed" as const } : {}) };
    try {
      if (!key || error) throw new Error(error ?? "no artifact key");
      if (expectedKey !== undefined && expectedKey !== key) throw new Error("artifact inputs changed during fresh execution");
      if (keyOf(kind, inputs()) !== key) throw new Error("artifact inputs changed during fresh execution");
      const comparison = compare ? compare(result) : result;
      const resultHash = digest(json(comparison));
      const payload = { result, ...(compare ? { comparison_result: comparison, raw_sha256: digest(json(result)) } : {}) };
      const path = join(env.NTS_GATE_SHADOW_DIR!, kind, `${key}.json`);
      row.result_sha256 = resultHash;
      if (publish(path, { version: 1, key, result_sha256: resultHash, run: row.run, context, ...payload })) row.status = "miss";
      else {
        const previous = JSON.parse(readFileSync(path, "utf8"));
        if (previous.version !== 1 || previous.key !== key || !/^[a-f0-9]{64}$/.test(previous.result_sha256)) throw new Error("invalid shadow entry");
        row.previous_sha256 = previous.result_sha256;
        row.baseline_run = previous.run ?? null;
        row.status = previous.result_sha256 === resultHash ? "hit-match" : "hit-mismatch";
        try {
          // Upgrade digest-only entries only after proving the payload matches
          // the original digest. Never replace that immutable comparison point.
          if (row.status === "hit-match" && !Object.hasOwn(previous, "result")) {
            publish(`${path}.result.json`, { result_sha256: resultHash, context, ...payload });
          }
          if (row.status === "hit-mismatch") {
            let baseline = previous;
            if (!Object.hasOwn(baseline, "result")) {
              try { baseline = JSON.parse(readFileSync(`${path}.result.json`, "utf8")); }
              catch { baseline = {}; }
            }
            const baselineComparison = Object.hasOwn(baseline, "comparison_result") ? baseline.comparison_result : baseline.result;
            const available = Object.hasOwn(baseline, "result") && digest(json(baselineComparison)) === previous.result_sha256
              && (!Object.hasOwn(baseline, "comparison_result") || digest(json(baseline.result)) === baseline.raw_sha256);
            const fields = available && comparison && typeof comparison === "object" && baselineComparison && typeof baselineComparison === "object"
              ? [...new Set([...Object.keys(comparison), ...Object.keys(baselineComparison)])].sort() : null;
            const evidence = join(env.NTS_GATE_CASE_COSTS_DIR!, `shadow-mismatch-${process.pid}-${counter++}.json`);
            writeFileSync(evidence, json({ version: 1, kind, key, context,
              changed_components: fields?.filter(field => json((comparison as any)[field]) !== json(baselineComparison[field])) ?? null,
              baseline: { available, context: baseline.context ?? null, result_sha256: previous.result_sha256,
                result: available ? baseline.result : null, comparison_result: available ? baselineComparison : null },
              fresh: { result_sha256: resultHash, result, comparison_result: comparison } }), { flag: "wx" });
            row.evidence = evidence;
          }
        } catch (e) { row.evidence_error = String(e); }
      }
    } catch (e) { row.error = String(e); }
    try { appendFileSync(join(env.NTS_GATE_CASE_COSTS_DIR!, `shadow-${process.pid}-${counter++}.jsonl`), json(row) + "\n"); }
    catch { /* Observations cannot affect the fresh verdict. */ }
    return row;
  }, { key });
}

// Cache version discovery within this run only, keyed by the tool's own bytes
// and relevant environment. Artifact/result keys also include this identity.
export function toolIdentity(command: string): unknown {
  const located = command.includes("/") ? resolve(command) : spawnSync("sh", ["-c", 'command -v "$1"', "sh", command], { encoding: "utf8" }).stdout.trim();
  if (!located) throw new Error(`tool not found: ${command}`);
  const executable = realpathSync(located);
  const environment = Object.fromEntries(["LANG", "LC_ALL", "TZ", "JAVA_HOME", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "LD_LIBRARY_PATH", "LD_PRELOAD", "NODE_OPTIONS"].map(k => [k, process.env[k] ?? null]));
  const jdkTool = ["java", "javac", "javap", "jar", "jmod", "jdeps", "javadoc", "jlink", "keytool"].includes(basename(command).replace(/\.exe$/, ""));
  const identity = { executable_sha256: fileDigest(executable), environment, vm_flags: vmToolFlags(command),
    ...(jdkTool ? { jdk: jdkIdentity(dirname(dirname(executable))) } : {}) };
  const versionKey = digest(json(identity));
  const saved = process.env.NTS_GATE_RUN_DIR ? join(process.env.NTS_GATE_RUN_DIR, "share/shadow-tools", `${versionKey}.json`) : null;
  if (saved) { try { return JSON.parse(readFileSync(saved, "utf8")); } catch { /* Discover below. */ } }
  const version = spawnSync(executable, [...vmToolFlags(command), "--version"], { encoding: "utf8", timeout: 10_000 });
  if (version.error || version.status !== 0) throw new Error(`cannot identify ${command}: ${version.error ?? version.stderr}`);
  const value = { ...identity, version: version.stdout + version.stderr };
  if (saved) publish(saved, value);
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Shell consumers call this after unconditional fresh execution.
  const flag = (name: string) => process.argv[process.argv.indexOf(name) + 1];
  try {
    if (process.argv.includes("--request")) {
      const request = JSON.parse(readFileSync(flag("--request"), "utf8"));
      const observe = artifactShadow(request.kind, () => ({ files: request.files, absent: request.absent,
        values: { ...request.values, tools: request.tools.map(toolIdentity) } }), process.env,
        request.mode === "finish" ? request.expected_key : undefined,
        typeof request.context === "string" ? request.context : null);
      process.stdout.write(JSON.stringify(request.mode === "prepare" ? { key: observe.key } : observe(request.result)) + "\n");
    } else {
      const root = flag("--inputs"), output = flag("--result");
      const invocationInputs = () => {
        if (!process.argv.includes("--invocation-inputs")) throw new Error("missing d8 invocation inputs");
        const files = new Map(artifactFiles(root).map(file => [resolve(file.path), file]));
        const paths = readFileSync(flag("--invocation-inputs"), "utf8").split("\0").filter(Boolean);
        if (!paths.length) throw new Error("empty d8 invocation inputs");
        return paths.map(path => {
          const file = files.get(resolve(path));
          if (!file) throw new Error(`unrecorded d8 input: ${path}`);
          return { name: file.name, path };
        });
      };
      const observe = artifactShadow(flag("--kind"), () => ({ files: [
        ...artifactFiles(root), { name: "step-script", path: flag("--script") },
        { name: "tool-library", path: flag("--tool-library") },
        { name: "result-policy", path: fileURLToPath(import.meta.url) },
      ], values: { tool: toolIdentity(flag("--tool")), java: toolIdentity(flag("--java")), flags: ["--min-api", "29"],
        log_origin_policy: 1, invocation_inputs: invocationInputs().map(f => f.name) } }), process.env, undefined,
        process.argv.includes("--context") ? flag("--context") : null,
        result => ({ ...result, log: normalizeInputPaths(result.log, invocationInputs()) }));
      observe({ status: Number(flag("--status")), log: readFileSync(output, "utf8"), outputs: artifactFiles(flag("--outputs")).map(f => ({ name: f.name, sha256: fileDigest(f.path) })) });
    }
  } catch { /* A failed shell observation never changes the tool's verdict. */ }
}
