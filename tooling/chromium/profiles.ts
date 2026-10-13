// Both profiles use the same pinned source and staged integration. Builds must
// therefore share one writer lock even though their output/evidence differ.
import { readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { chromiumState } from "./checkout.ts";

export function activeChromiumBuild(root: string): number | undefined {
  try {
    const pid = Number(readFileSync(resolve(chromiumState(root), "build.pid"), "utf8").trim());
    if (!Number.isSafeInteger(pid) || pid < 2) throw new Error("Invalid Chromium build PID record");
    const command = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    // Any tree's chromium.ts: every tree builds in the one source.
    if (command[1] && command.includes("build") &&
        resolve(readlinkSync(`/proc/${pid}/cwd`), command[1]).endsWith("/tooling/chromium/chromium.ts")) return pid;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

export function buildProfile(root: string, options: string[]) {
  const index = options.indexOf("--profile");
  const name = index < 0 ? "baseline" : options[index + 1];
  if (name !== "baseline" && name !== "perf") throw new Error("--profile must be baseline or perf");
  if (options.lastIndexOf("--profile") !== index) throw new Error("Specify --profile once");
  return {
    name,
    directory: name === "baseline" ? "out/NtsBaseline" : "out/NtsPerf",
    argumentsFile: name === "baseline" ? "args.gn" : "perf-args.gn",
    // The build's record and log, with the shared checkout's (checkout.ts).
    evidence: name === "baseline" ? chromiumState(root) : resolve(chromiumState(root), "perf"),
  };
}
