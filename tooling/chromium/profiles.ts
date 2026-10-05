// Both profiles use the same pinned source and staged integration. Builds must
// therefore share one writer lock even though their output/evidence differ.
import { readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";

export function activeChromiumBuild(root: string): number | undefined {
  try {
    const pid = Number(readFileSync(resolve(root, "target/chromium/build.pid"), "utf8").trim());
    if (!Number.isSafeInteger(pid) || pid < 2) throw new Error("Invalid Chromium build PID record");
    const command = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    if (command[1] && command.includes("build") &&
        resolve(readlinkSync(`/proc/${pid}/cwd`), command[1]) === resolve(root, "tooling/chromium/chromium.ts")) return pid;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

export function buildProfile(options: string[]) {
  const index = options.indexOf("--profile");
  const name = index < 0 ? "baseline" : options[index + 1];
  if (name !== "baseline" && name !== "perf") throw new Error("--profile must be baseline or perf");
  if (options.lastIndexOf("--profile") !== index) throw new Error("Specify --profile once");
  return {
    name,
    directory: name === "baseline" ? "out/NtsBaseline" : "out/NtsPerf",
    argumentsFile: name === "baseline" ? "args.gn" : "perf-args.gn",
    evidence: name === "baseline" ? "target/chromium" : "target/chromium/perf",
  };
}
