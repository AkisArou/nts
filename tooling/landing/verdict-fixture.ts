import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureContract } from "../gate/verdict-contract-fixture.ts";
import { landingSelection } from "./selection.ts";
import { writeLandingVerdict } from "./verdict.ts";

/** A real portable receipt whose inputs and costs belong to the fixture. */
export function recordLandingFixture(home: string, commit: string, tree: string, steps: readonly string[], options: {
  logs?: Record<string, string>; interop?: string; doctests?: string;
} = {}) {
  const run = join(home, "landing", commit);
  mkdirSync(run, { recursive: true });
  for (const name of steps) writeFileSync(join(run, name + ".log"), options.logs?.[name] ?? "");
  const selection = landingSelection({
    owed: { steps }, paths: [], catalogue: [...steps], table: Object.fromEntries(steps.map(step => [step, { form: "as-is" }])),
    inCorpus: () => false, rows: new Map(), cost: () => ({ cpu: 10, measured: true, source: "fixture" }),
    budget: { slots: 24, frontends: 24, seconds: 600 },
  });
  return writeLandingVerdict(home, {
    commit, tree, submission: commit, landing: "fixture-" + commit.slice(0, 12), base: "f".repeat(40),
    selected: { selection, interop: options.interop ?? null, doctests: options.doctests ?? null },
    ran: { state: "green", message: "green", run, contract: fixtureContract(), pending: [], wall_s: 4,
      steps: steps.map(name => ({ name, verdict: "PASS", cpu: 10, wall: 3 })) },
  })!;
}
