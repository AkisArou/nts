// The launcher cannot turn its own exit code into a measured step verdict.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type StepEntry = { version: 1; nonce: string; unit: string; group: string };
export function readStepEntry(path: string, expected: Omit<StepEntry, "version">): StepEntry {
  const value = JSON.parse(readFileSync(path, "utf8")) as StepEntry;
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["version", "nonce", "unit", "group"].sort())
      || value.version !== 1 || value.nonce !== expected.nonce || value.unit !== expected.unit || value.group !== expected.group) throw new Error("foreign step scope entry receipt");
  return value;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [path, nonce, unit, group] = process.argv.slice(2);
  if (!path || !nonce || !unit || !group) throw new Error("step scope entry lacks its identity");
  const actual = /^0::(.+)$/m.exec(readFileSync("/proc/self/cgroup", "utf8"))?.[1];
  if (actual !== group) throw new Error(`step scope entry escaped its expected cgroup: ${actual}`);
  writeFileSync(path, JSON.stringify({ version: 1, nonce, unit, group } satisfies StepEntry) + "\n", { flag: "wx", mode: 0o600 });
}
