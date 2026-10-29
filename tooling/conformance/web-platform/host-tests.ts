// One owner drains host test events before publishing web liveness evidence.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { runScopedTooling, type ToolingResult } from "../../gate/tooling-runner.ts";
import { publishToolingFailure, ToolingInstrumentError, type InstrumentResult } from "../../gate/step-result.ts";
import { publishWptHangs, readWptHungResults } from "../../../runtime/web-platform/test/wpt/hung.ts";

export function finishWebHost(result: ToolingResult, observations: readonly InstrumentResult[], env: NodeJS.ProcessEnv = process.env): number {
  if (observations.length) {
    return publishWptHangs(observations, result.completedFailures, env);
  }
  return result.status === 2 ? 124 : result.status;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const files = process.argv.slice(2);
    if (!files.length || !process.env.NTS_WPT_HUNG_RESULTS)
      throw new ToolingInstrumentError("tooling-setup", "web host runner requires test files and a private hung-observation path");
    const result = await runScopedTooling(files, {
      idleMs: 900000,
      execArgv: ["--expose-gc", "--import", new URL("../../../runtime/web-platform/host/environment-shim.ts", import.meta.url).href],
    });
    process.exitCode = finishWebHost(result, readWptHungResults(process.env.NTS_WPT_HUNG_RESULTS));
  } catch (error) {
    const instrument = error instanceof ToolingInstrumentError ? error
      : new ToolingInstrumentError("tooling-setup", "web host runner did not complete", { cause: error });
    publishToolingFailure(instrument);
    console.error(instrument);
    process.exitCode = 2;
  }
}
