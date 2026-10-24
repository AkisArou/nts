// Variables a detached gate unit must inherit, and the capabilities that
// require them. The launcher and both gate entry points read this one list.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Capability = "android" | "jvm" | "valgrind";
type Variable = { name: string; capability?: Capability };
export const GATE_ENVIRONMENT: readonly Variable[] = [
  { name: "PATH" },
  { name: "HOME" },
  { name: "LANG" },
  { name: "XDG_RUNTIME_DIR" },
  { name: "DBUS_SESSION_BUS_ADDRESS" },
  { name: "ANDROID_HOME", capability: "android" },
  { name: "ANDROID_SDK_ROOT" },
  { name: "ANDROID_AVD_HOME" },
  { name: "JAVA_HOME", capability: "jvm" },
  { name: "JDK_HOME" },
  { name: "DEBUGINFOD_URLS", capability: "valgrind" },
];

export const GATE_LAUNCHER = "node tooling/lanes/land-unit.ts <commit> <name>";

/** Each assignment is one argv element, including values with spaces or $. */
export function systemdEnvironment(env: NodeJS.ProcessEnv = process.env): string[] {
  return GATE_ENVIRONMENT.flatMap(({ name }) => {
    const value = env[name];
    return value ? [`--setenv=${name}=${value}`] : [];
  });
}

export type CapabilitySite = { step: string; project?: string; capabilities: string[] };

export function missingEnvironment(sites: readonly CapabilitySite[], env: NodeJS.ProcessEnv = process.env): string[] {
  const variables = new Map(GATE_ENVIRONMENT.filter(v => v.capability).map(v => [v.capability as string, v.name]));
  const missing = new Map<string, Set<string>>();
  for (const site of sites) {
    const where = `step ${site.step}${site.project ? ` (project ${site.project})` : ""}`;
    for (const capability of site.capabilities) {
      const variable = variables.get(capability);
      if (!variable) throw new Error(`${where} declares unknown environment capability ${capability}`);
      if (env[variable]?.trim()) continue;
      if (!missing.has(variable)) missing.set(variable, new Set());
      missing.get(variable)!.add(where);
    }
  }
  return [...missing].map(([variable, sites]) => `${variable} is missing; required by ${[...sites].join(", ")}`);
}

/** Read declarations from the exact tree whose steps are about to run. */
export function gateCapabilities(tree: string, requested: readonly string[] | "all", interop: string | null = null): CapabilitySite[] {
  const queried = spawnSync(process.execPath, ["tooling/gate/run.mjs", "--capabilities"], {
    cwd: tree, encoding: "utf8", timeout: 10000,
  });
  if (queried.error || queried.status !== 0) {
    throw new Error(`cannot read gate capabilities: ${queried.error?.message ?? queried.stderr.trim()}`);
  }
  const table = JSON.parse(queried.stdout) as Record<string, string[]>;
  const steps = requested === "all" ? Object.keys(table) : requested;
  const sites: CapabilitySite[] = steps.map(step => {
    if (!Object.hasOwn(table, step) || !Array.isArray(table[step])) throw new Error(`no gate capability declaration for step ${step}`);
    return { step, capabilities: table[step] };
  });
  if (steps.includes("interop")) {
    const directory = join(tree, "tests/interop");
    const selected = interop?.trim() ? interop.trim().split(/\s+/) : readdirSync(directory).sort();
    for (const project of selected) {
      if (project.includes("/") || project === "." || project === "..") throw new Error(`invalid interop project ${project}`);
      const script = join(directory, project, "build.sh");
      if (!existsSync(script)) {
        if (interop?.trim()) throw new Error(`interop project ${project} has no build.sh`);
        continue;
      }
      const capabilities = /^#[ \t]*nts-gate-capabilities:[ \t]*(.*)$/m.exec(readFileSync(script, "utf8"))?.[1].trim().split(/\s+/).filter(Boolean) ?? [];
      sites.push({ step: "interop", project, capabilities });
    }
  }
  return sites;
}

/** A named refusal, before enqueue/lock/setup rather than a late gate failure. */
export function gateEnvironmentError(tree: string, steps: readonly string[] | "all", interop: string | null = null, env: NodeJS.ProcessEnv = process.env): string | null {
  const missing = missingEnvironment(gateCapabilities(tree, steps, interop), env);
  return missing.length ? `${missing.join("; ")}. Start from a login shell with ${GATE_LAUNCHER}` : null;
}
