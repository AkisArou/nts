// The agent launcher: an agent runs as its own systemd user unit, named
// for it, so it outlives whatever started it and is stopped by that name --
// never as a detached process nobody owns, and never by a PID read from ps
// (AGENTS.md: stop work by its unit).
//
//   node tooling/agents/agents.ts start --name <name> -- <argv>
//   node tooling/agents/agents.ts stop <name>
//   node tooling/agents/agents.ts list [--json]
//
// Each unit runs with `--collect` (gone once it ends), off the measurement
// CPUs 4-5, at Nice=19, with no core dumps and the agent OOM score
// (memory-ledger.ts's OOM_SCORE: the kernel kills an agent's work after
// the full check's, before a landing's). It runs in the caller's working
// directory with the host capabilities every detached unit here is given
// (gate/environment.ts's systemdEnvironment, as the landing service gets
// them). `list --json` is the machine reading another tool (signalbox)
// lists agents by: one entry per loaded agent unit, name first.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { systemdEnvironment } from "../gate/environment.ts";
import { OOM_SCORE } from "../gate/memory-ledger.ts";

export const AGENT_PREFIX = "nts-agent-";
/** An agent's CPUs: every CPU but the measurement pair 4-5 (AGENTS.md). */
export const AGENT_CPUS = "0-3 6-31";
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/;

/** The unit an agent's name runs as. A name systemd could read as anything else (a path, a template) is refused. */
export function agentUnit(name: string): string {
  if (!NAME.test(name)) throw new Error(`invalid agent name ${JSON.stringify(name)}: letters, digits, '_', '.' and '-', starting with a letter or digit`);
  return `${AGENT_PREFIX}${name}.service`;
}

export type AgentCommand =
  | { kind: "start"; name: string; argv: string[] }
  | { kind: "stop"; name: string }
  | { kind: "list"; json: boolean };

export const USAGE = "usage: agents.ts start --name <name> -- <argv> | stop <name> | list [--json]";

export function parseCommand(argv: readonly string[]): AgentCommand {
  const [command, ...rest] = argv;
  if (command === "start") {
    let name: string | undefined;
    let at = 0;
    while (at < rest.length && rest[at] !== "--") {
      if (rest[at] === "--name") { name = rest[at + 1]; at += 2; }
      else if (rest[at]!.startsWith("--name=")) { name = rest[at]!.slice("--name=".length); at += 1; }
      else throw new Error(`unknown start argument ${rest[at]}; ${USAGE}`);
    }
    const args = rest.slice(at + 1);
    if (!name) throw new Error(`start takes --name <name>; ${USAGE}`);
    agentUnit(name);
    if (at >= rest.length || !args.length) throw new Error(`start takes -- before the agent's argv; ${USAGE}`);
    return { kind: "start", name, argv: args };
  }
  if (command === "stop") {
    if (rest.length !== 1) throw new Error(`stop takes one name; ${USAGE}`);
    agentUnit(rest[0]!);
    return { kind: "stop", name: rest[0]! };
  }
  if (command === "list") {
    if (rest.length === 0) return { kind: "list", json: false };
    if (rest.length === 1 && rest[0] === "--json") return { kind: "list", json: true };
    throw new Error(`list takes at most --json; ${USAGE}`);
  }
  throw new Error(`${command ? `unknown command ${command}; ` : ""}${USAGE}`);
}

/** The systemd-run argv that starts an agent: as the landing service starts (queue.ts), with an agent's priority. */
export function startArgs(name: string, argv: readonly string[], env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string[] {
  return ["--user", `--unit=${agentUnit(name)}`, "--collect", "--quiet",
    "-p", "LimitCORE=0", "-p", "Nice=19", "-p", `OOMScoreAdjust=${OOM_SCORE.agent}`, "-p", `CPUAffinity=${AGENT_CPUS}`,
    `--working-directory=${cwd}`, ...systemdEnvironment(env), "--", ...argv];
}

const systemctl = (...args: string[]) => spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
const isActive = (unit: string) => systemctl("is-active", unit).stdout?.trim() === "active";

export function startAgent(command: Extract<AgentCommand, { kind: "start" }>, env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const unit = agentUnit(command.name);
  if (isActive(unit)) throw new Error(`agent ${command.name} is already running (${unit}); stop it first`);
  const started = spawnSync("systemd-run", startArgs(command.name, command.argv, env, cwd), { encoding: "utf8" });
  if (started.error || started.status !== 0) {
    const why = (started.stderr ?? "").trim();
    if (/already (exists|loaded)/.test(why)) throw new Error(`agent ${command.name} is already running (${unit}); stop it first`);
    throw new Error(`could not start ${unit}: ${started.error?.message ?? why ?? `exit ${started.status}`}`);
  }
  return `started ${unit}`;
}

export function stopAgent(name: string): string {
  const unit = agentUnit(name);
  const stopped = systemctl("stop", unit);
  if (stopped.error || stopped.status !== 0) {
    const why = (stopped.stderr ?? "").trim();
    if (why.includes(`Unit ${unit} not loaded.`)) throw new Error(`no agent ${name} (${unit} is not loaded)`);
    throw new Error(`could not stop ${unit}: ${stopped.error?.message ?? why ?? `exit ${stopped.status}`}`);
  }
  return `stopped ${unit}`;
}

export type Agent = { name: string; unit: string; active: string; sub: string };

/** The agents in a `list-units` JSON reading: the loaded `nts-agent-*` services, by name. */
export function parseAgents(json: string): Agent[] {
  const units = JSON.parse(json) as { unit: string; active: string; sub: string }[];
  return units
    .filter(unit => unit.unit.startsWith(AGENT_PREFIX) && unit.unit.endsWith(".service"))
    .map(unit => ({ name: unit.unit.slice(AGENT_PREFIX.length, -".service".length), unit: unit.unit, active: unit.active, sub: unit.sub }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listAgents(): Agent[] {
  const listed = systemctl("list-units", "--all", "--type=service", "--output=json");
  if (listed.error || listed.status !== 0) throw new Error(`could not list units: ${listed.error?.message ?? listed.stderr.trim() ?? `exit ${listed.status}`}`);
  return parseAgents(listed.stdout);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const command = parseCommand(process.argv.slice(2));
    if (command.kind === "start") console.log(startAgent(command));
    else if (command.kind === "stop") console.log(stopAgent(command.name));
    else if (command.json) process.stdout.write(`${JSON.stringify(listAgents())}\n`);
    else for (const agent of listAgents()) console.log(`${agent.name}\t${agent.active}/${agent.sub}\t${agent.unit}`);
  } catch (error) {
    console.error(`agents: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
