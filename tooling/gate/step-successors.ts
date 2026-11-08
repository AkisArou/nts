// Explicit transfers of a removed step's checks to current steps. An empty
// steps list retires the check and requires a reviewable reason.
//
// One table read by two decisions: what a landing owes (owed.mjs, through the
// landing check's range selection) and how much work the gate expects a successor to
// bring before it has history of its own (run.mjs, step-scheduling.ts).
export const STEP_SUCCESSORS: Record<string, { steps: string[]; reason?: string }> = {
  // One step per backend, each against its own record.
  "typescript-cases": { steps: ["typescript-c", "typescript-llvm", "typescript-jvm"] },
};
