/** The progress ratchet shared by the outcomes corpus and TypeScript records. */
export type OutcomeDisposition = "pass" | "refused" | "defect";
export type TransitionWord = "holds" | "reproduces" | "FIXED" | "REFUSES NOW" | "REGRESSED" | "CHANGED";
export interface OutcomeTransition { word: TransitionWord; ok: boolean; loud: boolean; }

export function outcomeDisposition(kind: string): OutcomeDisposition {
  if (kind === "pass" || kind === "agrees") return "pass";
  if (kind === "refused") return "refused";
  if (["wrong", "wrong-answer", "invalid-hir", "runtime-abort", "aborted", "uncompilable-c"].includes(kind)) return "defect";
  throw new Error(`unknown outcome kind: ${kind}`);
}

export function outcomeTransition(
  before: OutcomeDisposition,
  after: OutcomeDisposition,
  unchanged: boolean,
): OutcomeTransition {
  if (unchanged) return { word: before === "pass" ? "holds" : "reproduces", ok: true, loud: false };
  if (before === "pass") return { word: "REGRESSED", ok: false, loud: false };
  if (after === "pass") return { word: "FIXED", ok: true, loud: true };
  if (after === "refused" && before !== "refused") return { word: "REFUSES NOW", ok: true, loud: true };
  return { word: "CHANGED", ok: false, loud: false };
}
