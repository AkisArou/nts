// Observe prospective cache hits. This module never executes or skips work.
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type File = { name: string; path: string };
type Inputs = { files: File[]; values?: unknown };
type Status = "miss" | "hit-match" | "hit-mismatch" | "unavailable";
export type ShadowRow = { event: "artifact.shadow"; kind: string; step: string; epoch: number;
  status: Status; key: string | null; run: string | null; baseline_run?: string | null;
  result_sha256?: string; previous_sha256?: string; error?: string };
let counter = 0;
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  : value ?? null;
const json = (value: unknown) => JSON.stringify(canonical(value));
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const fileDigest = (path: string) => digest(readFileSync(path));

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
  const files = input.files.map(f => ({ name: f.name, sha256: fileDigest(f.path) })).sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(files.map(f => f.name)).size !== files.length) throw new Error("duplicate artifact input name");
  return digest(json({ version: 1, kind, files, values: input.values }));
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

export function artifactShadow(kind: string, inputs: () => Inputs, env: NodeJS.ProcessEnv = process.env) {
  if (!env.NTS_GATE_SHADOW_DIR || !env.NTS_GATE_CASE_COSTS_DIR || !env.NTS_GATE_STEP) return (_result: unknown): ShadowRow | null => null;
  let key: string | null = null, error: string | undefined;
  try {
    if (!/^[a-z0-9-]+$/.test(kind)) throw new Error("invalid shadow kind");
    key = keyOf(kind, inputs());
  } catch (e) { error = String(e); }
  return (result: unknown): ShadowRow => {
    const row: ShadowRow = { event: "artifact.shadow", kind, step: env.NTS_GATE_STEP!, epoch: Date.now() / 1000,
      status: "unavailable", key, run: env.NTS_GATE_RUN_DIR ?? null };
    try {
      if (!key || error) throw new Error(error ?? "no artifact key");
      if (keyOf(kind, inputs()) !== key) throw new Error("artifact inputs changed during fresh execution");
      const resultHash = digest(json(result));
      const path = join(env.NTS_GATE_SHADOW_DIR!, kind, `${key}.json`);
      row.result_sha256 = resultHash;
      if (publish(path, { version: 1, key, result_sha256: resultHash, run: row.run })) row.status = "miss";
      else {
        const previous = JSON.parse(readFileSync(path, "utf8"));
        if (previous.version !== 1 || previous.key !== key || !/^[a-f0-9]{64}$/.test(previous.result_sha256)) throw new Error("invalid shadow entry");
        row.previous_sha256 = previous.result_sha256;
        row.baseline_run = previous.run ?? null;
        row.status = previous.result_sha256 === resultHash ? "hit-match" : "hit-mismatch";
      }
    } catch (e) { row.error = String(e); }
    try { appendFileSync(join(env.NTS_GATE_CASE_COSTS_DIR!, `shadow-${process.pid}-${counter++}.jsonl`), json(row) + "\n"); }
    catch { /* Observations cannot affect the fresh verdict. */ }
    return row;
  };
}

// Cache version discovery within this run only, keyed by the tool's own bytes
// and relevant environment. Artifact/result keys also include this identity.
export function toolIdentity(command: string): unknown {
  const located = command.includes("/") ? resolve(command) : spawnSync("sh", ["-c", 'command -v "$1"', "sh", command], { encoding: "utf8" }).stdout.trim();
  if (!located) throw new Error(`tool not found: ${command}`);
  const executable = realpathSync(located);
  const environment = Object.fromEntries(["LANG", "LC_ALL", "TZ", "JAVA_HOME", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "LD_LIBRARY_PATH", "LD_PRELOAD", "NODE_OPTIONS"].map(k => [k, process.env[k] ?? null]));
  const identity = { executable_sha256: fileDigest(executable), environment };
  const versionKey = digest(json(identity));
  const saved = process.env.NTS_GATE_RUN_DIR ? join(process.env.NTS_GATE_RUN_DIR, "share/shadow-tools", `${versionKey}.json`) : null;
  if (saved) { try { return JSON.parse(readFileSync(saved, "utf8")); } catch { /* Discover below. */ } }
  const version = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (version.error || version.status !== 0) throw new Error(`cannot identify ${command}: ${version.error ?? version.stderr}`);
  const value = { ...identity, version: version.stdout + version.stderr };
  if (saved) publish(saved, value);
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Shell consumers call this after unconditional fresh execution.
  const flag = (name: string) => process.argv[process.argv.indexOf(name) + 1];
  try {
    const root = flag("--inputs"), output = flag("--result");
    const observe = artifactShadow(flag("--kind"), () => ({ files: [
      ...artifactFiles(root), { name: "step-script", path: flag("--script") },
      { name: "tool-library", path: flag("--tool-library") },
    ], values: { tool: toolIdentity(flag("--tool")), java: toolIdentity(flag("--java")), flags: ["--min-api", "29"] } }));
    observe({ status: Number(flag("--status")), log: readFileSync(output, "utf8"), outputs: artifactFiles(flag("--outputs")).map(f => ({ name: f.name, sha256: fileDigest(f.path) })) });
  } catch { /* A failed shell observation never changes the tool's verdict. */ }
}
