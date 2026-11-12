// Portable identity of the canonical environment in which a step was checked.
// Run allocations belong in the original report, while this identity survives
// moving the same checked commit between the landing and full-check trees.
import { createHash } from "node:crypto";
import { TEST_PROFILE } from "./test-profile.ts";
import {infrastructureProbe,type InfrastructureProbe} from "./infrastructure-probe.ts";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gateEnvironment, HOST_INFRASTRUCTURE, type EnvironmentReport } from "./canonical-environment.ts";
import { PLATFORMS_UNRUN_OK, STANDING_GATE_POLICY } from "./verdict-policy.ts";

export type VerdictContract = {
  version: 1;
  identity: string;
  environment: {
    host: Record<string, unknown>;
    ambient: Record<string, string | null>;
    platform: string;
    arch: string;
    node: string;
    policy: unknown;
    tools: Record<string, string>;
    inputs: Record<string, string | null>;
    test_profiles: readonly string[];
  };
};

const digest = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, ordered(object[key])]));
  }
  return value;
}

export function contractIdentity(environment: VerdictContract["environment"]): string {
  return digest(JSON.stringify(ordered(environment)));
}

/** Validate stored contracts before their equality can certify any outcome. */
export function validContract(value: unknown): value is VerdictContract {
  if (!value || typeof value !== "object") return false;
  const contract = value as VerdictContract;
  return contract.version === 1 && typeof contract.identity === "string" &&
    contract.environment !== null && typeof contract.environment === "object" &&
    typeof contract.environment.host === "object" && contract.environment.host !== null &&
    typeof contract.environment.ambient === "object" && contract.environment.ambient !== null &&
    typeof contract.environment.platform === "string" && typeof contract.environment.arch === "string" &&
    typeof contract.environment.node === "string" && typeof contract.environment.tools === "object" &&
    typeof contract.environment.inputs === "object" && Array.isArray(contract.environment.test_profiles) &&
    contract.identity === contractIdentity(contract.environment);
}

/** Pure projection, also used by fixture contracts without consulting the host. */
export function verdictContract(report: EnvironmentReport, facts: Pick<VerdictContract["environment"], "platform" | "arch" | "node" | "tools" | "inputs">): VerdictContract {
  if (report.version !== 1 || report.canonical !== true || report.experiments.length) {
    throw Error("landing verdict contract requires a canonical environment without experiments");
  }
  const host: Record<string, unknown> = { ...report.host };
  for (const name of HOST_INFRASTRUCTURE) delete host[name];
  if (typeof host.PATH === "string") host.PATH = [...new Set(host.PATH.split(delimiter))].join(delimiter);
  if (host.NTS_ORACLE_DEPENDENCIES) {
    const capability = JSON.parse(String(host.NTS_ORACLE_DEPENDENCIES));
    for (const name of ["sourceRevision", "lockfileSha256", "helperSha256", "producerSha256"]) {
      if (typeof capability[name] !== "string" || !capability[name]) throw Error("landing verdict contract lacks oracle " + name);
    }
    host.NTS_ORACLE_DEPENDENCIES = Object.fromEntries(
      ["version", "sourceRevision", "lockfileSha256", "helperSha256", "producerSha256"].map(name => [name, capability[name]]),
    );
  }
  // The package bytes are identified below, independently of pnpm's local links.
  host.NTS_ORACLE_TYPESCRIPT = facts.inputs.typescript ?? null;
  const ambient = { ...report.ambient };
  for (const name of ["TMPDIR", "XDG_CACHE_HOME", "NODE_COMPILE_CACHE"]) delete ambient[name];
  const environment: VerdictContract["environment"] = {
    ...facts, host, ambient,
    policy: { standing: STANDING_GATE_POLICY, unrun: PLATFORMS_UNRUN_OK },
    test_profiles: [TEST_PROFILE],
  };
  return { version: 1, identity: contractIdentity(environment), environment };
}

function command(program: string, args: string[], tree: string, env: NodeJS.ProcessEnv, probe:InfrastructureProbe): string {
  const result = probe({purpose:"read landing verdict identity",command:program,args,cwd:tree,env,maxBuffer:64<<20});
  return (result.stdout + result.stderr).trim();
}

/** This command only reads identities. Dependency capture belongs to the run. */
export function readVerdictContract(tree: string, env: NodeJS.ProcessEnv, probe:InfrastructureProbe=infrastructureProbe): VerdictContract {
  const report = gateEnvironment(env, { run: env.NTS_GATE_RUN_DIR!, oracleRoot: tree }).report;
  const inputs: Record<string, string | null> = {};
  for (const name of ["Cargo.lock", "rust-toolchain.toml", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".tool-versions", "tooling/inputs/node-inputs.json", "tooling/differential/oracle-toolchain.json"]) {
    const file = join(tree, name);
    inputs[name] = existsSync(file) ? digest(readFileSync(file)) : null;
  }
  const typescript = report.host.NTS_ORACLE_TYPESCRIPT;
  inputs.typescript = typescript ? digest(readFileSync(join(typescript, "package.json"))) : null;
  for (const name of ["typescript", "test262", "are-we-fast-yet", "deno"]) {
    const directory = join(tree, "third_party", name);
    if (!existsSync(directory)) { inputs["third_party/" + name] = null; continue; }
    const root = realpathSync(directory);
    const head = command("git", ["rev-parse", "HEAD"], root, env, probe);
    const dirty = command("git", ["status", "--porcelain=v1", "--untracked-files=normal"], root, env, probe);
    if (dirty) throw Error("landing verdict input has local changes: third_party/" + name);
    inputs["third_party/" + name] = head;
  }
  const tools: Record<string, string> = {};
  for (const [name, args] of [["rustc", ["-vV"]], ["cargo", ["--version"]], ["clang", ["--version"]], ["java", ["-version"]]] as const) {
    tools[name] = command(name, [...args], tree, env, probe);
  }
  return verdictContract(report, { platform: platform(), arch: arch(), node: process.versions.node, tools, inputs });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const output = process.argv[2];
  if (!output) throw Error("usage: node tooling/gate/verdict-contract.ts <receipt>");
  writeFileSync(output, JSON.stringify(readVerdictContract(process.cwd(), process.env), null, 2) + "\n");
}
