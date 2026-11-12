import {scopedSpawn as spawn} from '../gate/case-spawn.ts';
import { withToken } from "../gate/tokens.mjs";

export type FixtureResult = { stdout: string; stderr: string; unexpected: number; retainRun: boolean };
export type FixtureOutcome = { name: string; result?: FixtureResult; error?: Error };

/** A fixture owns its token until its worker and every output pipe close. */
export function fixtureWorker(script: string, name: string, directory: string): Promise<FixtureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--worker", name, directory], {
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", metadata = "";
    child.stdout!.setEncoding("utf8").on("data", text => { stdout += text; });
    child.stderr!.setEncoding("utf8").on("data", text => { stderr += text; });
    (child.stdio[3] as NodeJS.ReadableStream).setEncoding("utf8").on("data", text => { metadata += text; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      try {
        if (code !== 0) throw new Error(`blocker worker ${name} exited ${signal ?? code}\n${stderr}`);
        const result = JSON.parse(metadata);
        if (!Number.isSafeInteger(result.unexpected) || result.unexpected < 0 || result.unexpected > 1 || typeof result.retainRun !== "boolean") {
          throw new Error(`blocker worker ${name} returned invalid accounting`);
        }
        resolve({ stdout, stderr, unexpected: result.unexpected, retainRun: result.retainRun });
      } catch (error) { reject(error); }
    });
  });
}

/** Stop feeding on infrastructure failure, drain admitted fixtures, retain order. */
export async function fixturePool(
  names: readonly string[], jobs: number,
  run: (name: string, index: number) => Promise<FixtureResult>,
  report: (result: FixtureResult) => void = () => {},
): Promise<void> {
  if (!Number.isSafeInteger(jobs) || jobs < 1) throw new Error("blockers jobs must be a positive integer");
  const results: FixtureOutcome[] = new Array(names.length);
  let next = 0, reported = 0, failed = false;
  const flush = () => {
    while (results[reported]?.result) report(results[reported++].result!);
  };
  await Promise.all(Array.from({ length: Math.min(jobs, names.length) }, async () => {
    while (!failed && next < names.length) {
      const index = next++, name = names[index];
      try {
        const result = await withToken(async () => {
          if(failed)return null;
          try{return await run(name,index);}
          catch(error){failed=true;throw error;}
        }, {
          project: `tests/refusals/${name}/tsconfig.json`,backend:process.env.NTS_BACKEND??'c',
        });
        if (result !== null) {
          results[index] = { name, result };
          flush();
        }
      } catch (error) {
        failed = true;
        results[index] = { name, error: error instanceof Error ? error : new Error(String(error)) };
      }
    }
  }));
  const error = results.find(row => row?.error)?.error;
  if (error) throw error;
}
