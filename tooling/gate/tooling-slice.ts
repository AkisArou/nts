// One tooling run owns this hierarchy, including services outside its process group.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ToolingInstrumentError } from "./step-result.ts";

export function newToolingSlice(fixture = false, env: NodeJS.ProcessEnv = process.env): string {
  const id=randomUUID().replaceAll("-", ""),parent=toolingSlice(env);
  return parent ? `${parent.slice(0,-6)}-${fixture?"test":"run"}${id}.slice` : `nts-${fixture ? "test-" : ""}tooling-${id}.slice`;
}

export function toolingSlice(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const slice = env.NTS_TOOLING_SLICE;
  if (slice !== undefined && !/^nts-(?:test-)?tooling-[a-f0-9]{32}(?:-(?:test|run)[a-f0-9]{32})*\.slice$/.test(slice)) throw new Error("invalid tooling slice");
  return slice;
}

/** Every external test service uses the same explicit parent. */
export function toolingSliceArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const slice = toolingSlice(env);
  return slice ? [`--slice=${slice}`] : [];
}

/** Slice ancestry is encoded in names; preserve the resident run's own suffix. */
export function toolingSlicePrefix(prefix: string, env: NodeJS.ProcessEnv = process.env): string {
  const slice = toolingSlice(env);
  return slice ? `${slice.slice(0, -6)}-${prefix}` : prefix;
}

export function stopToolingSlice(slice: string): void {
  toolingSlice({ NTS_TOOLING_SLICE: slice });
  const stopped = spawnSync("systemctl", ["--user", "stop", slice], { encoding: "utf8" });
  if (stopped.status !== 0 && !stopped.stderr.includes(`Unit ${slice} not loaded.`)) {
    throw new ToolingInstrumentError("tooling-cleanup",`tooling cleanup: could not stop ${slice}: ${stopped.stderr || stopped.error?.message}`);
  }
}
