// One tooling run owns this hierarchy, including services outside its process group.
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { ToolingInstrumentError } from "./step-result.ts";

export function newToolingSlice(fixture = false, env: NodeJS.ProcessEnv = process.env): string {
  return childSlice(toolingSlice(env), unitComponent(fixture ? "t" : "r"));
}

/** A random component needs uniqueness among the units sharing its parent. */
export function unitComponent(role: "r" | "t" | "c" | "s"): string {
  return role + randomInt(36 ** 8).toString(36).padStart(8, "0");
}

/** Refuse before asking the manager, so exhausted nesting is an instrument result. */
export function checkedUnitName(name: string): string {
  const bytes = Buffer.byteLength(name);
  if (bytes > 255) throw new ToolingInstrumentError("tooling-setup", `tooling unit-name budget exhausted: ${bytes} bytes exceeds systemd's 255-byte limit`);
  return name;
}

/** Slice names carry their physical ancestry, including enclosing memory caps. */
export function childSlice(parent: string | undefined, component: string): string {
  return checkedUnitName(`${parent ? parent.slice(0, -6) : "nts"}-${component}.slice`);
}

export function toolingSlice(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const slice = env.NTS_TOOLING_SLICE;
  // Existing run receipts and an enclosing launcher may still use UUID components.
  if (slice !== undefined && !/^nts-(?:(?:test-)?tooling-[a-f0-9]{32}|[rt][a-z0-9]{8})(?:-(?:test|run)[a-f0-9]{32}|-[rt][a-z0-9]{8}|-(?:workers|w))*\.slice$/.test(slice)) throw new Error("invalid tooling slice");
  return slice === undefined ? undefined : checkedUnitName(slice);
}

/** Every external test service uses the same explicit parent. */
export function toolingSliceArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const slice = toolingSlice(env);
  return slice ? [`--slice=${slice}`] : [];
}

/** Slice ancestry is encoded in names; preserve the resident run's own suffix. */
export function toolingSlicePrefix(prefix: string, env: NodeJS.ProcessEnv = process.env): string {
  const slice = toolingSlice(env);
  const name = slice ? `${slice.slice(0, -6)}-${prefix}` : prefix;
  return checkedUnitName(`${name}.service`).slice(0, -8);
}

export function stopToolingSlice(slice: string): void {
  toolingSlice({ NTS_TOOLING_SLICE: slice });
  const stopped = spawnSync("systemctl", ["--user", "stop", slice], { encoding: "utf8" });
  if (stopped.status !== 0 && !stopped.stderr.includes(`Unit ${slice} not loaded.`)) {
    throw new ToolingInstrumentError("tooling-cleanup",`tooling cleanup: could not stop ${slice}: ${stopped.stderr || stopped.error?.message}`);
  }
}
