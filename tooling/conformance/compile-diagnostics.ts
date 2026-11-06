// How a compiler or build tool's own run is classified: its first diagnostic,
// made stable, and whether and how it stopped. Runtime and check observation
// text is observation-text.ts's. The benchmark compile key covers this file
// (tooling/bench/compile-producer.ts), so it holds only these primitives.
import assert from "node:assert/strict";
import { constants } from "node:os";

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
    return name ? `stopped by ${name}` : `stopped with exit ${status}`;
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
  const fault = signal ?? [...compilerFaultSignals].find(name => signalNumbers[name] !== undefined && status === 128 + signalNumbers[name]!);
  return fault ? `stopped by ${fault}` : `stopped with exit ${status}`;
}
