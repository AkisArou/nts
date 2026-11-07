/**
 * The progress ratchet shared by the outcomes corpus, the TypeScript records
 * and the benchmark compile outcomes. Outcomes are ordered pass > refused >
 * loud defect > silent wrong answer: a wrong answer ranks lowest because
 * nothing reports it, which is also why the plan's queue takes wrong answers
 * first. Moving up the order is progress, and passes; moving down is a
 * regression. A case refused before and after, for other reasons, is accepted:
 * a refusal is safe whatever its reasons, and lifting one refusal exposes the
 * next on every compiler improvement. Any other different outcome of the same
 * rank is a change, and fails.
 */
export type OutcomeDisposition = "pass" | "refused" | "loud" | "silent";
export type TransitionWord = "holds" | "reproduces" | "FIXED" | "REFUSES NOW" | "LOUD NOW" | "REFUSES DIFFERENTLY" | "REGRESSED" | "CHANGED";
export interface OutcomeTransition { word: TransitionWord; ok: boolean; loud: boolean; }

const RANK: Readonly<Record<OutcomeDisposition, number>> = { silent: 0, loud: 1, refused: 2, pass: 3 };
/** A defect that answers, wrongly, as if nothing were the matter. */
const SILENT = ["wrong", "wrong-output", "wrong-answer"];
/** A defect that stops or says so: a crash, an abort, output that cannot be
 * built, or a case past its bound (a timeout, compiling or running). */
const LOUD = ["invalid-hir", "runtime-abort", "aborted", "uncompilable-c", "compiler-crash", "build-failure", "timeout"];

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
  if (after === "refused" && before === "refused") return { word: "REFUSES DIFFERENTLY", ok: true, loud: true };
  return { word: "CHANGED", ok: false, loud: false };
}

/** A recorded case got better: a pass, a refusal or a loud stop where it was worse. */
export function improves(transition: OutcomeTransition): boolean {
  return transition.word === "FIXED" || transition.word === "REFUSES NOW" || transition.word === "LOUD NOW";
}

/**
 * A change the ratchet accepts: an improvement, or a case refused as before
 * for other reasons, which is not one. It passes, is listed, and the full
 * check rewrites its row; any other change fails.
 */
export function acceptedChange(transition: OutcomeTransition): boolean {
  return improves(transition) || transition.word === "REFUSES DIFFERENTLY";
}
