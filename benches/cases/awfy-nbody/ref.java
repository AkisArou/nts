// Are We Fast Yet's own `NBody`, unchanged, called the way `ref.cpp` calls
// their C++ one.
//
// The class is theirs and stays theirs: it is compiled from
// `third_party/are-we-fast-yet/benchmarks/Java/src` and put on the classpath,
// exactly as `ref.cpp` puts their headers on the include path. This file is the
// entry point, not the implementation -- which is what makes the `Java` column
// a statement about their code rather than about ours.//
// **250,000 rather than the 1 every other case passes, and this is the one
// number in the suite that differs per lane.** Are We Fast Yet's ports do not
// agree about where the problem size lives: theirs takes the advance count as
// `innerBenchmarkLoop`'s argument, ours keeps it as a constant inside the
// benchmark and passes 1, and `ref.cpp` passes 250000 to match theirs.
//
// Passing our 1 to their Java ran **one** advance and reported 59.5ns against
// 7.36ms for the same work in C++ -- and the cross-variant checksum check
// passed, because their `verifyResult` carries an explicit
// `innerIterations == 1` branch that returns true. A guard satisfied by a
// special case in somebody else's code is not a guard.
//
// It used to live in a table in `tooling/bench`, where a reader of this row
// could not see it.
final class Ref extends Bench.Work {
    // `volatile` so the count is not a compile-time constant.
    private static volatile double iterations = 250_000;

    @Override public double run() {
        return new NBody().innerBenchmarkLoop((int) iterations) ? 1 : 0;
    }
}
