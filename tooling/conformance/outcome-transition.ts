/**
 * The progress ratchet shared by the outcomes corpus, the TypeScript records
 * and the benchmark compile outcomes. Outcomes are ordered pass > refused >
 * loud defect > silent wrong answer: a wrong answer ranks lowest because
 * nothing reports it, which is also why the plan's queue takes wrong answers
 * first. Moving up the order is progress, and passes; moving down is a
 * regression; a different outcome of the same rank is a change.
 */
export type OutcomeDisposition = "pass" | "refused" | "loud" | "silent";
export type TransitionWord = "holds" | "reproduces" | "FIXED" | "REFUSES NOW" | "LOUD NOW" | "REGRESSED" | "CHANGED";
export interface OutcomeTransition { word: TransitionWord; ok: boolean; loud: boolean; }

const RANK: Readonly<Record<OutcomeDisposition, number>> = { silent: 0, loud: 1, refused: 2, pass: 3 };
/** A defect that answers, wrongly, as if nothing were the matter. */
const SILENT = ["wrong", "wrong-output", "wrong-answer"];
/** A defect that stops or says so: a crash, an abort, or output that cannot be built. */
const LOUD = ["invalid-hir", "runtime-abort", "aborted", "uncompilable-c", "compiler-crash", "build-failure"];

export function outcomeDisposition(kind: string): OutcomeDisposition {
  if (kind === "pass" || kind === "agrees") return "pass";
  if (kind === "refused") return "refused";
  if (SILENT.includes(kind)) return "silent";
  if (LOUD.includes(kind)) return "loud";
  throw new Error(`unknown outcome kind: ${kind}`);
}

export function outcomeTransition(
  before: OutcomeDisposition,
  after: OutcomeDisposition,
  unchanged: boolean,
): OutcomeTransition {
  if (unchanged) return { word: before === "pass" ? "holds" : "reproduces", ok: true, loud: false };
  // Whatever a pass turns into, and any step down the order, is worse.
  if (before === "pass" || RANK[after] < RANK[before]) return { word: "REGRESSED", ok: false, loud: false };
  if (after === "pass") return { word: "FIXED", ok: true, loud: true };
  if (after === "refused" && before !== "refused") return { word: "REFUSES NOW", ok: true, loud: true };
  if (after === "loud" && before === "silent") return { word: "LOUD NOW", ok: true, loud: true };
  return { word: "CHANGED", ok: false, loud: false };
}

/** A recorded case got better: it passes and is listed, and the full check rewrites its row. */
export function improves(transition: OutcomeTransition): boolean {
  return transition.word === "FIXED" || transition.word === "REFUSES NOW" || transition.word === "LOUD NOW";
}
