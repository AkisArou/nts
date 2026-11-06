// The landing selection over the real rules: what owed-range.ts says a range
// owes -- the union of both endpoints' rules, each evaluated in its own
// committed tree, so a change cannot narrow its own check -- mapped through
// the LANDING table of the code that runs it, which for the service is main's.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectRange } from "../gate/owed-range.ts";
import { covering, crateOf, embedded, inCorpus, LANDING } from "../gate/owed.mjs";
import { STEPS } from "../gate/step-table.mjs";
import type { Selected } from "./service.ts";
import { costLookup, landingSelection, owedReach, readBaseline, readLandingCosts, recompilesRust, type Budget, type StepRow, type Table } from "./selection.ts";

const ROWS = new Map<string, StepRow>((STEPS as StepRow[]).map(row => [row.name, row]));

/** Whether a path is compiled into a crate: in one, or in a directory one includes. */
export function inCrate(path: string): boolean {
  return crateOf(path) !== null || covering(embedded(), path).size > 0;
}

/** The selection for `base..tip` in the repository at `root`, costed from the landing check's record `costs`. */
export function ruleSelect(root: string, costs: string, budget: Budget): (base: string, tip: string, paths: string[]) => Selected {
  return (base, tip, paths) => {
    const range = selectRange(root, `${base}..${tip}`);
    const catalogue = range.views[range.views.length - 1]!.catalogue;
    const rules = range.views.flatMap(view => view.rules);
    const kind = recompilesRust(paths, inCrate) ? "rust" as const : "other" as const;
    const baseline = (() => { try { return readBaseline(readFileSync(join(root, "tooling/gate/times.tsv"), "utf8")); } catch { return new Map(); } })();
    const selection = landingSelection({
      owed: { steps: range.checks.steps, reach: owedReach(rules, catalogue) }, paths, catalogue, table: LANDING as Table, inCorpus, rows: ROWS,
      cost: costLookup(readLandingCosts(costs), baseline, kind, ROWS, budget), budget,
    });
    return { selection, kind, interop: range.checks.interop, doctests: range.checks.doctests ?? null };
  };
}
