// The full check owns the wall ceiling even when it measures an old runner.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownUnit } from "../gate/scopes/bound-slice.ts";
import { populated, waitForEmptyCgroup } from "../gate/scopes/step-scope.ts";
import { stopToolingSlice, toolingSlice } from "../gate/tooling-slice.ts";

import {infrastructureProbe,type InfrastructureProbe} from "../gate/infrastructure-probe.ts";

export const MEASUREMENT_HOLD = "measurement-hold.txt";

export function measurementGroup(slice:string,probe:InfrastructureProbe=infrastructureProbe):string{
  return probe({purpose:"read the measurement cgroup for cleanup",command:"systemctl",args:["--user","show",slice,"-p","ControlGroup","--value"]}).stdout.trim();
}

async function measure(seconds: number, run: string, slice: string, command: string[]): Promise<number> {
  if (!toolingSlice({ NTS_TOOLING_SLICE: slice }) || !isAbsolute(run) || !Number.isFinite(seconds) || seconds <= 0 || !command.length) {
    throw new Error("a full-check measurement needs a run, its own slice and a positive wall ceiling");
  }
  const unit = `nts-full-check-measure-${randomUUID()}`;
  const owner = ownUnit();
  const deadline = performance.now() + seconds * 1000;
  const child = spawn("systemd-run", ["--user", "--scope", "--collect", "--quiet", "--expand-environment=no",
    `--unit=${unit}`, `--slice=${slice}`, `--property=RuntimeMaxSec=${seconds}s`, "--property=TimeoutStopSec=5s",
    ...(owner ? [`--property=BindsTo=${owner}`, `--property=After=${owner}`] : []),
    "--", ...command], {
    // Preserve the candidate's receipt and its open description of the tree lock.
    stdio: process.env.NTS_GATE_LOCK_FD === "8" ? ["inherit", "inherit", "inherit", 3, null, null, null, null, 8] : "inherit",
  });
  const hold = (reason: string) => {
    console.error(reason);
    try { writeFileSync(join(run, MEASUREMENT_HOLD), reason + "\n"); }
    catch (error) { console.error("full check measurement receipt:", error); }
  };
  let expired = false;
  const expire = () => {
    if (expired) return;
    expired = true;
    hold(`full check run exceeded its wall ceiling of ${seconds} s`);
    try { stopToolingSlice(slice); }
    catch (error) { console.error("full check wall ceiling could not stop its slice:", error); }
  };
  const timer = setTimeout(expire, seconds * 1000);
  let status = 124;
  let cleanupFailed = false;
  try {
    status = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => resolve(code ?? 1));
    });
    if (performance.now() >= deadline) expire();
    // The candidate process owns resolution services. Give them time to
    // observe its exit and publish their cleanup before removing the slice.
    if (!expired) {
      const group = measurementGroup(slice);
      if (group) await waitForEmptyCgroup(() => expired ? 0 : populated(group));
    }
    if (status === 124) status = 1;
  } catch (error) {
    cleanupFailed = true;
    if (!expired) hold(`full check measurement scope: ${String(error)}`);
  } finally {
    clearTimeout(timer);
    try { stopToolingSlice(slice); }
    catch (error) {
      cleanupFailed = true;
      if (!expired) hold(`full check measurement cleanup: ${String(error)}`);
    }
  }
  // 124 is reserved for a held measurement if its receipt could not be written.
  if (expired || cleanupFailed) return 124;
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , seconds, run, slice, ...command] = process.argv;
  try { process.exitCode = await measure(Number(seconds), run!, slice!, command); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
