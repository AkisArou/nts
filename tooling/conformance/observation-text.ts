import assert from "node:assert/strict";
import { constants } from "node:os";

/** Compiler-generated identities move independently of a case's behaviour.
 * Keep source names, source positions, representation widths and observed
 * values. Call this only for diagnostic/validator identities, never answers.
 */
export function normalizeGeneratedNumbers(text: string): string {
  return text.replace(/<\d+(?:,\s*\d+)*>/g, arguments_ => arguments_.replace(/\d+/g, "N"))
    .replace(/\btype \d+\b/g, "type N")
    .replace(/\b(\w*Id)\(\d+\)/g, "$1(N)")
    .replace(/\bnts\.gen\.[\w$]+/g, name => name.replace(/\$\d+\$/g, "$N$")
      .replace(/\.(Type|Tuple)\d+\b/g, ".$1N"));
}

/** JVM's uncaught-exception protocol exposes the class and first message line.
 * Frames and thread names describe the host artifact, so remain in raw rows.
 * nts-owned abort text and wrong-answer output never enter this normalization.
 */
export function stableRuntimeAbortOutput(output: string): string {
  const first = output.split("\n", 1)[0];
  const host = /^Exception in thread "[^"]*" ([\w.$]+)(?::\s*(.*))?$/.exec(first);
  if (host === null) return output;
  return host[1] + (host[2] === undefined ? "" : ": " + normalizeGeneratedNumbers(host[2]));
}

/** Refusal paths name the materialized scratch project, not an observation.
 * A validator's own `at`, line and column fields are deliberately retained.
 */
export function stableCheckText(text: string): string {
  return text.replace(/\b(refused|not emitted|not rendered):\s*\S+:\d+:\d+:\s+/g, "$1: ");
}

/** Build diagnostics describe a generated artifact, not program output.
 * Their first line keeps the defect text while locations and generated
 * numbers move independently between otherwise identical attempts. */
export function stableBuildDiagnostic(value: string): string {
  const first = value.split("\n").map(line => line.trim()).find(Boolean);
  assert.ok(first, "a build failure needs its first diagnostic");
  return first
    .replace(/(["'])(?:\/|[A-Za-z]:[\\/])[^"'\r\n]*\1/g, "$1<path>$1")
    .replace(/(?:\/|[A-Za-z]:[\\/])[^\s"'<>]+/g, "<path>")
    .replace(/\b(?:[\w.+-]+[\\/])*[\w.+-]+\.(?:c|cc|cpp|h|hpp|rs|ts|tsx|js|mjs|ll|bc|o|a|so|class)(?::\d+(?::\d+)?)?\b/g, "<path>")
    .replace(/\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)\b/g, "N");
}

const compilerFaultSignals = new Set(["SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE", "SIGABRT", "SIGTRAP", "SIGSYS"]);
const signalNumbers: Readonly<Record<string, number>> = constants.signals;

/** Fault signals and Rust's panic are compiler defects. KILL, TERM, INT, HUP
 * and other outside stops do not measure the compiler. A resident-controller
 * memory attribution always takes precedence over this classification. */
export function compilerStopped(status: number | null, signal: string | null): boolean {
  if (signal !== null) return compilerFaultSignals.has(signal);
  return status === 101 || [...compilerFaultSignals].some(name => signalNumbers[name] !== undefined && status === 128 + signalNumbers[name]!);
}

export function compilerExternalStop(status: number | null, signal: string | null): boolean {
  return (signal !== null || (status !== null && status >= 128 && status <= 255)) && !compilerStopped(status, signal);
}

/** The stop itself, as one stable line: what a record of a compiler crash
 * keeps. It is never the first line the compiler printed, which is often an
 * earlier refusal (four of the TypeScript suite's seventeen C crash rows named
 * an `NTS1100` or `NTS1001` that way). A panic prints its location, then its
 * message; the location moves with any edit to that file, so the message is
 * the defect's identity, and the thread id changes on every run. */
export function compilerStop(output: string, status: number | null, signal: string | null): string {
  if (compilerExternalStop(status, signal)) {
    const name = signal ?? Object.entries(signalNumbers).find(([, number]) => status === 128 + number)?.[0];
    return name ? `stopped by ${name}${signal === null ? ` (exit ${status})` : ""}` : `stopped with exit ${status}`;
  }
  const lines = output.split("\n").map(line => line.trim());
  const at = lines.findIndex(line => /^thread '[^']*'(?: \(\d+\))? panicked at /.test(line));
  if (at !== -1) {
    const panic = /^thread '([^']*)'(?: \(\d+\))? panicked at \S+?:\d+:\d+:\s*(.*)$/.exec(lines[at]!);
    const message = panic?.[2] || lines.slice(at + 1).find(Boolean) || "no message";
    return stableBuildDiagnostic(`thread '${panic?.[1] ?? "?"}' panicked: ${message}`);
  }
  const named = lines.find(line => /^thread '[^']*'(?: \(\d+\))? has overflowed its stack$/.test(line) || /^memory allocation of \d+ bytes failed$/.test(line));
  if (named !== undefined) return stableBuildDiagnostic(named);
  return signal !== null ? `stopped by ${signal}` : `stopped with exit ${status}`;
}
