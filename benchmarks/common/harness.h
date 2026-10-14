// The contract every benchmark variant implements.
//
// One entry point, so the timing loop is written once and every variant --
// nts-generated, hand-written C++ -- is measured by identical code. A
// per-variant timing loop would be a per-variant opportunity to measure
// something slightly different.
#ifndef NTS_BENCH_HARNESS_H
#define NTS_BENCH_HARNESS_H

// Runs the workload once and returns a value derived from the result.
//
// Returning it is what stops the optimizer deleting the call: a benchmark whose
// result is unused can legally compile to nothing, and reports an impressive
// zero nanoseconds when it does.
double bench_run(void);

#endif
