// What an outcomes fixture's record says against what the fixture does now,
// and which fixtures have a record at all: the decisions outcomes-check.ts
// prints, apart from the measuring, so they hold without a compiler.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { sameCheckOutcome } from "../differential/check-report.ts";
import { inventory } from "../records/pending.ts";
import { normalizeGeneratedNumbers, stableCheckText } from "./observation-text.ts";
import { outcomeDisposition, outcomeTransition } from "./outcome-transition.ts";

export const RECORD = "outcome.json";

/**
 * Fixtures against their records. Pending: a program with no outcome.json
 * yet, recorded after landing by the full check. Stale: an outcome.json whose
 * program is gone, an error until the change that deleted it deletes the record.
 */
export function outcomeInventory(directory: string, names: readonly string[]): { pending: string[]; stale: string[] } {
  return inventory(names.filter(name => existsSync(join(directory, name, RECORD))),
    names.filter(name => existsSync(join(directory, name, "src/main.ts"))));
}

/** The record a measurement writes. */
export function outcomeRecord(now, measuredWith: string) {
  return {
    ...(now.check ? { version: 1, check: now.check } : {}),
    run: now.run, category: now.category, nts: now.nts,
    ...(now.category === "refused" && now.run === "build" ? { ran: now.ran } : {}),
    node: now.node, measured_with: measuredWith, source: "measured",
  };
}

/** A recorded fixture against its measurement, in the progress ratchet's words. */
export function judge(was, now) {
  if (now.category === "not-measured") return { word: "NOT MEASURED", ok: false, why: now.nts };
  if (was.run !== now.run) return { word: "CHANGED", ok: false, why: `recorded under ${was.run}, measured under ${now.run}` };
  if (now.node !== was.node && was.node !== null && now.node !== null && now.category !== "refused") {
    return { word: "ORACLE CHANGED", ok: false, why: `node said ${was.node}, now ${now.node}` };
  }
  // A refused build record says what its artefact did; one written before it
  // did has no `ran`, and reads as CHANGED until re-recorded, never as the same.
  const ranTo = (r) => (r.category === "refused" && r.run === "build" ? r.ran : undefined);
  // Old records retain their original spelling and provenance. Apply the same
  // normalization to them that new check measurements use.
  const textOf = (r) => {
    const text = r.run === "check" ? stableCheckText(r.nts) : r.nts;
    return r.category === "invalid-hir" || r.category === "refused" ? normalizeGeneratedNumbers(text) : text;
  };
  const sameObservation = was.run === "check" ? sameCheckOutcome(was, now) : textOf(was) === textOf(now);
  const same = was.category === now.category && sameObservation && ranTo(was) === ranTo(now);
  const transition = outcomeTransition(outcomeDisposition(was.category), outcomeDisposition(now.category), same);
  const past = ranTo(now) !== undefined && ranTo(now) !== now.node && /^exit /.test(ranTo(now))
    ? ` -- and the program still ran, answering ${ranTo(now)} where node answers ${now.node}`
    : "";
  if (same) return { ...transition, why: `${now.category} -- ${now.nts}${past}` };
  if (transition.word === "REGRESSED") return { ...transition, why: `agreed with node; now ${now.category} -- ${now.nts}` };
  if (transition.word === "FIXED") {
    return { ...transition, why: `was ${was.category} (${was.nts}); agrees with node now -- move it to tests/programs/ or re-record it as a guard` };
  }
  if (transition.word === "REFUSES NOW") {
    return {
      ...transition,
      why: `was ${was.category}; hand it to tests/refusals/ with\n                // expect: ${now.nts}`,
    };
  }
  if (was.category === now.category && sameObservation) {
    return { ...transition, why: `refused as before; its artefact ran to ${ranTo(was) ?? "(not recorded)"}, now ${ranTo(now)}` };
  }
  return { ...transition, why: `${was.category} (${was.nts}) -> ${now.category} (${now.nts})` };
}
