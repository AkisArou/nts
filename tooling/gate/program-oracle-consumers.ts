// The program oracle's consumers: the steps that read the run's one
// authenticated Node answer per program (`program-oracles`). A step is one
// exactly when its row in the step table needs that producer, so the table's
// `needs` column is the only list. The runner hands these steps the producer's
// reference and schedules the producer before them (run.mjs); the landing
// selection adds the producer to any change that owes one of them (owed.mjs).
//
// It reads whichever table it is given, so a test's stand-in table keeps its
// own consumers.
import type { StepRow } from "./step-table.mjs";

/** The names of the steps whose row needs `program-oracles`, in table order. */
export function programOracleConsumers(steps: readonly Pick<StepRow, "name" | "needs">[]): readonly string[] {
  return Object.freeze(steps.filter((step) => step.needs?.includes("program-oracles")).map((step) => step.name));
}
