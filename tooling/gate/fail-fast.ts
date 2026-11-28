// NTS_GATE_FAIL_FAST's contract between the gate's runner (run.mjs) and the
// landing check that reads its summary (tooling/landing/run.ts).
//
// When fail-fast stops a run at its first FAIL, the summary's `interrupted`
// is this reason, and every row the stop ended (a pending step, or a running
// one whose scope it killed) is NOT RUN with `stopped: true`. A row that was
// NOT RUN for its own cause before the stop (a requested dependency that did
// not pass, no compiler) carries no mark. A later signal replaces the reason.

/** The summary's `interrupted` when fail-fast stopped the run. */
export const FAIL_FAST_STOP = "NTS_GATE_FAIL_FAST: a step failed";
